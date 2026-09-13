/**
 * What "is the modem there?" actually means, and the shape of the answer.
 *
 * It is not a boolean. A device can be absent, present but undriven, present
 * and answering but with no SIM, or fully working — and each of those needs a
 * different action from whoever is standing next to the machine. "No modem
 * found" while the thing is plugged in is the error message this exists to
 * design away.
 */

import type { ModemProbe } from "./detect.js";

export type ModemState =
  /** Nothing that looks like a modem anywhere. */
  | "absent"
  /** Windows can see a USB device but has no driver for it — so there is no COM port at all. */
  | "undriven"
  /** A port exists but nothing answers AT. Could be a USB-serial bridge with nothing behind it. */
  | "port_only"
  /** Answers AT, identity known, but not usable: no SIM, no signal, not registered, no SMS centre. */
  | "not_ready"
  /** All readiness checks pass. Can send. */
  | "ready"
  /** Was ready, now failing checks. May recover before we give up on it. */
  | "degraded";

export interface ModemSnapshot {
  state: ModemState;
  /** Plain language, always populated. The UI never has to invent a reason. */
  reason: string;
  /** When this snapshot was taken, so the dashboard can show staleness. */
  checkedAt: string;

  comPort: string | null;
  /** The Windows friendly name of the port, i.e. where it is physically attached. */
  portLabel: string | null;
  model: string | null;
  manufacturer: string | null;
  imei: string | null;
  firmware: string | null;
  /** The modem's own MSISDN. Null is COMMON and not a fault — see ModemProbe. */
  ownNumber: string | null;
  operator: string | null;
  technology: string | null;

  sim: ModemProbe["simState"] | null;
  registration: ModemProbe["registration"] | null;
  /** 0-31 as reported by AT+CSQ; null means no signal. */
  signal: number | null;
  smsc: string | null;
  /** Message storage. Rising usage means replies will eventually stop arriving. */
  storage: { used: number; total: number } | null;

  /** Consecutive failed liveness probes. Reset by any success. */
  failures: number;
  /** Last time any AT command succeeded. */
  lastSuccessAt: string | null;
  /** Most recent state change, for the activity trail. */
  lastTransition: { from: ModemState; to: ModemState; at: string; reason: string } | null;
}

export function emptySnapshot(): ModemSnapshot {
  return {
    state: "absent",
    reason: "Starting up — looking for a modem.",
    checkedAt: new Date().toISOString(),
    comPort: null,
    portLabel: null,
    model: null,
    manufacturer: null,
    imei: null,
    firmware: null,
    ownNumber: null,
    operator: null,
    technology: null,
    sim: null,
    registration: null,
    signal: null,
    smsc: null,
    storage: null,
    failures: 0,
    lastSuccessAt: null,
    lastTransition: null,
  };
}

/** Fills the identity/readiness fields of a snapshot from a detection probe. */
export function applyProbe(snapshot: ModemSnapshot, probe: ModemProbe): ModemSnapshot {
  return {
    ...snapshot,
    comPort: probe.comPort,
    portLabel: probe.label ?? null,
    model: probe.model ?? null,
    manufacturer: probe.manufacturer ?? null,
    imei: probe.imei ?? null,
    firmware: probe.firmware ?? null,
    ownNumber: probe.ownNumber ?? null,
    operator: probe.operator ?? null,
    technology: probe.technology ?? null,
    sim: probe.simState ?? null,
    registration: probe.registration ?? null,
    signal: probe.signal ?? null,
    smsc: probe.smsc ?? null,
  };
}

/** True when the modem is in a state where sending would actually work. */
export function canSend(state: ModemState): boolean {
  return state === "ready" || state === "degraded";
}

/**
 * Signal quality as words. AT+CSQ returns 0-31; 99 means no signal, which
 * detect.ts has already converted to null.
 */
export function describeSignal(rssi: number | null): string {
  if (rssi === null) return "no signal";
  const dbm = -113 + 2 * rssi;
  const quality = rssi >= 20 ? "excellent" : rssi >= 15 ? "good" : rssi >= 10 ? "usable" : "weak";
  return `${rssi}/31 (${dbm} dBm, ${quality})`;
}
