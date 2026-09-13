/*
 * Domain types — the shared language of the whole system.
 *
 * These shapes mirror the backend's database schema (gateway-first model:
 * the SMS-addressable thing is the GATEWAY; valves hang off its outputs).
 * The mock layer and the future real API both return exactly these shapes,
 * so screens never change when the backend arrives.
 */

export type Role = "admin" | "operator" | "viewer";

/** Last-known physical state of a valve (from a confirmed SMS reply/push). */
export type ValveStatus = "open" | "closed" | "unknown";

/** What an operator can ask a valve to do. */
export type CommandAction = "open" | "close" | "status";

/** Lifecycle of one queued SMS command (matches backend `commands.status`). */
export type CommandStatus =
  | "pending" // accepted, waiting its turn in the queue
  | "sent" // handed to the modem, waiting for the SMS reply
  | "success" // matching reply received and parsed
  | "failed" // send error after all retries
  | "no_response" // no reply within the timeout
  | "unconfirmed"; // Settings.confirmAfterCommand was off — sent, never checked

export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
}

export interface Building {
  id: number;
  name: string;
  address: string;
  createdAt: string;
}

export interface Unit {
  id: number;
  buildingId: number;
  name: string;
  createdAt: string;
}

/** Reachability learned from the onboarding ping (built-in device command). */
export type GatewayReachability = "unknown" | "ok" | "unreachable";

/** A Teltonika TRB141 in the field — the SMS-addressable device. */
export interface Gateway {
  id: number;
  label: string; // human name, e.g. "GW-Al Sadd-04"
  simNumber: string; // the SIM's phone number = the address
  numOutputs: 1 | 2; // TRB141 has 2 relays -> up to 2 valves
  // TRB141 SMS Utilities auth mode for this device: null = "No authorization"
  // (any sender can command it); set = "By router admin password", and the
  // worker prefixes every outgoing command with "<authPassword> " before the
  // keyword. Confirm the exact separator on the bench before relying on it —
  // Teltonika's docs weren't reachable to verify programmatically.
  authPassword: string | null;
  reachability: GatewayReachability;
  lastSeenAt: string | null; // last time ANY SMS arrived from it
}

/** A physical valve, wired to one relay output of one gateway. */
export interface Valve {
  id: number;
  unitId: number;
  gatewayId: number;
  outputIndex: 1 | 2; // which relay on the gateway drives it
  valveCode: string; // human label, e.g. "SN0001"
  lastStatus: ValveStatus;
  lastSeenAt: string | null; // when we last got a confirmed reply/push
  pendingCommandId: number | null; // set while a command is in flight
}

/** One step in a command's progress trail — what's actually happening, not just a final status. */
export interface CommandEvent {
  ts: string;
  message: string;
}

/** One queued SMS command = one audit-log row (backend `commands` table). */
export interface Command {
  id: number;
  valveId: number;
  userId: number;
  userName: string;
  action: CommandAction;
  commandText: string; // the actual SMS text sent
  status: CommandStatus;
  sentAt: string | null;
  replyText: string | null; // raw SMS reply received
  replyAt: string | null;
  retries: number;
  createdAt: string;
  // Real (worker-backed) commands only: a live progress trail, and the
  // worker's tracking id so an in-flight command can resume being polled
  // after a page reload instead of getting stuck forever. See
  // sms-worker/src/confirmationTracker.ts for why this exists.
  events?: CommandEvent[];
  workerTrackingId?: string | null;
}

/**
 * A command joined with its valve/unit/building context — what the logs
 * and queue screens display (backend: GET /api/commands returns these).
 */
export interface CommandLog extends Command {
  valveCode: string;
  unitName: string;
  buildingName: string;
  simNumber: string;
}

/** Aggregate numbers for the dashboard stat tiles. */
export interface DashboardSummary {
  buildings: number;
  units: number;
  valves: number;
  open: number;
  closed: number;
  unknown: number;
  pendingCommands: number; // pending + sent (in flight)
}

/** A building row with its status distribution (dashboard list). */
export interface BuildingStats extends Building {
  unitCount: number;
  valveCount: number;
  open: number;
  closed: number;
  unknown: number;
}

/** What happened, for the live activity feed (structured -> translated in UI). */
export type ActivityKind =
  | "queued" // operator queued a command
  | "sent" // command handed to the modem
  | "reply" // valve confirmed via SMS reply
  | "push" // valve reported a state change on its own (I/O Juggler)
  | "timeout" // no reply within the timeout
  | "failed" // send failed after retries
  | "unconfirmed" // sent with confirmation intentionally skipped
  | "ping"; // gateway reachability check

export interface ActivityEvent {
  id: number;
  ts: string;
  kind: ActivityKind;
  valveCode: string | null;
  buildingName: string | null;
  userName: string | null;
  action: CommandAction | null;
  valveStatus: ValveStatus | null;
}

/** Result of the gateway onboarding ping (built-in TRB141 status command). */
export interface PingResult {
  gatewayId: number;
  ok: boolean;
  replyText: string | null;
  roundTripMs: number | null;
}

/**
 * How the office sends SMS. There is one way: a real AT-command modem
 * (SIM7600G-H, Robustel M1000 MP) on a COM port, driven by sms-worker.
 * Kept as a named type rather than dropped entirely so that adding a second
 * transport later does not mean re-threading a boolean through every screen.
 */
export type SmsTransportType = "serial_modem";

/**
 * System settings — the ONE place SMS keywords, reply tokens, queue
 * pacing, and the office-side SMS transport live (mirrors the physical
 * TRB141 configuration; backend GET/PUT /api/settings). Keyword templates
 * use {output} for the relay number, e.g. "v{output}on" -> "v1on".
 */
export interface Settings {
  keywordOpen: string;
  keywordClose: string;
  keywordStatus: string;
  replyOnToken: string; // reply containing this -> open
  replyOffToken: string; // reply containing this -> closed
  sendGapMs: number; // pause between sends (one modem!)
  maxRetries: number; // resend attempts after a send failure
  replyTimeoutMs: number; // no reply within this -> no_response

  // When true (default), Open/Close always sends a follow-up status query
  // to verify the valve actually moved — 2 SMS per command, matches the
  // TRB141's own "actuation rule never replies" behavior. When false, only
  // the actuation SMS is sent — halves SMS volume, but the valve's new
  // state is trusted, not verified: it lands as "unconfirmed", not
  // "success". Does not affect a plain status/Refresh query, which IS its
  // own confirmation and only ever needs one message either way.
  confirmAfterCommand: boolean;

  // Office-side SMS transport. One modem on a serial port.
  smsTransport: SmsTransportType;
  comPort: string | null; // e.g. "COM5"; null lets the worker auto-detect and qualify

  // When set, commands are sent for REAL via the local sms-worker process
  // (http://localhost:3900 by default) instead of the simulated engine —
  // the "run everything locally, no Supabase yet" bench-testing path.
  // Leave null to keep the simulated timing/randomness for UI demos.
  workerUrl: string | null;
}

/**
 * Live-events contract — the ONE shared shape between the server's SSE
 * broadcaster (lib/server/queue.ts) and the browser's subscriber
 * (lib/socket.ts). Keep both in sync with this, not with each other.
 */
export interface AppEventMap extends Record<string, unknown> {
  "command:update": { command: Command };
  "valve:update": { valve: Valve; source: "reply" | "push" | "timeout" };
  "queue:update": { queued: number; processingId: number | null };
  activity: { event: ActivityEvent };
}
