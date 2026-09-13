/**
 * Owns the modem for the life of the process.
 *
 * Transport selection used to be a value computed once at boot, which meant
 * GET /health would happily report a modem that had been unplugged an hour
 * earlier. The supervisor owns it instead and hands it out by getter, so the
 * reported state is always the current one.
 *
 * TWO RULES SHAPE THE CHECKING:
 *
 *  1. The dashboard must never cause serial traffic. Every browser tab polls
 *     /health every 10 seconds; if that triggered a probe, three open tabs
 *     would mean constant self-inflicted traffic on the one line that also
 *     sends SMS. /health reads the snapshot this class maintains. Nothing
 *     else.
 *
 *  2. Busy is not dead. A confirmed command holds the line for 15+ seconds.
 *     A probe queued behind that must not be counted as a failure, or the
 *     system would declare the modem broken precisely when it was working.
 *     A recent successful AT command counts as proof of life and skips the
 *     probe entirely — real traffic is better evidence than a synthetic ping.
 */

import { SerialPort } from "serialport";
import type { WorkerConfig } from "../config.js";
import { SerialModemTransport } from "./serialModem.js";
import { detectModem, NEVER_AT, type ModemProbe, type PortEntry } from "./detect.js";
import {
  applyProbe,
  emptySnapshot,
  type ModemSnapshot,
  type ModemState,
} from "./health.js";
import { findUndrivenModems } from "../hardware/windowsPnp.js";
import type { IncomingSmsHandler, SendResult, SmsTransport, Unsubscribe } from "./types.js";

/** Failed probes before we start trying to recover the port. */
const FAILURES_BEFORE_RECOVERY = 3;
/** A successful AT command within this window makes a probe unnecessary. */
const LIVENESS_GRACE_MS = 15_000;
/** Tier 2 (signal, registration) runs every N ticks. */
const REACHABILITY_EVERY = 4;
/** Tier 3 (SIM, SMS centre, storage) runs every N ticks. */
const CONFIG_DRIFT_EVERY = 20;

/**
 * The supervisor IS the transport, from the rest of the worker's point of
 * view.
 *
 * This matters for one specific failure. A dispatch used to capture the
 * SerialModemTransport object and subscribe to it for the reply. But
 * recovery builds a NEW transport when it reopens the port — so the reply
 * arrived on the new object, the old subscription never fired, and a command
 * that had actually succeeded sat until its 8-minute ceiling and reported
 * "no response" with the reply visible in the Inbox the whole time.
 *
 * Subscribing here instead makes the listener outlive any number of modem
 * replacements: handlers are held by the supervisor and re-attached to
 * whatever transport is current.
 */
export class ModemSupervisor implements SmsTransport {
  readonly name = "serial_modem";

  /** Listeners that must survive the transport being replaced underneath them. */
  private handlers: IncomingSmsHandler[] = [];
  /** The transport these handlers are currently attached to. */
  private attachedTo: SerialModemTransport | null = null;

  private transport: SerialModemTransport | null = null;
  private snapshot: ModemSnapshot = emptySnapshot();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  private busy = false;
  /** Ports already rejected, so we do not re-interrogate the same non-modem forever. */
  private rejected = new Map<string, string>();
  private lastPortSignature = "";
  /**
   * The verdict from the last real scan, replayed on ticks that skip probing.
   * Without it a skipped tick reported a made-up state ("port_only") next to
   * the previous tick's reason ("No SIM card detected") — the two disagreed,
   * and the dashboard coloured it by the wrong one.
   */
  private lastRejection: { state: ModemState; reason: string } | null = null;

  constructor(private config: WorkerConfig) {}

  /* ---------------- public surface ---------------- */

  /** The live transport, or null when there is no usable modem. */
  current(): SerialModemTransport | null {
    return this.transport;
  }

  /* ---------------- SmsTransport, delegated ---------------- */

  async send(toNumber: string, text: string): Promise<SendResult> {
    const live = this.transport;
    if (!live) return { ok: false, error: this.snapshot.reason };
    return live.send(toNumber, text);
  }

  async checkStatus(providerId: string): Promise<{ state: string } | null> {
    return this.transport?.checkStatus(providerId) ?? null;
  }

  /**
   * Subscribes for the life of the process, not the life of one modem.
   * Re-attached to each new transport by attachHandlers().
   */
  onReceive(handler: IncomingSmsHandler): Unsubscribe {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /**
   * Points our single fan-out listener at the current transport. Called on
   * every transport change; the per-handler list above never moves, so a
   * dispatch waiting on a reply does not notice the swap.
   */
  private attachHandlers() {
    if (!this.transport || this.attachedTo === this.transport) return;
    this.attachedTo = this.transport;
    this.transport.onReceive((msg) => {
      for (const h of [...this.handlers]) h(msg);
    });
  }

  /** The cached state. Reading this performs no I/O — see rule 1 above. */
  health(): ModemSnapshot {
    return this.snapshot;
  }

  /**
   * Every serial port on the machine, with what we know about each.
   *
   * Enumeration only — this deliberately does NOT probe. Opening the live
   * modem's port to satisfy a dashboard refresh would interrupt a send, and
   * opening a SIM7600's diagnostic port can hang. The rejection reasons come
   * from the last real scan, which is where the interrogation belongs.
   */
  async ports(): Promise<
    { comPort: string; label: string; active: boolean; skipped: boolean; reason: string | null }[]
  > {
    let listed: PortEntry[];
    try {
      listed = (await SerialPort.list()) as PortEntry[];
    } catch {
      return [];
    }
    return listed
      .filter((p) => p.path)
      .map((p) => {
        const label = p.friendlyName ?? [p.manufacturer, p.pnpId].filter(Boolean).join(" ") ?? p.path;
        return {
          comPort: p.path,
          label,
          active: p.path === this.snapshot.comPort && this.transport !== null,
          // Named so the dashboard can explain why a port was never tried,
          // rather than leaving it looking overlooked.
          skipped: NEVER_AT.test(label),
          reason: this.rejected.get(p.path) ?? null,
        };
      });
  }

  async start() {
    await this.tick(); // first look immediately, do not wait a full interval
    this.timer = setInterval(() => void this.tick(), this.config.healthTickMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.transport?.close();
    this.transport = null;
  }

  /**
   * Forces a full re-detection now.
   *
   * This DROPS the current modem before scanning. That is the point of the
   * button: the case it exists for is "it attached to the wrong COM port, or
   * to a different modem than the one you meant", and a rescan that kept the
   * existing attachment could never fix either. It only ever runs when
   * somebody asks for it.
   */
  async rescan(): Promise<ModemSnapshot> {
    this.rejected.clear();
    this.lastRejection = null;
    this.lastPortSignature = "";
    if (this.transport) {
      this.transport.close();
      this.transport = null;
      this.snapshot = { ...this.snapshot, failures: 0 };
    }
    await this.tick(true);
    return this.snapshot;
  }

  /* ---------------- the loop ---------------- */

  private async tick(force = false) {
    if (this.busy) return; // a previous tick is still running
    this.busy = true;
    this.ticks += 1;
    try {
      if (this.transport) await this.checkExisting();
      else await this.lookForModem(force);
    } catch (err) {
      this.setState("degraded", `Health check failed: ${msg(err)}`);
    } finally {
      this.snapshot = { ...this.snapshot, checkedAt: new Date().toISOString() };
      this.busy = false;
    }
  }

  /* ---------------- when we have a modem ---------------- */

  private async checkExisting() {
    const transport = this.transport!;

    // Tier 0 — free. An unplugged modem disappears from the port list, which
    // is unambiguous and instant. No probe, no counting, no waiting for a
    // timeout.
    if (this.snapshot.comPort && !(await this.portStillListed(this.snapshot.comPort))) {
      this.loseModem(`${this.snapshot.comPort} disappeared — the modem was unplugged or reset.`);
      return;
    }

    // Tier 1 — liveness, unless real traffic already proved it.
    const sinceSuccess = Date.now() - transport.lastSuccessAt;
    if (sinceSuccess > LIVENESS_GRACE_MS) {
      const alive = await transport.probeLiveness(3000);
      if (!alive) {
        await this.recordFailure();
        return;
      }
    }

    this.snapshot = {
      ...this.snapshot,
      failures: 0,
      lastSuccessAt: new Date(transport.lastSuccessAt).toISOString(),
    };

    // Tier 2 — signal and registration change over time and predict whether
    // a send will actually succeed.
    //
    // A read that FAILS leaves the previous value in place. It is not
    // evidence of anything: the usual cause is the probe queuing behind a
    // real send, and rule 2 at the top of this file is that busy is not
    // dead. Only an answer the modem actually gave changes the verdict.
    if (this.ticks % REACHABILITY_EVERY === 0) {
      try {
        this.snapshot = { ...this.snapshot, signal: await transport.readSignal() };
      } catch {
        /* keep the last reading */
      }
    }

    // Tier 3 — slow-moving, but catastrophic when wrong. Storage filling is
    // the one that matters: once full the network stops delivering replies
    // with no error anywhere.
    if (this.ticks % CONFIG_DRIFT_EVERY === 0) {
      try {
        this.snapshot = { ...this.snapshot, storage: await transport.readStorage() };
      } catch {
        /* keep the last reading */
      }
    }

    // Verdict is recomputed from the STORED readings on every tick, not only
    // on the tick that measured them. Setting "ready" here unconditionally
    // and then degrading inside the tier blocks meant a warning survived
    // exactly one tick out of four (signal) or twenty (storage) — so "storage
    // nearly full", the fault that silently stops every reply arriving, was
    // on screen for 15 seconds in every 5 minutes and gone the rest.
    const concern = this.concern();
    if (concern) this.setState("degraded", concern);
    else this.setState("ready", "Modem responding normally.");
  }

  /**
   * The worst thing currently known about a modem that is otherwise
   * answering. Reads cached values only — no I/O — so it is safe to call on
   * every tick.
   */
  private concern(): string | null {
    const { signal, storage } = this.snapshot;

    // Storage first: it is the one that fails silently and takes the whole
    // system with it. Weak signal at least announces itself as failed sends.
    if (storage && storage.total > 0 && storage.used / storage.total > 0.8) {
      return `Message storage ${storage.used}/${storage.total} — incoming replies will stop arriving once it fills.`;
    }
    if (signal === null) {
      return "No signal — check the MAIN antenna is still connected.";
    }
    return null;
  }

  private async recordFailure() {
    const failures = this.snapshot.failures + 1;
    this.snapshot = { ...this.snapshot, failures };

    if (failures < FAILURES_BEFORE_RECOVERY) {
      this.setState("degraded", `Modem did not answer (${failures}/${FAILURES_BEFORE_RECOVERY}).`);
      return;
    }

    // Recovery ladder. Reopening the port clears a wedged USB serial device
    // surprisingly often, so it is worth trying before declaring the hardware
    // lost and rescanning from scratch.
    console.warn("[supervisor] Modem unresponsive — closing and reopening the port.");
    const comPort = this.snapshot.comPort;
    this.transport?.close();
    this.transport = null;

    if (comPort) {
      const reopened = new SerialModemTransport({
        comPort,
        baudRate: this.config.baudRate,
        sweepIntervalMs: this.config.sweepIntervalMs,
        rawLog: this.config.rawLog,
        smscOverride: this.config.smscOverride,
        // Deliberately NOT purgeStorageOnStart: this is a mid-run recovery,
        // and wiping storage every time a wedged port is reopened would
        // destroy replies that arrived while it was down.
        purgeStorageOnStart: false,
      });
      if (await reopened.waitUntilReady(12_000)) {
        this.transport = reopened;
        this.attachHandlers();
        this.snapshot = { ...this.snapshot, failures: 0 };
        this.setState("ready", `Recovered by reopening ${comPort}.`);
        return;
      }
      reopened.close();
    }

    this.loseModem("Modem stopped responding and could not be recovered.");
  }

  private loseModem(reason: string) {
    this.transport?.close();
    this.transport = null;
    this.attachedTo = null;
    this.rejected.clear(); // it may come back on a different port
    this.lastRejection = null;
    this.lastPortSignature = "";

    // Carry the OUTGOING state across the reset. emptySnapshot() is already
    // "absent", so clearing first made setState see from === to and record no
    // transition at all — losing the timestamp of the unplug, which is the
    // single event most worth having in the trail.
    const from = this.snapshot.state;
    this.snapshot = {
      ...emptySnapshot(),
      state: from,
      lastTransition: this.snapshot.lastTransition,
    };
    this.setState("absent", reason);
    console.warn(`[supervisor] ${reason}`);
  }

  /* ---------------- when we do not ---------------- */

  private async lookForModem(force: boolean) {
    const ports = await listPorts();

    // Nothing at OS level. Ask Windows whether something is plugged in that
    // it simply has no driver for — that device creates no COM port, so it is
    // invisible to the port list and would otherwise read as "not plugged in".
    if (ports.length === 0) {
      const undriven = await findUndrivenModems();
      if (undriven.length > 0) {
        this.setState("undriven", undriven[0].message);
        return;
      }
      this.setState("absent", "No modem detected. Check it is plugged in and its driver installed.");
      return;
    }

    // Only probe when the set of ports has actually changed. Without this we
    // would re-open and re-interrogate the same unrelated device every tick.
    //
    // A skipped tick must REPLAY the verdict of the last real scan, not
    // invent one. The previous version paired a guessed state ("port_only")
    // with the previous scan's reason ("No SIM card detected on COM5"), so
    // state and reason described different faults and the dashboard coloured
    // it by the wrong one.
    const signature = ports.join("|");
    if (!force && signature === this.lastPortSignature && this.lastRejection) {
      this.setState(this.lastRejection.state, this.lastRejection.reason);
      return;
    }
    this.lastPortSignature = signature;

    const { chosen, probes } = await detectModem({
      baudRate: this.config.baudRate,
      only: this.config.comPort ?? undefined,
    });

    for (const p of probes) if (p.verdict !== "usable") this.rejected.set(p.comPort, p.reason);

    if (!chosen) {
      this.reportRejection(probes);
      return;
    }

    const transport = new SerialModemTransport({
      comPort: chosen.comPort,
      baudRate: this.config.baudRate,
      sweepIntervalMs: this.config.sweepIntervalMs,
      rawLog: this.config.rawLog,
      smscOverride: this.config.smscOverride,
      purgeStorageOnStart: this.config.purgeStorageOnStart,
    });

    if (!(await transport.waitUntilReady(15_000))) {
      transport.close();
      this.snapshot = applyProbe(this.snapshot, chosen);
      this.reject(
        "not_ready",
        `Modem on ${chosen.comPort} was found but failed to initialise. See data/at-log.txt.`
      );
      return;
    }

    this.transport = transport;
    this.attachHandlers();
    this.lastRejection = null;
    this.snapshot = { ...applyProbe(this.snapshot, chosen), failures: 0 };
    this.setState("ready", chosen.reason);
    console.log(`[supervisor] Modem ready on ${chosen.comPort}: ${chosen.reason}`);
  }

  /** Turns the most informative rejection into the reported state. */
  private reportRejection(probes: ModemProbe[]) {
    // A port that answered but is not usable tells us far more than one that
    // never answered at all, so prefer it in the message.
    const notReady = probes.find((p) => p.verdict === "not_ready");
    if (notReady) {
      this.snapshot = applyProbe(this.snapshot, notReady);
      this.reject("not_ready", notReady.reason);
      return;
    }
    const reachable = probes.find((p) => p.verdict === "not_a_modem");
    if (reachable) {
      this.reject("port_only", `${reachable.comPort}: ${reachable.reason}`);
      return;
    }
    this.reject("absent", probes[0]?.reason ?? "No usable modem found.");
  }

  /**
   * Reports a scan verdict AND remembers it, so a later tick that skips
   * probing (because nothing was replugged) repeats this exact answer rather
   * than assembling a new state around an old reason.
   */
  private reject(state: ModemState, reason: string) {
    this.lastRejection = { state, reason };
    this.setState(state, reason);
  }

  /* ---------------- state ---------------- */

  private setState(state: ModemState, reason: string) {
    const from = this.snapshot.state;
    this.snapshot = {
      ...this.snapshot,
      state,
      reason,
      lastTransition:
        from === state
          ? this.snapshot.lastTransition
          : { from, to: state, at: new Date().toISOString(), reason },
    };
    if (from !== state) console.log(`[supervisor] ${from} -> ${state}: ${reason}`);
  }

  private async portStillListed(comPort: string): Promise<boolean> {
    return (await listPorts()).includes(comPort);
  }
}

async function listPorts(): Promise<string[]> {
  try {
    return (await SerialPort.list()).map((p) => p.path).filter(Boolean);
  } catch {
    return [];
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
