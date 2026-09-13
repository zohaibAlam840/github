/**
 * Finds a modem that can actually send SMS — not merely one that answers.
 *
 * The previous version accepted the first port that replied "OK" to AT. That
 * is not the same question. A SIM7600 with no SIM card, no antenna, or an
 * unregistered SIM answers AT perfectly and then fails every send, so the
 * system would pick it, report itself healthy, and quietly do nothing.
 *
 * Two stages:
 *
 *   1. Rank ports before opening any. A SIM7600 exposes four or five COM
 *      ports and only the AT one works — the Qualcomm diagnostic port in
 *      particular can hang when opened, so it is skipped by name rather than
 *      probed.
 *
 *   2. Qualify each candidate: identity, SIM, radio, registration, signal,
 *      service centre, text-mode support. Anything short of all of those is
 *      rejected WITH A REASON, so the UI can say "SIM card not detected on
 *      COM5" instead of "no modem found".
 */

import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

export type ModemVerdict = "usable" | "not_ready" | "not_a_modem" | "unreachable";

export interface ModemProbe {
  comPort: string;
  label: string;
  verdict: ModemVerdict;
  /** Plain-language explanation, shown to whoever is standing at the machine. */
  reason: string;
  manufacturer?: string;
  model?: string;
  imei?: string;
  simState?: "ready" | "absent" | "pin_locked" | "unknown";
  registration?: "home" | "roaming" | "searching" | "denied" | "none" | "unknown";
  signal?: number | null;
  smsc?: string | null;
}

/** friendlyName is Windows-only, so it is absent from the cross-platform type. */
/** friendlyName is Windows-only, hence the intersection. Shared with the supervisor. */
export type PortEntry = Awaited<ReturnType<typeof SerialPort.list>>[number] & { friendlyName?: string };

/** Vendor IDs of cellular modules we recognise. SimTech (1E0E) is the SIM7600. */
const MODEM_VENDORS = new Set(["1E0E", "2C7C", "1BC7", "12D1", "1546"]);

/** Ports that are never the AT port. Opening the diagnostic port can hang. */
export const NEVER_AT = /bluetooth|nmea|diagnostic|diagnostics|audio|gps/i;

export interface DetectOptions {
  baudRate: number;
  /** Probe only this port (skips the scan). */
  only?: string;
  probeTimeoutMs?: number;
}

export async function detectModem(
  opts: DetectOptions
): Promise<{ chosen: ModemProbe | null; probes: ModemProbe[] }> {
  const candidates = await rankPorts(opts.only);
  const probes: ModemProbe[] = [];

  for (const candidate of candidates) {
    const probe = await qualify(candidate.path, candidate.label, opts);
    probes.push(probe);
    if (probe.verdict === "usable") return { chosen: probe, probes };
  }

  return { chosen: null, probes };
}

async function rankPorts(only?: string): Promise<{ path: string; label: string }[]> {
  if (only) return [{ path: only, label: "configured COM_PORT" }];

  let ports: PortEntry[];
  try {
    ports = (await SerialPort.list()) as PortEntry[];
  } catch {
    return [];
  }

  const scored = ports
    .filter((p) => p.path)
    .map((p) => {
      const label = p.friendlyName ?? [p.manufacturer, p.pnpId].filter(Boolean).join(" ") ?? p.path;
      const vendor = (p.vendorId ?? "").toUpperCase();
      let score = 0;
      if (MODEM_VENDORS.has(vendor)) score += 10;
      if (/\bAT\b/i.test(label)) score += 5; // "SimTech HS-USB AT Port"
      return { path: p.path, label, score, skip: NEVER_AT.test(label) };
    })
    .filter((p) => !p.skip)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ path, label }) => ({ path, label }));
}

/* ------------------------------------------------------------------ */
/* Qualification                                                       */
/* ------------------------------------------------------------------ */

async function qualify(
  path: string,
  label: string,
  opts: DetectOptions
): Promise<ModemProbe> {
  const base: ModemProbe = { comPort: path, label, verdict: "unreachable", reason: "" };
  let session: ProbeSession | null = null;

  try {
    session = await ProbeSession.open(path, opts.baudRate, opts.probeTimeoutMs ?? 3000);
  } catch (err) {
    return { ...base, verdict: "unreachable", reason: `Could not open the port: ${msg(err)}` };
  }

  try {
    if (!(await session.ok("AT", 2500))) {
      return { ...base, verdict: "not_a_modem", reason: "No response to AT — not a modem, or powered off" };
    }
    await session.ok("ATE0", 2000);

    const manufacturer = bare(await session.ask("AT+CGMI"));
    const model = bare(await session.ask("AT+CGMM"));
    const imei = bare(await session.ask("AT+CGSN"));
    const probe: ModemProbe = { ...base, manufacturer, model, imei };

    // --- SIM ---
    const cpin = (await session.ask("AT+CPIN?")).join(" ");
    if (/\+CPIN:\s*READY/i.test(cpin)) probe.simState = "ready";
    else if (/SIM PIN/i.test(cpin)) probe.simState = "pin_locked";
    else if (/ERROR/i.test(cpin)) probe.simState = "absent";
    else probe.simState = "unknown";

    if (probe.simState === "absent") {
      return { ...probe, verdict: "not_ready", reason: "No SIM card detected — check it is seated correctly" };
    }
    if (probe.simState === "pin_locked") {
      return { ...probe, verdict: "not_ready", reason: "SIM is PIN-locked — disable the PIN, it cannot be used unattended" };
    }

    // --- text mode ---
    if (!(await session.ok("AT+CMGF=1", 3000))) {
      return { ...probe, verdict: "not_ready", reason: "Modem rejected SMS text mode (AT+CMGF=1)" };
    }

    // --- registration ---
    const creg = (await session.ask("AT+CREG?")).join(" ");
    const stat = Number(creg.match(/\+CREG:\s*\d+,(\d+)/i)?.[1] ?? NaN);
    probe.registration =
      stat === 1 ? "home" : stat === 5 ? "roaming" : stat === 2 ? "searching" : stat === 3 ? "denied" : stat === 0 ? "none" : "unknown";

    if (probe.registration === "denied") {
      return { ...probe, verdict: "not_ready", reason: "Network registration denied — the SIM may be inactive or unpaid" };
    }
    if (probe.registration !== "home" && probe.registration !== "roaming") {
      return { ...probe, verdict: "not_ready", reason: `Not registered on a network (${probe.registration})` };
    }

    // --- signal ---
    const csq = (await session.ask("AT+CSQ")).join(" ");
    const rssi = Number(csq.match(/\+CSQ:\s*(\d+)/i)?.[1] ?? NaN);
    probe.signal = Number.isFinite(rssi) && rssi !== 99 ? rssi : null;
    if (probe.signal === null) {
      return { ...probe, verdict: "not_ready", reason: "No signal — check the MAIN antenna is connected" };
    }

    // --- service centre ---
    const csca = (await session.ask("AT+CSCA?")).join(" ");
    probe.smsc = csca.match(/\+CSCA:\s*"([^"]*)"/i)?.[1] ?? null;
    if (!probe.smsc || probe.smsc.length < 5) {
      return {
        ...probe,
        verdict: "not_ready",
        reason: "No SMS service centre configured — sends would fail silently. Set SMSC in the worker configuration.",
      };
    }

    return {
      ...probe,
      verdict: "usable",
      reason: `${model || "Modem"} ready (signal ${probe.signal}/31, ${probe.registration})`,
    };
  } catch (err) {
    return { ...base, verdict: "unreachable", reason: `Probe failed: ${msg(err)}` };
  } finally {
    session?.close();
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function bare(lines: string[]): string {
  return (
    lines
      .filter((l) => l !== "OK" && !/^(AT|ERROR|\+CM[ES] ERROR)/i.test(l))
      .join(" ")
      .trim() || ""
  );
}

/* ------------------------------------------------------------------ */
/* A throwaway session used only for probing                           */
/* ------------------------------------------------------------------ */

class ProbeSession {
  private buffer: string[] = [];
  private waiting: ((lines: string[]) => void) | null = null;

  private constructor(private port: SerialPort) {
    port.pipe(new ReadlineParser({ delimiter: "\r\n" })).on("data", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (!this.waiting) return; // orphan or URC — discard while probing
      this.buffer.push(trimmed);
      if (/^(OK|ERROR)$/.test(trimmed) || /^\+CM[ES] ERROR:/i.test(trimmed)) {
        const done = this.waiting;
        const lines = this.buffer;
        this.waiting = null;
        this.buffer = [];
        done(lines);
      }
    });
    // Without a listener, a stream 'error' is thrown and kills the process.
    port.on("error", () => {});
  }

  static open(path: string, baudRate: number, timeoutMs: number): Promise<ProbeSession> {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({ path, baudRate, autoOpen: false });
      port.on("error", () => {});
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        if (port.isOpen) port.close(() => {});
        reject(new Error(`timed out opening after ${timeoutMs}ms`));
      }, timeoutMs);
      port.open((err) => {
        if (settled) {
          if (!err && port.isOpen) port.close(() => {});
          return;
        }
        clearTimeout(timer);
        if (err) return reject(err);
        resolve(new ProbeSession(port));
      });
    });
  }

  ask(cmd: string, timeoutMs = 4000): Promise<string[]> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiting) {
          this.waiting = null;
          this.buffer = [];
          resolve([]);
        }
      }, timeoutMs);
      this.waiting = (lines) => {
        clearTimeout(timer);
        resolve(lines);
      };
      this.port.write(`${cmd}\r\n`);
    });
  }

  async ok(cmd: string, timeoutMs = 4000): Promise<boolean> {
    return (await this.ask(cmd, timeoutMs)).includes("OK");
  }

  close() {
    if (this.port.isOpen) this.port.close(() => {});
  }
}
