/**
 * Async, persistent-in-process confirmation tracking.
 *
 * Why this exists: real SMS round-trips are slow and unpredictable (seen on
 * the bench: a reply that took over a minute to arrive). Blocking one HTTP
 * request open for minutes waiting on that is fragile — browser/connection
 * timeouts, and if the dashboard tab navigates away or reloads mid-wait, the
 * in-browser JS holding that fetch() promise is gone and the command is
 * orphaned forever (this is what caused the "goes stale, nothing happens
 * when I come back to the page" symptom).
 *
 * The fix: dispatch returns almost immediately with a tracking id. All the
 * slow waiting happens here, in the worker process — which stays alive
 * regardless of what the browser is doing. The dashboard polls
 * GET /status/:id (see controlServer.ts) as often as it likes; each poll is
 * a cheap, fast request that can't get orphaned by a page navigation.
 */

import { randomUUID } from "node:crypto";
import type { IncomingSms, SmsTransport } from "./transports/types.js";
import {
  composeCommandText,
  parseRelayState,
  numbersMatch,
  normalizeNumber,
  type GatewayInfo,
  type RelayState,
} from "./commands.js";
import { recordOutgoing } from "./inbox.js";

export interface ConfirmationEvent {
  ts: string;
  message: string;
}

export type ConfirmationStatus = "sent" | "success" | "failed" | "no_response" | "unconfirmed";

export interface ConfirmationRecord {
  id: string;
  simNumber: string;
  action: "open" | "close" | "status";
  status: ConfirmationStatus;
  events: ConfirmationEvent[];
  replyText: string | null;
  relayState: RelayState | null;
}

const records = new Map<string, ConfirmationRecord>();

// Records older than this get swept — this is an in-memory tracker, not a
// database; nothing here needs to survive a worker restart or live forever.
const RECORD_TTL_MS = 30 * 60_000;
setInterval(() => {
  const cutoff = Date.now() - RECORD_TTL_MS;
  for (const [id, record] of records) {
    const lastTs = record.events.at(-1)?.ts;
    if (lastTs && new Date(lastTs).getTime() < cutoff) records.delete(id);
  }
}, 5 * 60_000).unref();

/**
 * Replies already taken by a waiting command, so a second listener for the
 * same gateway cannot take the same message.
 *
 * Keyed by sender + text + arrival time: a modem delivers each message once,
 * as one object, so identity is enough. Bounded because this process runs for
 * months — only the last few matter, since every claim is made the instant
 * the message arrives.
 */
const claimedReplies = new Map<string, string>();
const MAX_CLAIMS = 200;

function claimReply(msg: IncomingSms, recordId: string): boolean {
  const key = `${msg.fromNumber}|${msg.receivedAt.getTime()}|${msg.text}`;
  const owner = claimedReplies.get(key);
  if (owner && owner !== recordId) return false;
  claimedReplies.set(key, recordId);
  while (claimedReplies.size > MAX_CLAIMS) {
    const oldest = claimedReplies.keys().next().value;
    if (oldest === undefined) break;
    claimedReplies.delete(oldest);
  }
  return true;
}

function log(record: ConfirmationRecord, message: string) {
  record.events.push({ ts: new Date().toISOString(), message });
}

export function getRecord(id: string): ConfirmationRecord | undefined {
  return records.get(id);
}

export interface DispatchOptions {
  expectedState?: RelayState;
  settleMs?: number;
  /** How long to keep waiting for a reply before giving up. Default 8 minutes — real SMS can be slow. */
  ceilingMs?: number;
  /** How often to check delivery status / log a "still waiting" heartbeat while no reply has arrived. */
  pollIntervalMs?: number;
  /**
   * Default true. When false (open/close only — a plain status query IS its
   * own confirmation and ignores this), the follow-up confirmation SMS is
   * never sent at all — not sent-and-ignored, genuinely not dispatched.
   * Halves SMS volume for operators who'd rather trust the actuation than
   * pay for a second message every time. The record resolves immediately to
   * "unconfirmed", not "success" — this project never claims a state it
   * hasn't actually verified.
   */
  confirm?: boolean;
}

/**
 * Sends the actuation command + status query, returns a tracking id
 * immediately after both are accepted by the transport (NOT after a reply —
 * that happens in the background). Poll getRecord(id) or GET /status/:id
 * for progress.
 */
export async function dispatchAndTrack(
  transport: SmsTransport,
  rawGateway: GatewayInfo,
  action: "open" | "close" | "status",
  actionKeyword: string,
  statusKeyword: string,
  opts: DispatchOptions = {}
): Promise<ConfirmationRecord> {
  // Normalise once, here, so every send and every log line downstream uses
  // the same form. AT+CMGS wants international format; the dashboard stores
  // whatever the operator typed. Reply matching is format-tolerant either
  // way (numbersMatch compares the last 8 digits).
  const gateway: GatewayInfo = { ...rawGateway, simNumber: normalizeNumber(rawGateway.simNumber) };

  const record: ConfirmationRecord = {
    id: randomUUID(),
    simNumber: gateway.simNumber,
    action,
    status: "sent",
    events: [],
    replyText: null,
    relayState: null,
  };
  records.set(record.id, record);

  // A plain status query (Refresh) IS the confirmation — it doesn't need a
  // second, separate query behind it. Open/close need the two-message
  // pattern because the actuation rule itself never replies (see
  // commands.ts), but here actionKeyword and statusKeyword are the same
  // string, so sending both would just SMS the identical "iostatus" twice
  // for one Refresh click. Send once and wait for its reply instead.
  if (action === "status") {
    const statusText = composeCommandText(statusKeyword, gateway);
    log(record, `Sending status query "${statusText}"...`);
    const result = await transport.send(gateway.simNumber, statusText);
    if (!result.ok) {
      record.status = "failed";
      log(record, `Status query send failed: ${result.error}`);
      return record;
    }
    recordOutgoing(gateway.simNumber, statusText);
    log(record, "Status query accepted by gateway. Waiting for TRB reply...");
    void confirmInBackground(transport, record, result.providerId, opts);
    return record;
  }

  const actionText = composeCommandText(actionKeyword, gateway);
  log(record, `Sending command "${actionText}"...`);
  const actionResult = await transport.send(gateway.simNumber, actionText);
  if (!actionResult.ok) {
    record.status = "failed";
    log(record, `Command send failed: ${actionResult.error}`);
    return record;
  }
  recordOutgoing(gateway.simNumber, actionText);
  log(record, "Command accepted by gateway.");

  if (opts.confirm === false) {
    record.status = "unconfirmed";
    log(record, "Confirmation skipped (disabled in Settings) — command sent, not verified.");
    return record;
  }

  await new Promise((r) => setTimeout(r, opts.settleMs ?? 4000));

  const statusText = composeCommandText(statusKeyword, gateway);
  log(record, `Sending confirmation query "${statusText}"...`);
  const statusResult = await transport.send(gateway.simNumber, statusText);
  if (!statusResult.ok) {
    record.status = "failed";
    log(record, `Confirmation query send failed: ${statusResult.error}`);
    return record;
  }
  recordOutgoing(gateway.simNumber, statusText);
  log(record, "Confirmation query accepted by gateway. Waiting for TRB reply...");

  // Everything past this point runs in the background — the caller (HTTP
  // handler) does not wait for it.
  void confirmInBackground(transport, record, statusResult.providerId, opts);

  return record;
}

async function confirmInBackground(
  transport: SmsTransport,
  record: ConfirmationRecord,
  providerId: string | undefined,
  opts: DispatchOptions
) {
  const ceilingMs = opts.ceilingMs ?? 8 * 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 20_000;
  const deadline = Date.now() + ceilingMs;

  let resolved = false;
  const unsubscribe = transport.onReceive((msg: IncomingSms) => {
    if (resolved) return;
    if (!numbersMatch(msg.fromNumber, record.simNumber)) return;
    // One reply, one command. Matching on the sender alone meant that two
    // commands in flight to the SAME gateway — open a valve, then hit Refresh
    // — both matched the first reply and both resolved from it, so one of
    // them reported an outcome it never actually received. A TRB reply
    // carries nothing that identifies which query it answers, so the only
    // honest rule is first-come, first-served.
    if (!claimReply(msg, record.id)) return;
    resolved = true;
    const relayState = parseRelayState(msg.text);
    record.replyText = msg.text;
    record.relayState = relayState;
    const success = opts.expectedState ? relayState === opts.expectedState : relayState !== "unknown";
    record.status = success ? "success" : "failed";
    log(record, `Reply received: "${msg.text}" — ${success ? "confirmed" : "unexpected relay state"}`);
  });

  try {
    while (!resolved && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      if (resolved) break;

      if (providerId && transport.checkStatus) {
        const delivery = await transport.checkStatus(providerId);
        log(
          record,
          delivery
            ? `Still waiting for TRB reply — confirmation SMS delivery: ${delivery.state}`
            : "Still waiting for TRB reply..."
        );
      } else {
        log(record, "Still waiting for TRB reply...");
      }
    }

    if (!resolved) {
      record.status = "no_response";
      log(record, `No reply after ${Math.round(ceilingMs / 60_000)} minutes — giving up.`);
    }
  } finally {
    unsubscribe();
  }
}
