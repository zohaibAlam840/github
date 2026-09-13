/**
 * Transport for a real AT-command modem on a COM port — the SIM7600G-H, or
 * the Robustel M1000 MP. Text-mode SMS (3GPP TS 27.005) throughout.
 *
 * Written against SIMCom's SMS Application Note V2.00 and the Waveshare
 * SIM7600X wiki; see docs/SIM7600G-H-REFERENCE.md, which records where each
 * command and expected response came from.
 *
 * THREE THINGS DRIVE THE DESIGN HERE, and all three were defects in the
 * first version of this file:
 *
 *  1. There is ONE serial line, shared by sends, health checks and reads.
 *     Everything therefore runs under a mutex, and the multi-step AT+CMGS
 *     sequence (prompt -> body -> Ctrl+Z) is held as a single critical
 *     section. Without that, a background read can be written into the body
 *     of an outgoing SMS while the modem sits at the ">" prompt.
 *
 *  2. The modem talks when it wants to. Unsolicited result codes (+CMTI for
 *     a new message, +CDS for a delivery report) arrive at any moment,
 *     including part-way through another command's response. They are routed
 *     out before the response parser ever sees them — otherwise an arriving
 *     valve reply is swallowed into an unrelated command and lost.
 *
 *  3. Storage is finite (40-50 messages) and fills silently. Once full the
 *     network simply stops delivering, with no error anywhere. Messages are
 *     therefore deleted as soon as they are read, and storage headroom is
 *     readable for monitoring.
 */

import { SerialPort } from "serialport";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  IncomingSms,
  IncomingSmsHandler,
  SendResult,
  SmsTransport,
  Unsubscribe,
} from "./types.js";

export interface SerialModemConfig {
  comPort: string;
  baudRate?: number;
  /** Safety-net sweep for anything the +CMTI push missed. Not the primary path. */
  sweepIntervalMs?: number;
  /** Write every line in and out to data/at-log.txt. On by default — we do not own this hardware. */
  rawLog?: boolean;
  /**
   * Written to the modem only if the SIM does not already carry a service
   * centre. Normally left unset; a blank SMSC makes every send fail silently,
   * so this exists to fix that on site without a code change.
   */
  smscOverride?: string | null;
}

/** Codes the modem sends unprompted. These can never be a command's answer. */
const ALWAYS_URC = [/^\+CMTI:/i, /^\+CMT:/i, /^\+CDS:/i, /^\+CBM:/i, /^RING$/i, /^NO CARRIER$/i];

/** Lines that end a command's response. +CME ERROR was missing before and hung every SIM fault. */
function isTerminal(line: string): boolean {
  return (
    line === "OK" ||
    line === "ERROR" ||
    /^\+CME ERROR:/i.test(line) ||
    /^\+CMS ERROR:/i.test(line)
  );
}

/**
 * 3GPP TS 27.005 SMS error codes, in words.
 *
 * Learned the hard way on the client's laptop: a bare "+CMS ERROR: 500"
 * reaches the operator as a number with no meaning, and answering "why?"
 * took a round of remote debugging. The code is what the network said; this
 * table is what it means and who can fix it.
 *
 * 500 in particular is the network's shrug — it refused and gave no reason —
 * and on a modem that is registered with full signal it almost always means
 * the SIM itself is not allowed to send SMS.
 */
const CMS_ERRORS: Record<number, string> = {
  21: "the destination number was rejected — check its format",
  27: "the destination is out of service",
  28: "unidentified subscriber — the destination number does not exist",
  30: "unknown subscriber — the destination number does not exist",
  38: "the network is out of order",
  41: "temporary network failure — worth retrying",
  42: "the network is congested — worth retrying",
  50: "SMS is not enabled on this SIM (facility not subscribed) — the mobile operator has to fix this",
  128: "the message could not be delivered",
  143: "no SMS centre address available",
  193: "this SIM has no SMS service centre subscription — the mobile operator has to fix this",
  208: "SIM message storage is full",
  209: "this SIM has no SMS storage capability",
  302: "the operation is not allowed on this SIM",
  303: "the operation is not supported",
  304: "invalid message parameter",
  305: "invalid message text parameter",
  310: "no SIM card",
  311: "the SIM is PIN-locked",
  313: "SIM failure",
  314: "the SIM is busy",
  316: "the SIM needs a PUK",
  322: "message memory is full",
  330: "the SMS centre address is not set — set SMSC in the worker configuration",
  331: "no network service",
  332: "the network timed out",
  500:
    "the network refused the message without giving a reason. On a modem that is " +
    "registered with good signal this almost always means SMS is not enabled on the " +
    "SIM, or the account has no credit. Check with the mobile operator.",
};

/** Turns a raw "+CMS ERROR: 500" line into something worth showing an operator. */
export function describeAtError(line: string): string {
  const cms = line.match(/^\+CMS ERROR:\s*(\d+)/i);
  if (cms) {
    const code = Number(cms[1]);
    const known = CMS_ERRORS[code];
    return known ? `SMS rejected (code ${code}): ${known}` : `SMS rejected by the network (code ${code}).`;
  }
  const cme = line.match(/^\+CME ERROR:\s*(.+)$/i);
  if (cme) return `Modem error: ${cme[1].trim()}`;
  return line;
}

/**
 * Decodes a UCS2 hex body, if that is what this is.
 *
 * AT+CSCS="IRA" sets the character set of the AT *interface*; it does not
 * change how a message was encoded by whoever sent it. Confirmed on the
 * client's SIM: every operator notification in storage came back as hex
 * ("00440065..." = "Dear...") while an ordinary phone's reply arrived as
 * plain text. Both have to work, because a TRB reply read as hex would parse
 * as "unknown" and the valve state would silently never update.
 *
 * The guard matters more than the decode. Plain text that happens to be all
 * hex digits ("12345678") must NOT be mangled, so a candidate is only
 * accepted when the decoded characters land in ranges real message text
 * actually uses — Latin, or Arabic for this deployment.
 */
export function decodeUcs2(text: string): string {
  const hex = text.replace(/\s+/g, "");
  if (hex.length < 8 || hex.length % 4 !== 0 || !/^[0-9A-Fa-f]+$/.test(hex)) return text;

  const units: number[] = [];
  for (let i = 0; i < hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));

  const plausible = units.filter(
    (u) =>
      (u >= 0x20 && u <= 0x7e) || // printable Latin
      u === 0x0a ||
      u === 0x0d ||
      (u >= 0x00a0 && u <= 0x024f) || // Latin supplements
      (u >= 0x0600 && u <= 0x06ff) // Arabic
  ).length;

  // Anything less and this is far more likely to be ordinary text that just
  // happens to look like hex.
  if (plausible / units.length < 0.9) return text;

  return units.map((u) => String.fromCharCode(u)).join("");
}

/** Message references are only 0-255, so this never needs to be large. */
const MAX_DELIVERY_REPORTS = 256;

const LOG_FILE = fileURLToPath(new URL("../../data/at-log.txt", import.meta.url));

export class SerialModemTransport implements SmsTransport {
  readonly name = "serial_modem";

  private port: SerialPort;
  private handlers: IncomingSmsHandler[] = [];
  private rawBuffer = "";
  private responseLines: string[] = [];

  /** Resolver for the command currently holding the line, if any. */
  private pending: ((lines: string[]) => void) | null = null;
  /** Resolver for a ">" prompt, which arrives with no line terminator. */
  private promptWaiter: (() => void) | null = null;
  /**
   * Fails whatever is currently waiting on the port. Used by close(): a
   * command outstanding against a port that has just been closed will never
   * be answered, and sitting out its full timeout only delays recovery.
   */
  private abortWaiter: ((err: Error) => void) | null = null;

  /** The mutex: every exchange chains onto this. */
  private lane: Promise<unknown> = Promise.resolve();

  private ready = false;
  private smsc: string | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private lastOkAt = 0;
  /** The AT+CNMI form this module actually accepted, or null if none did. */
  private pushMode: string | null = null;
  /** True only if the accepted CNMI form includes delivery reports. */
  private deliveryReportsSupported = false;
  /** Message reference -> delivery state, from +CDS reports. */
  private deliveryReports = new Map<string, string>();

  constructor(private config: SerialModemConfig) {
    this.port = new SerialPort({ path: config.comPort, baudRate: config.baudRate ?? 115200 });
    this.port.on("error", (err) => this.log("--", `PORT ERROR: ${err.message}`));
    this.port.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    this.port.on("open", () => {
      this.log("--", `opened ${config.comPort}`);
      void this.init();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Raw logging                                                         */
  /* ------------------------------------------------------------------ */

  private log(direction: ">>" | "<<" | "--", text: string) {
    if (this.config.rawLog === false) return;
    try {
      const dir = dirname(LOG_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(LOG_FILE, `${new Date().toISOString()} ${direction} ${text}\n`);
    } catch {
      // Logging must never break the transport.
    }
  }

  /* ------------------------------------------------------------------ */
  /* Framing: raw chunks -> prompt / lines / URCs                        */
  /* ------------------------------------------------------------------ */

  private onData(chunk: string) {
    this.rawBuffer += chunk;

    // The ">" prompt has NO terminator, so it can never be found by line
    // splitting. It has to be spotted in the raw stream.
    if (this.promptWaiter) {
      const at = this.rawBuffer.indexOf(">");
      if (at >= 0) {
        const before = this.rawBuffer.slice(0, at);
        this.rawBuffer = this.rawBuffer.slice(at + 1);

        // Whatever arrived ahead of the prompt is still real traffic — a
        // +CMTI for an incoming valve reply lands in the same chunk more
        // often than you would think. The old code sliced it away with the
        // prompt, and the message was then only recovered minutes later by
        // the safety sweep, if at all.
        for (const raw of before.split(/\r\n|\n|\r/)) {
          const line = raw.trim();
          if (line) this.onLine(line);
        }

        // Re-read: flushing those lines can have resolved this exchange
        // already (an error answer instead of a prompt).
        const done = this.promptWaiter;
        if (done) {
          this.promptWaiter = null;
          this.log("<<", "> (prompt)");
          done();
        }
        return;
      }
    }

    let idx: number;
    while ((idx = this.rawBuffer.search(/\r\n|\n|\r/)) >= 0) {
      const line = this.rawBuffer.slice(0, idx).trim();
      this.rawBuffer = this.rawBuffer.slice(idx + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string) {
    this.log("<<", line);

    // Route unsolicited codes away before the response parser sees them.
    // An ambiguous code (+CREG:, +CPIN:) belongs to a command if one is
    // outstanding, and is unsolicited otherwise.
    if (ALWAYS_URC.some((re) => re.test(line))) {
      this.onUrc(line);
      return;
    }
    if (!this.pending) {
      this.onUrc(line);
      return;
    }

    this.responseLines.push(line);
    if (isTerminal(line)) {
      const done = this.pending;
      const lines = this.responseLines;
      this.pending = null;
      this.responseLines = [];
      this.lastOkAt = Date.now();
      done(lines);
    }
  }

  private onUrc(line: string) {
    const cmti = line.match(/^\+CMTI:\s*"?([^",]*)"?,\s*(\d+)/i);
    if (cmti) {
      const index = Number(cmti[2]);
      // Read it on the lane so it cannot cut into an in-flight send.
      void this.exclusive(() => this.readAndDelete(index));
      return;
    }

    // Delivery status report. Without this the progress trail can only say
    // "still waiting", which cannot distinguish "the SMS never left" from
    // "it was delivered and the gateway is silent" — exactly the distinction
    // an operator needs when something is wrong.
    const cds = line.match(/^\+CDS:\s*(.+)$/i);
    if (cds) {
      const numbers = cds[1].match(/\d+/g) ?? [];
      // Text-mode +CDS is <fo>,<mr>,<ra>,<tora>,<scts>,<dt>,<st>. Field order
      // varies between modules, so take the reference from the front and the
      // status from the end, and keep the raw line for verification against
      // real hardware.
      const ref = numbers[1];
      const st = Number(numbers[numbers.length - 1]);
      if (ref !== undefined && Number.isFinite(st)) {
        // 3GPP TS 23.040: 0-31 delivered/pending, 32-63 temporary, 64+ failed.
        const state = st === 0 ? "Delivered" : st < 32 ? "In progress" : st < 64 ? "Temporary failure" : "Failed";
        // Bounded, and re-inserted so the newest reference wins. The message
        // reference wraps at 255, so on a machine that runs for months an
        // unbounded map would eventually answer for a message sent hours ago.
        this.deliveryReports.delete(ref);
        this.deliveryReports.set(ref, state);
        while (this.deliveryReports.size > MAX_DELIVERY_REPORTS) {
          const oldest = this.deliveryReports.keys().next().value;
          if (oldest === undefined) break;
          this.deliveryReports.delete(oldest);
        }
        this.log("--", `delivery report: ref ${ref} -> ${state} (st=${st})`);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* The lane                                                            */
  /* ------------------------------------------------------------------ */

  /** Serialises an exchange. Everything that touches the port goes through here. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lane.then(fn, fn);
    // Keep the chain alive even when a step rejects.
    this.lane = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * One command, one response. Because the lane guarantees a single
   * outstanding command, the reply cannot be credited to the wrong caller —
   * the previous design shifted a FIFO blindly and desynced permanently
   * after any timeout.
   */
  private command(cmd: string, timeoutMs = 8000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          this.abortWaiter = null;
          this.responseLines = [];
          // Anything arriving later has no waiter, so onLine discards it.
          this.log("--", `TIMEOUT (${timeoutMs}ms): ${cmd}`);
          reject(new Error(`AT command timed out: ${cmd}`));
        }
      }, timeoutMs);

      this.abortWaiter = (err) => {
        clearTimeout(timer);
        this.pending = null;
        this.abortWaiter = null;
        this.responseLines = [];
        reject(err);
      };

      this.pending = (lines) => {
        clearTimeout(timer);
        this.abortWaiter = null;
        const failed = lines.find((l) => l === "ERROR" || /^\+CM[ES] ERROR:/i.test(l));
        if (failed) return reject(new Error(`${cmd} -> ${describeAtError(failed)}`));
        resolve(lines);
      };

      this.log(">>", cmd);
      this.port.write(`${cmd}\r\n`);
    });
  }

  /** Like command(), but tolerates an error response instead of throwing. */
  private async tryCommand(cmd: string, timeoutMs = 8000): Promise<string[]> {
    try {
      return await this.command(cmd, timeoutMs);
    } catch {
      return [];
    }
  }

  /**
   * Waits for the ">" prompt after AT+CMGS — OR for the modem to refuse.
   *
   * The refusal path is the point. Previously only the prompt was watched,
   * so a "+CMS ERROR: 21" answer had no waiter, was routed away as an
   * unsolicited code, and thrown away; the send then sat out its full
   * timeout and reported `No ">" prompt received`. The modem had said
   * exactly what was wrong and we replaced it with a guess — on a remote
   * session that is the difference between a minute and an afternoon.
   */
  private waitForPrompt(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.promptWaiter = null;
        this.pending = null;
        this.abortWaiter = null;
        this.responseLines = [];
        reject(new Error('No ">" prompt received — the modem did not accept the message header.'));
      }, timeoutMs);

      const settle = () => {
        clearTimeout(timer);
        this.promptWaiter = null;
        this.pending = null;
        this.abortWaiter = null;
        this.responseLines = [];
      };

      this.abortWaiter = (err) => {
        settle();
        reject(err);
      };

      // The prompt arrives with no terminator and is spotted in onData.
      this.promptWaiter = () => {
        settle();
        resolve();
      };

      // A complete line arriving instead means the modem answered rather
      // than prompting — which for AT+CMGS is always a refusal.
      this.pending = (lines) => {
        settle();
        const failed = lines.find((l) => l === "ERROR" || /^\+CM[ES] ERROR:/i.test(l));
        reject(new Error(failed ? describeAtError(failed) : `Modem answered "${lines.join(" ")}" instead of prompting for the message.`));
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Initialisation                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * The full sequence. The old version sent only ATE0 and AT+CMGF=1 and then
   * declared itself ready, so a module left on the UCS2 character set with a
   * blank SMS centre was promoted to primary sender — every send silently
   * going nowhere, every reply arriving as hex and parsing as "unknown".
   */
  private async init() {
    try {
      await this.exclusive(async () => {
        await this.command("ATE0"); // echo off, so responses parse cleanly
        // Numeric error codes. Without this the modem answers "+CMS ERROR:
        // Unknown error" and the actual code — the only thing that names the
        // cause — is never reported at all. Cost us a round trip with the
        // client's laptop to discover.
        await this.tryCommand("AT+CMEE=1");
        await this.command("AT+CMGF=1"); // text mode, not PDU
        await this.command('AT+CSCS="IRA"'); // without this, bodies can arrive as UCS2 hex
        await this.tryCommand("AT+CSMP=17,167,0,0"); // SIMCom's documented SMS defaults
        // Prefer module flash over the SIM: more room before storage fills.
        await this.tryCommand('AT+CPMS="ME","ME","ME"');
        // Report what we ACTUALLY got. "ME" is not universally supported, and
        // a silent fall back to the SIM matters: a SIM typically holds 20
        // messages against the module's 100+, and a full store makes the
        // network stop delivering with no error anywhere.
        const cpms = await this.tryCommand("AT+CPMS?");
        const store = cpms.join(" ").match(/\+CPMS:\s*"([^"]*)",(\d+),(\d+)/i);
        if (store) {
          this.log("--", `message storage: ${store[1]} ${store[2]}/${store[3]}`);
          if (store[1].toUpperCase() === "SM") {
            console.warn(
              `[serialModem] Messages are stored on the SIM (${store[3]} slots), not the module. ` +
                "Replies are deleted as they are read, so this is workable, but headroom is tight."
            );
          }
        }
        // <mode>,<mt>,<bm>,<ds>,<bfr> — mt=1 pushes +CMTI for new messages,
        // ds=1 pushes +CDS delivery reports so send progress stays visible.
        //
        // NOT every module accepts every combination. The client's SIM7600
        // answers "+CMS ERROR: 303" (not supported) to the ds=1 form, and
        // because this used to be a hard command() the whole init threw and
        // the modem was never promoted — the worker refused to use a modem
        // that was working perfectly. Try richest first, settle for less.
        this.pushMode = null;
        for (const variant of ["AT+CNMI=2,1,0,1,0", "AT+CNMI=2,1,0,0,0", "AT+CNMI=2,1", "AT+CNMI=1,1,0,0,0"]) {
          const accepted = await this.tryCommand(variant);
          if (accepted.includes("OK")) {
            this.pushMode = variant;
            this.deliveryReportsSupported = variant.includes(",0,1,");
            break;
          }
        }
        if (!this.pushMode) {
          // No push at all. Still workable — the sweep finds messages — but
          // replies arrive on the sweep interval instead of instantly, so
          // say so rather than letting it look like a slow network.
          console.warn(
            "[serialModem] This module rejected every AT+CNMI form, so new messages are " +
              `not pushed. Replies will be picked up by the sweep every ${Math.round(
                (this.config.sweepIntervalMs ?? 120_000) / 1000
              )}s. Lower SWEEP_INTERVAL_MS if that is too slow.`
          );
          this.log("--", "no CNMI variant accepted — falling back to sweep-only");
        } else {
          this.log("--", `push notifications via ${this.pushMode}`);
        }

        // A blank service centre makes every send fail silently, so it is a
        // readiness condition rather than a warning.
        const csca = await this.tryCommand("AT+CSCA?");
        this.smsc = csca.join(" ").match(/\+CSCA:\s*"([^"]*)"/i)?.[1] ?? null;

        // If the SIM did not supply one, write the configured value. This is
        // the on-site fix for a SIM that would otherwise fail every send with
        // no visible cause.
        const override = this.config.smscOverride;
        if ((!this.smsc || this.smsc.length < 5) && override) {
          this.log("--", `no SMS centre on the SIM — setting configured value ${override}`);
          await this.tryCommand(`AT+CSCA="${override}"`);
          const recheck = await this.tryCommand("AT+CSCA?");
          this.smsc = recheck.join(" ").match(/\+CSCA:\s*"([^"]*)"/i)?.[1] ?? null;
        }
      });

      if (!this.smsc || this.smsc.length < 5) {
        this.log("--", "INIT REFUSED: no SMS centre configured");
        console.error(
          "[serialModem] SMS centre is not set on this SIM — sending would fail silently. " +
            'Set it with AT+CSCA="+974..." and restart.'
        );
        return; // stays not-ready, so the supervisor will not promote it
      }

      this.ready = true;
      console.log(`[serialModem] Ready on ${this.config.comPort} (SMS centre ${this.smsc}).`);

      // Anything that arrived while we were not listening.
      await this.exclusive(() => this.sweepUnread());
      this.startSweep();
    } catch (err) {
      this.log("--", `INIT FAILED: ${err instanceof Error ? err.message : err}`);
      console.error(
        `[serialModem] Init failed — check the baud rate and that the modem is powered: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sending                                                             */
  /* ------------------------------------------------------------------ */

  async send(toNumber: string, text: string): Promise<SendResult> {
    if (!this.ready) return { ok: false, error: "Modem not initialised" };

    // The whole prompt/body/Ctrl+Z exchange is one critical section.
    return this.exclusive(async (): Promise<SendResult> => {
      try {
        this.log(">>", `AT+CMGS="${toNumber}"`);
        this.port.write(`AT+CMGS="${toNumber}"\r`);
        await this.waitForPrompt();

        this.log(">>", `${text} <Ctrl+Z>`);
        const lines = await new Promise<string[]>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending = null;
            this.abortWaiter = null;
            this.responseLines = [];
            reject(new Error("Timed out waiting for the network to accept the message"));
          }, 20000);
          this.abortWaiter = (err) => {
            clearTimeout(timer);
            this.pending = null;
            this.abortWaiter = null;
            this.responseLines = [];
            reject(err);
          };
          this.pending = (out) => {
            clearTimeout(timer);
            this.abortWaiter = null;
            const failed = out.find((l) => l === "ERROR" || /^\+CM[ES] ERROR:/i.test(l));
            // describeAtError turns "+CMS ERROR: 500" into a sentence naming
            // the likely cause and who can fix it. This string ends up in the
            // dashboard's activity trail, so it is the whole explanation an
            // operator gets when a valve command does not go out.
            if (failed) return reject(new Error(describeAtError(failed)));
            resolve(out);
          };
          this.port.write(`${text}\x1A`);
        });

        // The message reference is what a later +CDS delivery report matches.
        const ref = lines.join(" ").match(/\+CMGS:\s*(\d+)/i)?.[1];
        return { ok: true, providerId: ref };
      } catch (err) {
        // Critical: if the prompt never came, or the body was never accepted,
        // the modem may still be waiting for message text. ESC cancels that.
        // Without it every later command is swallowed as SMS body and the
        // transport wedges permanently while still reporting itself ready.
        this.log("--", "cancelling message entry with ESC");
        this.promptWaiter = null;
        this.pending = null;
        this.responseLines = [];
        this.port.write("\x1B");
        await new Promise((r) => setTimeout(r, 250));
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Receiving                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Reads one message by index, hands it to the listeners, then deletes it.
   * Deleting is not housekeeping — storage holds only 40-50 messages, and a
   * full store makes the network stop delivering with no error at all.
   */
  private async readAndDelete(index: number) {
    try {
      const lines = await this.command(`AT+CMGR=${index}`);
      const headerAt = lines.findIndex((l) => /^\+CMGR:/i.test(l));
      if (headerAt < 0) return;

      const header = lines[headerAt];
      const from = header.match(/^\+CMGR:\s*"[^"]*","([^"]*)"/i)?.[1] ?? "";

      // Body is every line up to the terminal response — a message can span
      // several lines, and taking only the first truncated it before.
      const body: string[] = [];
      for (let i = headerAt + 1; i < lines.length; i++) {
        if (isTerminal(lines[i])) break;
        body.push(lines[i]);
      }
      // Decoded here, once, so nothing downstream ever sees hex: the relay
      // parser, the Inbox and the activity trail all read the same string.
      const text = decodeUcs2(body.join("\n").trim());

      if (from && text) {
        const msg: IncomingSms = { fromNumber: from, text, receivedAt: new Date() };
        for (const h of this.handlers) h(msg);
      }

      await this.tryCommand(`AT+CMGD=${index}`);
    } catch (err) {
      this.log("--", `readAndDelete(${index}) failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Startup and safety-net sweep for messages the push notification missed. */
  private async sweepUnread() {
    const lines = await this.tryCommand('AT+CMGL="REC UNREAD"', 12000);
    const indices: number[] = [];
    for (const line of lines) {
      const m = line.match(/^\+CMGL:\s*(\d+)/i);
      if (m) indices.push(Number(m[1]));
    }
    for (const index of indices) await this.readAndDelete(index);
  }

  private startSweep() {
    const configured = this.config.sweepIntervalMs ?? 120_000;
    // With push working the sweep is only a safety net and can be lazy. With
    // no push it is the ONLY way a reply is ever noticed, so it becomes the
    // primary path and has to run often enough to feel responsive.
    const interval = this.pushMode ? configured : Math.min(configured, 15_000);
    this.sweepTimer = setInterval(() => {
      void this.exclusive(() => this.sweepUnread());
    }, interval);
    this.sweepTimer.unref?.();
    this.log("--", `sweep every ${Math.round(interval / 1000)}s (push: ${this.pushMode ?? "none"})`);
  }

  /** Which push mode the module accepted, for diagnostics. Null = sweep only. */
  get notificationMode(): string | null {
    return this.pushMode;
  }

  /** Whether +CDS delivery reports are available on this module. */
  get hasDeliveryReports(): boolean {
    return this.deliveryReportsSupported;
  }

  /* ------------------------------------------------------------------ */
  /* Health                                                              */
  /* ------------------------------------------------------------------ */

  /** Cheap liveness probe. Callers should skip it if lastSuccessAt is recent. */
  async probeLiveness(timeoutMs = 3000): Promise<boolean> {
    try {
      await this.exclusive(() => this.command("AT", timeoutMs));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signal strength from AT+CSQ, 0-31.
   *
   * Three outcomes, and they must stay distinct: a number is a real reading,
   * `null` means the modem answered and reported 99 — the sentinel for NO
   * SIGNAL — and a rejection means the question could not be asked at all.
   * Collapsing the last two would tell an operator to go and check the
   * antenna because a health probe queued behind a busy send.
   */
  async readSignal(): Promise<number | null> {
    const lines = await this.exclusive(() => this.command("AT+CSQ", 4000));
    const raw = lines.join(" ").match(/\+CSQ:\s*(\d+)/i)?.[1];
    if (raw === undefined) throw new Error("AT+CSQ returned no reading");
    const rssi = Number(raw);
    return rssi === 99 ? null : rssi;
  }

  /**
   * Storage headroom — rising usage means replies will eventually stop
   * arriving. Rejects rather than returning null if the modem could not be
   * asked, so a failed read is never mistaken for an empty store.
   */
  async readStorage(): Promise<{ used: number; total: number } | null> {
    const lines = await this.exclusive(() => this.command("AT+CPMS?", 4000));
    const m = lines.join(" ").match(/\+CPMS:\s*"[^"]*",(\d+),(\d+)/i);
    return m ? { used: Number(m[1]), total: Number(m[2]) } : null;
  }

  /**
   * Delivery state for a message reference returned by send(). Populated by
   * +CDS reports; undefined until one arrives, which is normal for the first
   * several seconds after sending.
   */
  async checkStatus(providerId: string): Promise<{ state: string } | null> {
    const state = this.deliveryReports.get(providerId);
    return state ? { state } : null;
  }

  /** When an AT command last succeeded — a recent send is better proof than a probe. */
  get lastSuccessAt(): number {
    return this.lastOkAt;
  }

  get serviceCentre(): string | null {
    return this.smsc;
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  onReceive(handler: IncomingSmsHandler): Unsubscribe {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Resolves true once init() succeeds, false if it has not by timeoutMs. */
  waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (this.ready) return resolve(true);
        if (Date.now() - start >= timeoutMs) return resolve(false);
        setTimeout(check, 150);
      };
      check();
    });
  }

  close() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.ready = false;

    // Fail whatever is waiting on the line NOW. A command outstanding against
    // a port that is being closed will never be answered, and letting it sit
    // out its full timeout only delays the supervisor's recovery by seconds
    // it does not have to spend.
    const abort = this.abortWaiter;
    this.abortWaiter = null;
    this.pending = null;
    this.promptWaiter = null;
    this.responseLines = [];
    abort?.(new Error(`Serial port ${this.config.comPort} was closed`));

    if (this.port.isOpen) this.port.close(() => {});
  }
}
