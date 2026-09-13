/*
 * Polls the local sms-worker's GET /health so the Topbar can show the truth
 * about the office modem. "The worker is running" and "the modem works" are
 * different questions and the UI has to answer the second one — a reachable
 * worker with nothing plugged into it is a dead system, not a healthy one.
 * See sms-worker/src/transports/supervisor.ts for where these states come from.
 */

/** Mirrors ModemState in sms-worker/src/transports/health.ts. */
export type ModemState =
  | "absent"
  | "undriven"
  | "port_only"
  | "not_ready"
  | "ready"
  | "degraded";

export interface WorkerHealth {
  /** True only when the modem can actually send. NOT "the worker replied". */
  ok: boolean;
  /** What is wrong, in plain language, when ok is false. */
  state: ModemState;
  reason: string;
  detail: string;
  comPort: string | null;
  /** The worker's OWN configured keywords — what actually gets sent for a
   * real open/close/status dispatch. Can differ from the dashboard's
   * Settings screen, which is a separate, independently-editable copy of
   * the same three fields that nothing currently keeps in sync. */
  keywordOpen: string;
  keywordClose: string;
  keywordStatus: string;
}

export async function fetchWorkerHealth(
  workerUrl: string,
  timeoutMs = 3000
): Promise<WorkerHealth | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${workerUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as WorkerHealth;
  } catch {
    return null;
  }
}

/** One SMS the worker has sent or received — see sms-worker/src/inbox.ts. */
export interface InboxMessage {
  id: number;
  direction: "sent" | "received";
  /** The gateway's own SIM number either way — who it was sent to, or who replied. */
  simNumber: string;
  text: string;
  ts: string;
}

/** Every message the worker has ever sent or received, any gateway, newest first. Null means the worker isn't reachable — callers fall back to derived/demo data. */
export async function fetchWorkerInbox(
  workerUrl: string,
  timeoutMs = 3000
): Promise<InboxMessage[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${workerUrl}/inbox`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const raw = (await res.json()) as unknown[];
    // Defensive: sms-worker/data/inbox.json is file-backed and predates the
    // sent/received shape (direction+simNumber+ts) — a worker restart with
    // an old entry still on disk from before that change would otherwise
    // reach numbersMatch() with simNumber undefined and crash the page.
    // This is the actual system boundary (an external process's persisted
    // file), so validate here rather than trusting every caller downstream.
    return raw.filter(
      (m): m is InboxMessage =>
        !!m &&
        typeof m === "object" &&
        typeof (m as InboxMessage).simNumber === "string" &&
        (m as InboxMessage).direction !== undefined
    );
  } catch {
    return null;
  }
}

export interface RawSendStatus {
  status: "sent" | "success" | "failed" | "no_response" | "unconfirmed";
  events: { ts: string; message: string }[];
  replyText: string | null;
}

/**
 * Turns a failed worker response into something an operator can act on.
 *
 * The worker answers 503 with a real explanation — "No modem detected. Check
 * it is plugged in and its driver installed." — and we used to discard it and
 * report the bare status code instead, which then got logged as "could not
 * reach the worker". The worker was reached; it told us exactly what was
 * wrong, and we threw the sentence away and replaced it with a wrong one.
 */
export async function describeWorkerError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; reason?: string };
    const parts = [body.error, body.reason].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  } catch {
    // Not JSON, or an empty body. Fall through to the status code.
  }
  return `The worker rejected the request (HTTP ${res.status}).`;
}

/** Dispatches an arbitrary SMS text to a gateway — the Inbox page's "send a message" composer. See sms-worker's POST /send-raw. */
export async function sendRawMessage(
  workerUrl: string,
  simNumber: string,
  authPassword: string | null,
  text: string
): Promise<{ trackingId: string } | { error: string }> {
  try {
    const res = await fetch(`${workerUrl}/send-raw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simNumber, authPassword, text }),
    });
    if (!res.ok) return { error: await describeWorkerError(res) };
    const dispatch = (await res.json()) as { trackingId: string };
    return { trackingId: dispatch.trackingId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Dispatches a real open/close/status action via /send — the SAME endpoint
 * and same worker-side keyword computation every valve row's Open/Close/
 * Refresh button already uses. Prefer this over sendRawMessage() whenever
 * the intent is one of these three standard actions: it can never send the
 * wrong keyword, because the worker computes the text from its own config,
 * not from whatever string the caller guessed.
 */
export async function sendGatewayAction(
  workerUrl: string,
  simNumber: string,
  authPassword: string | null,
  action: "open" | "close" | "status",
  output?: 1 | 2
): Promise<{ trackingId: string } | { error: string }> {
  try {
    const res = await fetch(`${workerUrl}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simNumber, authPassword, action, output }),
    });
    if (!res.ok) return { error: await describeWorkerError(res) };
    const dispatch = (await res.json()) as { trackingId: string };
    return { trackingId: dispatch.trackingId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchRawSendStatus(
  workerUrl: string,
  trackingId: string
): Promise<RawSendStatus | null> {
  try {
    const res = await fetch(`${workerUrl}/status/${trackingId}`);
    if (!res.ok) return null;
    return (await res.json()) as RawSendStatus;
  } catch {
    return null;
  }
}
