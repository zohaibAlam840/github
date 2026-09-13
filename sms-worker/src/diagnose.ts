/**
 * Standalone modem diagnostic — the pre-check tool.
 *
 * Run this on the office PC BEFORE installing anything. It answers one
 * question: "is there a modem here that can actually send and receive SMS,
 * and if not, exactly what is wrong?"
 *
 * It is deliberately self-contained. It does not import the transport, the
 * supervisor, the queue or the config — it opens a port, asks the modem
 * some questions, and prints a report. That means it can be run on a
 * machine where nothing else is set up yet, which is the whole point.
 *
 * Every line sent and received is written to a raw log file. We do not own
 * this hardware, so when something behaves unexpectedly in the field that
 * log is the only forensic trail we will have — always ask for it back.
 *
 * Usage:
 *   npm run diagnose              scan every port and test whatever answers
 *   npm run diagnose -- COM5      test one specific port
 */

import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const BAUD_RATE = 115200;
const LOG_FILE = fileURLToPath(
  new URL(`../data/diagnose-${new Date().toISOString().replace(/[:.]/g, "-")}.log`, import.meta.url)
);

/* ------------------------------------------------------------------ */
/* Raw traffic log                                                     */
/* ------------------------------------------------------------------ */

function logRaw(direction: ">>" | "<<" | "--", text: string) {
  const line = `${new Date().toISOString()} ${direction} ${text}\n`;
  try {
    const dir = dirname(LOG_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(LOG_FILE, line);
  } catch {
    // A missing log file must never stop the diagnostic from running.
  }
}

/* ------------------------------------------------------------------ */
/* A minimal AT session                                                */
/* ------------------------------------------------------------------ */

/**
 * One command at a time, strictly sequential. This tool is the only thing
 * talking to the port, so it needs none of the mutex/URC machinery the
 * real transport requires — which is exactly why it can ship first.
 */
/** After a timeout, wait this long for the late reply to turn up and be discarded. */
const RESYNC_MS = 1500;

class AtSession {
  private port: SerialPort;
  private parser: ReadlineParser;
  private buffer: string[] = [];
  private waiting: ((lines: string[]) => void) | null = null;
  /** Set when a command timed out: its reply may still be in flight. */
  private desynced = false;

  private constructor(port: SerialPort) {
    this.port = port;
    this.parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
    this.parser.on("data", (line: string) => this.onLine(line));
    // A serial port is a stream: an 'error' with no listener is thrown as an
    // unhandled event and kills the process outright. That would take the
    // report down with it — on the exact flaky hardware this tool exists to
    // diagnose. Log it and keep going so the verdict still gets printed.
    this.port.on("error", (err: Error) => logRaw("--", `PORT ERROR: ${err.message}`));
  }

  static open(path: string, timeoutMs = 4000): Promise<AtSession> {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
      // Attach before open() so an error during opening cannot go unhandled.
      port.on("error", (err: Error) => logRaw("--", `PORT ERROR (during open) ${path}: ${err.message}`));

      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        // Close it. Without this the port stays open with no reference once
        // the late callback fires, locking the COM port against both the
        // retry and the worker, while we report "nothing could be opened".
        if (port.isOpen) port.close(() => {});
        reject(new Error(`Timed out opening ${path} after ${timeoutMs}ms`));
      }, timeoutMs);

      port.open((err) => {
        if (settled) {
          if (!err && port.isOpen) port.close(() => {});
          return;
        }
        clearTimeout(timer);
        if (err) return reject(err);
        logRaw("--", `opened ${path} @ ${BAUD_RATE}`);
        resolve(new AtSession(port));
      });
    });
  }

  private onLine(raw: string) {
    const line = raw.trim();
    if (!line) return;
    logRaw("<<", line);

    const terminal =
      line === "OK" || line === "ERROR" || line.startsWith("+CME ERROR") || line.startsWith("+CMS ERROR");

    // Nothing is waiting — this is an orphan (a late reply, or a URC).
    // Drop it rather than letting it accumulate into the next command.
    if (!this.waiting) {
      if (terminal) this.buffer = [];
      else this.buffer.push(line);
      if (this.buffer.length > 50) this.buffer = [];
      return;
    }

    this.buffer.push(line);
    if (terminal) {
      const done = this.waiting;
      const lines = this.buffer;
      this.buffer = [];
      this.waiting = null;
      done(lines);
    }
  }

  /** Sends one command and resolves with every line up to and including OK/ERROR. */
  async send(command: string, timeoutMs = 6000): Promise<string[]> {
    // If the previous command timed out, its reply may still arrive. Without
    // this pause it would be handed to THIS command, and every check after
    // it would report the previous one's answer — a report that confidently
    // blames the wrong component.
    if (this.desynced) await this.resync();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiting) {
          this.waiting = null;
          const partial = this.buffer;
          this.buffer = [];
          this.desynced = true;
          logRaw("--", `TIMEOUT after ${timeoutMs}ms waiting for: ${command}`);
          resolve(partial.length ? partial : ["<no response>"]);
        }
      }, timeoutMs);

      this.waiting = (lines) => {
        clearTimeout(timer);
        resolve(lines);
      };

      logRaw(">>", command);
      this.port.write(`${command}\r\n`);
    });
  }

  private resync(): Promise<void> {
    return new Promise((resolve) =>
      setTimeout(() => {
        this.buffer = [];
        this.desynced = false;
        logRaw("--", "resynced after timeout (discarded any late reply)");
        resolve();
      }, RESYNC_MS)
    );
  }

  close() {
    if (this.port.isOpen) this.port.close(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Result model                                                        */
/* ------------------------------------------------------------------ */

type Level = "pass" | "warn" | "fail" | "info";

interface Check {
  label: string;
  level: Level;
  value: string;
  note?: string;
}

const checks: Check[] = [];
function record(label: string, level: Level, value: string, note?: string) {
  checks.push({ label, level, value, note });
}

/** Pulls the first line matching a prefix, e.g. "+CSQ:". */
function find(lines: string[], prefix: string): string | null {
  return lines.find((l) => l.startsWith(prefix)) ?? null;
}

/** For commands like AT+CGMM whose answer is a bare line before OK. */
function bareValue(lines: string[]): string {
  const meaningful = lines.filter(
    (l) => l !== "OK" && l !== "ERROR" && !l.startsWith("AT") && !l.startsWith("+CME") && !l.startsWith("+CMS")
  );
  return meaningful.join(" ").trim() || "(no value)";
}

/* ------------------------------------------------------------------ */
/* Windows: find devices that have no driver                           */
/* ------------------------------------------------------------------ */

/**
 * A modem with no driver installed creates NO COM port at all, so
 * SerialPort.list() cannot see it — which is the single most confusing
 * failure state ("nothing is plugged in" when something clearly is).
 * Asking Windows directly is the only way to spot it.
 */
function findUndrivenDevices(): Promise<string[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  const script =
    "Get-PnpDevice -PresentOnly | " +
    "Where-Object { $_.InstanceId -match 'USB' -and $_.Status -ne 'OK' } | " +
    "Select-Object -ExpandProperty InstanceId";
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          stdout
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        );
      }
    );
  });
}

/** Recognises the common cellular-module vendors from a USB instance id. */
function identifyVendor(instanceId: string): string | null {
  const id = instanceId.toUpperCase();
  if (id.includes("VID_1E0E")) return "SIMCom (SIM7600 family) — needs the SIMCom SIM7500/SIM7600 Windows USB driver";
  if (id.includes("VID_2C7C")) return "Quectel — needs the Quectel Windows USB driver";
  if (id.includes("VID_1BC7")) return "Telit — needs the Telit Windows USB driver";
  if (id.includes("VID_12D1")) return "Huawei — needs the Huawei Mobile Broadband driver";
  return null;
}

/* ------------------------------------------------------------------ */
/* Port selection                                                      */
/* ------------------------------------------------------------------ */

/**
 * A SIM7600 exposes four or five COM ports and only the AT port answers.
 * The Qualcomm diagnostic port in particular can hang when opened, so it
 * is skipped by name rather than probed.
 */
function isSkippablePort(name: string): boolean {
  return /bluetooth|nmea|diagnostic|diagnostics|audio|gps/i.test(name);
}

/**
 * `friendlyName` is only present on Windows, so serialport's cross-platform
 * PortInfo type does not declare it. We need it — it is what distinguishes
 * "SimTech HS-USB AT Port" from the diagnostic port sitting next to it.
 */
type PortEntry = Awaited<ReturnType<typeof SerialPort.list>>[number] & {
  friendlyName?: string;
};

async function findCandidatePorts(): Promise<{ path: string; label: string; preferred: boolean }[]> {
  const ports = (await SerialPort.list()) as PortEntry[];
  const candidates: { path: string; label: string; preferred: boolean }[] = [];

  for (const p of ports) {
    if (!p.path) continue;
    const label = [p.friendlyName, p.manufacturer, p.pnpId].filter(Boolean).join(" ");
    if (isSkippablePort(label)) {
      record(`Port ${p.path}`, "info", "skipped", `Not an AT port (${p.friendlyName ?? label})`);
      continue;
    }
    // A SimTech port whose name mentions "AT" is almost certainly the one.
    const preferred =
      (p.vendorId ?? "").toUpperCase() === "1E0E" || /\bAT\b/i.test(p.friendlyName ?? "");
    candidates.push({ path: p.path, label: p.friendlyName ?? label ?? p.path, preferred });
  }

  // Try the likely ones first so we don't disturb unrelated devices.
  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return candidates;
}

/* ------------------------------------------------------------------ */
/* The diagnostic itself                                               */
/* ------------------------------------------------------------------ */

async function runDiagnostics(session: AtSession, comPort: string) {
  record("COM port", "pass", comPort);

  // --- identity -----------------------------------------------------
  await session.send("ATE0"); // echo off, so responses are clean
  record("Manufacturer", "info", bareValue(await session.send("AT+CGMI")));
  const model = bareValue(await session.send("AT+CGMM"));
  record("Model", "info", model);
  record("Firmware", "info", bareValue(await session.send("AT+CGMR")));

  const imei = bareValue(await session.send("AT+CGSN"));
  record("IMEI", /^\d{14,16}$/.test(imei) ? "pass" : "warn", imei, "Stable identity for this device");

  // --- SIM ----------------------------------------------------------
  const cpin = await session.send("AT+CPIN?");
  const cpinLine = find(cpin, "+CPIN:");
  if (cpinLine?.includes("READY")) {
    record("SIM card", "pass", "READY");
  } else if (cpinLine?.includes("SIM PIN")) {
    record("SIM card", "fail", "PIN LOCKED", "The SIM is PIN-protected. Disable the PIN, or it cannot be used unattended.");
  } else if (cpin.some((l) => l.includes("ERROR"))) {
    record("SIM card", "fail", "ERROR", "Usually poor contact — remove the SIM and reseat it firmly.");
  } else {
    record("SIM card", "fail", cpinLine ?? "no response", "No usable SIM detected.");
  }

  // --- radio --------------------------------------------------------
  const cfun = find(await session.send("AT+CFUN?"), "+CFUN:");
  const rfOn = cfun?.includes("1") ?? false;
  record("Radio", rfOn ? "pass" : "fail", cfun ?? "unknown", rfOn ? undefined : "Flight mode may be on.");

  const csq = find(await session.send("AT+CSQ"), "+CSQ:");
  const rssi = csq ? Number(csq.replace("+CSQ:", "").split(",")[0]?.trim()) : NaN;
  if (!Number.isFinite(rssi) || rssi === 99) {
    record("Signal", "fail", csq ?? "unknown", "No signal. Check the MAIN antenna is screwed on properly.");
  } else {
    const dbm = -113 + 2 * rssi;
    const quality = rssi >= 20 ? "excellent" : rssi >= 15 ? "good" : rssi >= 10 ? "usable" : "weak";
    record("Signal", rssi >= 10 ? "pass" : "warn", `${rssi}/31 (${dbm} dBm, ${quality})`,
      rssi < 10 ? "Weak signal — reposition the antenna if possible." : undefined);
  }

  // --- network ------------------------------------------------------
  const creg = find(await session.send("AT+CREG?"), "+CREG:");
  const stat = creg ? Number(creg.replace("+CREG:", "").split(",")[1]?.trim()) : NaN;
  const REG: Record<number, [Level, string]> = {
    0: ["fail", "not registered, not searching"],
    1: ["pass", "registered (home network)"],
    2: ["warn", "searching for a network"],
    3: ["fail", "registration DENIED — check the SIM is active and paid"],
    4: ["warn", "unknown"],
    5: ["pass", "registered (roaming)"],
  };
  const [regLevel, regText] = REG[stat] ?? ["warn", creg ?? "unknown"];
  record("Network registration", regLevel, regText);

  record("Operator", "info", find(await session.send("AT+COPS?"), "+COPS:") ?? "unknown");
  record("Network mode", "info", find(await session.send("AT+CNMP?"), "+CNMP:") ?? "unknown",
    "2 = automatic, which is what we want for SMS");
  record("System info", "info", find(await session.send("AT+CPSI?"), "+CPSI:") ?? "unknown");

  // --- SMS readiness ------------------------------------------------
  const cmgf = await session.send("AT+CMGF=1");
  record("SMS text mode", cmgf.includes("OK") ? "pass" : "fail", cmgf.includes("OK") ? "supported" : "REJECTED");

  const csca = find(await session.send("AT+CSCA?"), "+CSCA:");
  const smsc = csca?.match(/"([^"]*)"/)?.[1] ?? "";
  if (smsc && smsc.length > 5) {
    record("SMS centre", "pass", smsc);
  } else {
    record("SMS centre", "fail", smsc || "(blank)",
      "Without this, every message fails silently. Set it with AT+CSCA=\"+974...\".");
  }

  // Storage: once full, the network stops delivering and replies stop
  // arriving with no other symptom. Worth knowing the headroom now.
  const cpms = find(await session.send("AT+CPMS?"), "+CPMS:");
  const nums = cpms?.match(/(\d+),(\d+)/);
  if (nums) {
    const used = Number(nums[1]);
    const total = Number(nums[2]);
    const pct = total ? Math.round((used / total) * 100) : 0;
    record("Message storage", pct > 80 ? "warn" : "pass", `${used} of ${total} used (${pct}%)`,
      pct > 80 ? "Nearly full — incoming messages will stop arriving once it fills." : undefined);
  } else {
    record("Message storage", "warn", cpms ?? "unknown");
  }

  record("Character set", "info", find(await session.send('AT+CSCS?'), "+CSCS:") ?? "unknown",
    'Must be "IRA" or "GSM" — "UCS2" makes replies arrive as hex');
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const ICON: Record<Level, string> = { pass: "[ OK ]", warn: "[WARN]", fail: "[FAIL]", info: "[ -- ]" };

function printReport() {
  console.log("\n" + "=".repeat(68));
  console.log("  MODEM DIAGNOSTIC REPORT");
  console.log("=".repeat(68) + "\n");

  for (const c of checks) {
    console.log(`${ICON[c.level]}  ${c.label.padEnd(22)} ${c.value}`);
    if (c.note) console.log(`${" ".repeat(8)}${c.note}`);
  }

  const failures = checks.filter((c) => c.level === "fail");
  const warnings = checks.filter((c) => c.level === "warn");

  console.log("\n" + "-".repeat(68));
  if (failures.length === 0 && warnings.length === 0) {
    console.log("  VERDICT: READY — this modem can send and receive SMS.");
  } else if (failures.length === 0) {
    console.log(`  VERDICT: USABLE, with ${warnings.length} warning(s) to review.`);
  } else {
    console.log(`  VERDICT: NOT READY — ${failures.length} problem(s) must be fixed:`);
    for (const f of failures) console.log(`    - ${f.label}: ${f.value}`);
  }
  console.log("-".repeat(68));
  console.log(`\n  Raw log written to:\n  ${LOG_FILE}`);
  console.log("  Please send this file back with any problem report.\n");
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const requestedPort = process.argv[2];

  console.log("Modem diagnostic — checking this computer for an SMS-capable modem.\n");
  logRaw("--", `diagnostic started, platform=${process.platform}, node=${process.version}`);

  // Devices Windows can see but has no driver for — invisible to the
  // port list, and the most commonly misdiagnosed state.
  const undriven = await findUndrivenDevices();
  for (const id of undriven) {
    const vendor = identifyVendor(id);
    if (vendor) {
      record("Driver missing", "fail", vendor, `Windows sees the device but cannot use it: ${id}`);
      console.log(`!! A modem is plugged in but has no driver installed:\n   ${vendor}\n`);
    }
  }

  const candidates = requestedPort
    ? [{ path: requestedPort, label: "specified on the command line", preferred: true }]
    : await findCandidatePorts();

  if (candidates.length === 0) {
    record("Serial ports", "fail", "none found",
      undriven.length
        ? "A USB device is present but has no driver — install it and reboot."
        : "Nothing is connected, or the modem driver is not installed.");
    printReport();
    process.exit(1);
  }

  console.log(`Found ${candidates.length} port(s) to try: ${candidates.map((c) => c.path).join(", ")}\n`);

  // Distinguish "the port would not open" from "it opened but stayed
  // silent" — they have completely different causes and fixes, and this
  // text is what whoever is standing next to the machine has to act on.
  let anyPortOpened = false;
  const openErrors: string[] = [];

  for (const candidate of candidates) {
    process.stdout.write(`Trying ${candidate.path} (${candidate.label})... `);
    let session: AtSession | null = null;
    try {
      session = await AtSession.open(candidate.path);
      anyPortOpened = true;
      const reply = await session.send("AT", 2500);
      if (!reply.includes("OK")) {
        console.log("no response.");
        session.close();
        continue;
      }
      console.log("responded.\n");
      await runDiagnostics(session, candidate.path);
      session.close();
      printReport();
      process.exit(checks.some((c) => c.level === "fail") ? 1 : 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`could not open (${message}).`);
      openErrors.push(`${candidate.path}: ${message}`);
      session?.close();
    }
  }

  if (!anyPortOpened) {
    const inUse = openErrors.some((e) => /access is denied|busy|in use/i.test(e));
    record("Modem", "fail", "no port could be opened",
      inUse
        ? "The port exists but something else is already using it. Close any terminal or dialler software and try again."
        : `None of the ports could be opened. ${openErrors.join("; ")}`);
  } else {
    record("Modem", "fail", "no response to AT",
      "A port opened but the device did not answer. It may not be a modem, may be powered off, or may use a different baud rate.");
  }
  printReport();
  process.exit(1);
}

main().catch((err) => {
  console.error("\nDiagnostic failed unexpectedly:", err);
  logRaw("--", `fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
