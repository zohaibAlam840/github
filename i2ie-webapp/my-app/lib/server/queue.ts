/**
 * The single-lane paced command queue — ported faithfully from the old
 * client-side lib/mock/engine.ts (same constants, same demo-mode
 * randomness, same real-worker dispatch/poll path), now living once in the
 * Next.js server process instead of duplicated per browser tab. This fixes
 * a real gap the old design had: two tabs open on the same command each ran
 * their own independent poll loop against the worker; here there is
 * exactly one, system-wide.
 *
 * "Real" mode (settings.workerUrl set) talks to sms-worker's /send and
 * /status/:id exactly like before — see sms-worker/src/confirmationTracker.ts
 * for why that's async dispatch-then-poll instead of one long-held request.
 */

import type { Repo } from "./repo";
import { broadcast } from "./events";
import type { Command, CommandAction, CommandStatus, PingResult, Valve, ValveStatus } from "../types";
import { DEFAULT_WORKER_URL, describeWorkerError } from "../workerStatus";

/**
 * The worker answered and refused. Distinct from a network error, because
 * the operator-facing sentence is completely different: "the modem is not
 * plugged in" versus "the worker process is not running".
 */
class WorkerRejected extends Error {}

/**
 * Thrown when a valve already has a command in flight.
 *
 * The bulk path skipped busy valves, but the single-valve path did not — so
 * a second command overwrote valves.pending_command_id and ORPHANED the
 * first, which then sat "Pending" until its ceiling with nothing able to
 * clear it. The buttons are disabled while pending, but that is a UI
 * courtesy, not a guarantee: the API is reachable directly, and two tabs
 * can race.
 */
export class CommandInFlight extends Error {}

const REPLY_MIN_MS = 900;
const REPLY_MAX_MS = 3200;
const P_SEND_FAIL = 0.05;
const P_NO_REPLY = 0.07;

const now = () => new Date().toISOString();
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createQueueEngine(repo: Repo) {
  const pending: number[] = []; // command ids waiting for the lane
  let processing = false;
  let processingId: number | null = null;

  function emitCommand(command: Command) {
    broadcast("command:update", { command });
  }

  function emitQueueState() {
    broadcast("queue:update", { queued: pending.length, processingId });
  }

  function logActivity(
    kind: Parameters<Repo["insertActivity"]>[0]["kind"],
    valve: Valve | null,
    userName: string | null,
    action: CommandAction | null,
    valveStatus: ValveStatus | null
  ) {
    const ctx = valve ? repo.valveActivityContext(valve.id) : null;
    const event = repo.insertActivity({
      kind,
      valveCode: ctx?.valveCode ?? valve?.valveCode ?? null,
      buildingName: ctx?.buildingName ?? null,
      userName,
      action,
      valveStatus,
    });
    broadcast("activity", { event });
  }

  function finishValvePending(valve: Valve) {
    repo.setValvePending(valve.id, null);
  }

  /**
   * The exact SMS keyword for one action on one valve.
   *
   * One function, used both for the audit log and for what is sent to the
   * worker, so the record and the radio can never disagree. They did before:
   * the log was written from these settings while the worker sent keywords
   * from its own environment, and the two had different defaults.
   */
  function keywordFor(action: CommandAction, valve: Valve): string {
    const s = repo.getSettings();
    const template =
      action === "status" ? s.keywordStatus : action === "on" ? s.keywordOpen : s.keywordClose;
    return template.replace("{output}", String(valve.outputIndex));
  }

  /* ---------- queueing ---------- */

  function queueCommand(valveId: number, action: CommandAction, userId: number, userName: string): Command {
    const valve = repo.getValve(valveId);
    if (!valve) throw new Error("Valve not found");
    if (valve.pendingCommandId !== null) {
      throw new CommandInFlight(
        `${valve.valveCode} is already waiting on a command. Let it finish, or press Stop on it first.`
      );
    }
    const gateway = repo.getGateway(valve.gatewayId);
    const settings = repo.getSettings();

    const keyword = keywordFor(action, valve);

    const command = repo.createCommand({
      valveId,
      userId,
      userName,
      action,
      commandText: gateway?.authPassword ? `**** ${keyword}` : keyword,
    });
    repo.setValvePending(valveId, command.id);

    pending.push(command.id);
    logActivity("queued", valve, userName, action, null);
    emitCommand(command);
    emitQueueState();
    void processQueue();
    return command;
  }

  function queueBulkCommand(valveIds: number[], action: CommandAction, userId: number, userName: string): Command[] {
    // Wrapped in one transaction — see repo.transaction's own comment.
    // Without this, N queued valves means N × several auto-committed
    // statements, each with its own disk sync; measured at ~60x slower
    // for a 200-valve batch (5.2s vs 86ms).
    return repo.transaction(() => {
      const queued: Command[] = [];
      for (const valveId of valveIds) {
        const valve = repo.getValve(valveId);
        if (!valve || valve.pendingCommandId !== null) continue;
        queued.push(queueCommand(valveId, action, userId, userName));
      }
      return queued;
    });
  }

  /**
   * Stop waiting on a command.
   *
   * It is important to be precise about what this does and does not do. A
   * command still queued has not been sent, so cancelling it is complete.
   * One already dispatched HAS left the modem — GSM has no recall — so all
   * we can honestly do is stop waiting for the reply and say so. The status
   * is "cancelled", never "failed", because the valve may well have acted.
   *
   * The poll loop needs no signal: it re-reads the command each tick and
   * exits on any status other than "sent", so this write ends it.
   */
  function cancelCommand(commandId: number, userName: string): Command | null {
    const command = repo.getCommand(commandId);
    if (!command) return null;
    if (command.status !== "pending" && command.status !== "sent") return command;

    /*
     * Whether the SMS actually left is the command's own status, NOT whether
     * it is still in the pending array. processQueue() shifts an id off that
     * array the moment it starts working on it, so a command mid-dispatch
     * reads as "not queued" and we would tell the operator an SMS had gone
     * out when none had. Status "sent" is set immediately before the send.
     */
    const alreadySent = command.status === "sent";
    const queuedIndex = pending.indexOf(commandId);
    if (queuedIndex !== -1) pending.splice(queuedIndex, 1);

    const events = [
      ...(command.events ?? []),
      {
        ts: now(),
        message: alreadySent
          ? `Stopped by ${userName}. The SMS had already been sent, so the valve may still act; ` +
            `we simply stopped waiting for the reply. Press Check status now to find out.`
          : `Cancelled by ${userName} before it was sent — no SMS went out.`,
      },
    ];

    repo.updateCommand(commandId, { status: "cancelled", events });
    const valve = repo.getValve(command.valveId);
    if (valve) {
      finishValvePending(valve);
      // A dispatched command leaves the valve's real state genuinely unknown.
      if (alreadySent && command.action !== "status") {
        repo.setValveStatus(valve.id, valve.lastStatus, true, false);
      }
      broadcast("valve:update", {
        valve: { ...valve, statusVerified: false, pendingCommandId: null },
        source: "timeout",
      });
      logActivity("cancelled", valve, userName, command.action, null);
    }

    const updated = { ...command, status: "cancelled" as CommandStatus, events };
    emitCommand(updated);
    emitQueueState();
    return updated;
  }

  /* ---------- the lane ---------- */

  async function processQueue() {
    if (processing) return;
    processing = true;
    while (pending.length > 0) {
      const id = pending.shift()!;
      processingId = id;
      emitQueueState();
      await processOne(id);
      processingId = null;
      emitQueueState();
      await sleep(repo.getSettings().sendGapMs);
    }
    processing = false;
  }

  async function processOne(commandId: number) {
    const command = repo.getCommand(commandId);
    if (!command) return;
    const valve = repo.getValve(command.valveId);
    if (!valve) return;

    const settings = repo.getSettings();
    /*
     * Simulation happens ONLY when someone asked for it.
     *
     * This used to read "if (settings.workerUrl)", so a blank address chose
     * the simulator — the dashboard invented successes and no SMS left the
     * building. Now an unset address falls back to where the worker actually
     * listens, and if nothing is there the command FAILS and says so. An
     * honest error beats a fabricated success on a system controlling real
     * valves.
     */
    if (settings.demoMode) {
      await processOneSimulated(command, valve, settings.maxRetries, settings.replyTimeoutMs, settings.confirmAfterCommand);
      return;
    }
    await processOneReal(command, valve, settings.workerUrl ?? DEFAULT_WORKER_URL, settings.confirmAfterCommand);
  }

  async function processOneSimulated(
    command: Command,
    valve: Valve,
    maxRetries: number,
    replyTimeoutMs: number,
    confirmAfterCommand: boolean
  ) {
    const events: { ts: string; message: string }[] = [];
    /*
     * Every line is prefixed, not just the first.
     *
     * This path invents its outcome with Math.random() and a 300-800ms
     * sleep. Read without the prefix, its trail is indistinguishable from a
     * real dispatch — "Command accepted by modem" over a modem that was
     * never contacted. On a handed-over system that is the worst thing this
     * dashboard could say, so the label goes on the messages themselves
     * rather than on a chip somewhere else on the screen that an operator
     * reading the command modal will never see.
     */
    const logEvent = (message: string) => {
      events.push({ ts: now(), message: `[DEMO] ${message}` });
      repo.updateCommand(command.id, { events: [...events] });
      emitCommand({ ...command, events: [...events] });
    };

    logEvent(
      "No worker address is set, so NO SMS IS BEING SENT. Everything below is " +
        "simulated. Set the worker address on the Modem page to control real valves."
    );
    logEvent("Sending command SMS...");
    let sent = false;
    let retries = 0;
    while (!sent && retries <= maxRetries) {
      await sleep(rand(300, 800));
      if (Math.random() < P_SEND_FAIL) {
        retries += 1;
        logEvent(`Send attempt failed, retrying (${retries}/${maxRetries})...`);
      } else {
        sent = true;
      }
    }
    if (!sent) {
      repo.updateCommand(command.id, { status: "failed", retries, events });
      logEvent("Send failed after all retries.");
      finishValvePending(valve);
      logActivity("failed", valve, command.userName, command.action, null);
      emitCommand({ ...command, status: "failed", retries, events });
      return;
    }

    const sentAt = now();
    repo.updateCommand(command.id, { status: "sent", sentAt, retries, events });
    logActivity("sent", valve, command.userName, command.action, null);

    if (command.action !== "status" && !confirmAfterCommand) {
      const assumedStatus: ValveStatus = command.action === "on" ? "on" : "off";
      logEvent("Command accepted by modem. Confirmation skipped (disabled in Settings) — not verified.");
      repo.updateCommand(command.id, { status: "unconfirmed", events });
      // Assumed, not verified: nothing replied. The valve row shows this
      // as such until a Refresh actually confirms it.
      repo.setValveStatus(valve.id, assumedStatus, true, false);
      finishValvePending(valve);
      broadcast("valve:update", { valve: { ...valve, lastStatus: assumedStatus, statusVerified: false, pendingCommandId: null }, source: "reply" });
      logActivity("unconfirmed", valve, command.userName, command.action, assumedStatus);
      emitCommand({ ...command, status: "unconfirmed", events });
      return;
    }
    logEvent("Command accepted by modem. Waiting for reply...");

    if (Math.random() < P_NO_REPLY) {
      await sleep(replyTimeoutMs);
      repo.updateCommand(command.id, { status: "no_response", events });
      repo.setValveStatus(valve.id, "unknown", false);
      logEvent(`No reply after ${replyTimeoutMs}ms — giving up.`);
      finishValvePending(valve);
      broadcast("valve:update", { valve: { ...valve, lastStatus: "unknown", statusVerified: true, pendingCommandId: null }, source: "timeout" });
      logActivity("timeout", valve, command.userName, command.action, "unknown");
      emitCommand({ ...command, status: "no_response", events });
      return;
    }

    await sleep(rand(REPLY_MIN_MS, REPLY_MAX_MS));

    const newStatus: ValveStatus =
      command.action === "on"
        ? "on"
        : command.action === "off"
          ? "off"
          : valve.lastStatus === "unknown"
            ? Math.random() < 0.5
              ? "on"
              : "off"
            : valve.lastStatus;

    const replyText = `V${valve.outputIndex}=${newStatus === "on" ? "ON" : "OFF"}`;
    const replyAt = now();
    repo.updateCommand(command.id, { status: "success", replyText, replyAt, events });
    repo.setValveStatus(valve.id, newStatus, true);
    if (valve.gatewayId) repo.setGatewayReachability(valve.gatewayId, "ok", true);

    logEvent(`Reply received: "${replyText}" — confirmed.`);
    finishValvePending(valve);
    broadcast("valve:update", { valve: { ...valve, lastStatus: newStatus, pendingCommandId: null }, source: "reply" });
    logActivity("reply", valve, command.userName, command.action, newStatus);
    emitCommand({ ...command, status: "success", replyText, replyAt, events });
  }

  /**
   * Shared terminal-outcome handling for the real-worker path — used both
   * when /send itself already comes back resolved (confirmation disabled,
   * so there's nothing to poll for) and when pollWorkerStatus later gets a
   * terminal result. Keeping this in one place means "what does a success/
   * unconfirmed/no_response/failed outcome actually DO to the valve" is
   * never at risk of drifting between the two call sites.
   */
  function applyRealTerminal(
    commandId: number,
    action: CommandAction,
    userName: string,
    record: {
      status: CommandStatus;
      events: { ts: string; message: string }[];
      replyText: string | null;
      relayState: ValveStatus | null;
    }
  ) {
    const replyAt = now();
    repo.updateCommand(commandId, {
      status: record.status,
      replyText: record.replyText,
      replyAt,
      events: record.events,
    });

    const valve = repo.getValve(repo.getCommand(commandId)?.valveId ?? -1);
    if (valve) {
      if (record.status === "success" && record.relayState && record.relayState !== "unknown") {
        repo.setValveStatus(valve.id, record.relayState, true);
        if (valve.gatewayId) repo.setGatewayReachability(valve.gatewayId, "ok", true);
        finishValvePending(valve);
        broadcast("valve:update", { valve: { ...valve, lastStatus: record.relayState, statusVerified: true, pendingCommandId: null }, source: "reply" });
        logActivity("reply", valve, userName, action, record.relayState);
      } else if (record.status === "unconfirmed") {
        const assumedStatus: ValveStatus = action === "on" ? "on" : action === "off" ? "off" : valve.lastStatus;
        // Assumed, not verified: nothing replied. The valve row shows this
      // as such until a Refresh actually confirms it.
      repo.setValveStatus(valve.id, assumedStatus, true, false);
        finishValvePending(valve);
        broadcast("valve:update", { valve: { ...valve, lastStatus: assumedStatus, statusVerified: false, pendingCommandId: null }, source: "reply" });
        logActivity("unconfirmed", valve, userName, action, assumedStatus);
      } else if (record.status === "no_response") {
        repo.setValveStatus(valve.id, "unknown", false);
        finishValvePending(valve);
        broadcast("valve:update", { valve: { ...valve, lastStatus: "unknown", statusVerified: true, pendingCommandId: null }, source: "timeout" });
        logActivity("timeout", valve, userName, action, "unknown");
      } else {
        finishValvePending(valve);
        logActivity("failed", valve, userName, action, null);
      }
    }
    emitCommand({ ...(repo.getCommand(commandId) as Command) });
  }

  async function processOneReal(command: Command, valve: Valve, workerUrl: string, confirmAfterCommand: boolean) {
    const gateway = repo.getGateway(valve.gatewayId);
    if (!gateway) {
      repo.updateCommand(command.id, { status: "failed" });
      finishValvePending(valve);
      logActivity("failed", valve, command.userName, command.action, null);
      emitCommand({ ...command, status: "failed" });
      return;
    }

    const sentAt = now();
    repo.updateCommand(command.id, { status: "sent", sentAt, events: [] });
    emitCommand({ ...command, status: "sent", sentAt, events: [] });
    logActivity("sent", valve, command.userName, command.action, null);

    try {
      const res = await fetch(`${workerUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simNumber: gateway.simNumber,
          authPassword: gateway.authPassword,
          action: command.action,
          output: valve.outputIndex,
          // Irrelevant for a plain status query (already a single message) —
          // only open/close have a confirmation step to skip.
          confirm: command.action === "status" ? true : confirmAfterCommand,
          // Settings is the single source of truth for keywords. Without
          // these the worker fell back to its own environment, which had
          // DIFFERENT defaults — so the audit log recorded "v1on" while
          // "valveon" actually went out over the air.
          keyword: keywordFor(command.action, valve),
          statusKeyword: keywordFor("status", valve),
        }),
      });
      // The worker's own words, not the status code. A 503 here means the
      // worker answered and told us the modem is missing — reporting that as
      // "could not reach the worker" sends whoever is troubleshooting to the
      // wrong machine entirely.
      if (!res.ok) throw new WorkerRejected(await describeWorkerError(res));

      const dispatch = (await res.json()) as {
        trackingId: string;
        status: "sent" | "success" | "failed" | "no_response" | "unconfirmed";
        events: { ts: string; message: string }[];
        replyText: string | null;
        relayState: ValveStatus | null;
      };

      repo.updateCommand(command.id, { workerTrackingId: dispatch.trackingId, events: dispatch.events });
      emitCommand({ ...command, status: "sent", sentAt, workerTrackingId: dispatch.trackingId, events: dispatch.events });

      if (dispatch.status !== "sent") {
        // Already resolved — e.g. confirmation was skipped, or the send
        // itself failed. Nothing to poll for.
        applyRealTerminal(command.id, command.action, command.userName, dispatch);
        return;
      }

      // Dispatch is fast (a few seconds); confirmation can take minutes, so
      // this command's place in the single lane doesn't hold on it — the
      // poll runs independently.
      void pollWorkerStatus(command.id, dispatch.trackingId, workerUrl);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const events = [
        {
          ts: now(),
          message: err instanceof WorkerRejected ? error : `Could not reach the worker: ${error}`,
        },
      ];
      repo.updateCommand(command.id, { status: "failed", replyText: error, replyAt: now(), events });
      finishValvePending(valve);
      logActivity("failed", valve, command.userName, command.action, null);
      emitCommand({ ...command, status: "failed", replyText: error, events });
    }
  }

  async function pollWorkerStatus(commandId: number, trackingId: string, workerUrl: string) {
    const POLL_MS = 4000;
    const poll = async () => {
      const command = repo.getCommand(commandId);
      if (!command || command.status !== "sent") return;

      try {
        const res = await fetch(`${workerUrl}/status/${trackingId}`);
        if (!res.ok) {
          // Unknown/expired tracking id — most commonly the worker process
          // restarted mid-wait and lost its in-memory tracker (see
          // sms-worker/src/confirmationTracker.ts's Map). Treat it as a
          // real terminal failure instead of silently giving up, so the
          // command is never stuck showing "Pending" forever with nothing
          // to explain why.
          applyRealTerminal(commandId, command.action, command.userName, {
            status: "no_response",
            events: command.events ?? [],
            replyText: "Lost contact with the worker while waiting for a reply (it may have restarted).",
            relayState: null,
          });
          return;
        }

        const record = (await res.json()) as {
          status: "sent" | "success" | "failed" | "no_response" | "unconfirmed";
          events: { ts: string; message: string }[];
          replyText: string | null;
          relayState: ValveStatus | null;
        };

        if (record.status === "sent") {
          repo.updateCommand(commandId, { events: record.events });
          emitCommand({ ...command, events: record.events });
          setTimeout(poll, POLL_MS);
          return;
        }

        applyRealTerminal(commandId, command.action, command.userName, record);
      } catch {
        // Network hiccup reaching the worker — retry rather than give up;
        // the worker is the source of truth on timing, not this poll loop.
        setTimeout(poll, POLL_MS);
      }
    };
    void poll();
  }

  /* ---------- ping ---------- */

  async function pingGateway(gatewayId: number): Promise<PingResult> {
    const gateway = repo.getGateway(gatewayId);
    if (!gateway) return { gatewayId, ok: false, replyText: null, roundTripMs: null };

    const settings = repo.getSettings();
    if (!settings.demoMode) {
      return pingGatewayReal(gateway.id, gateway.simNumber, gateway.authPassword, settings.workerUrl ?? DEFAULT_WORKER_URL);
    }

    const started = Date.now();
    await sleep(rand(1500, 3200));
    const ok = Math.random() < 0.9;
    repo.setGatewayReachability(gatewayId, ok ? "ok" : "unreachable", ok);
    logActivity("ping", null, null, null, null);
    return {
      gatewayId,
      ok,
      // Labelled for the same reason the command trail is: an unlabelled
      // "GSM: OK, IO: V1=ON;V2=OFF" is indistinguishable from a real TRB141
      // reply, and Ping is the button people press to decide whether a
      // gateway is genuinely answering.
      replyText: ok ? "[DEMO — no SMS sent] GSM: OK, IO: V1=ON;V2=OFF" : null,
      roundTripMs: ok ? Date.now() - started : null,
    };
  }

  async function pingGatewayReal(
    gatewayId: number,
    simNumber: string,
    authPassword: string | null,
    workerUrl: string
  ): Promise<PingResult> {
    const started = Date.now();
    try {
      const res = await fetch(`${workerUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simNumber,
          authPassword,
          action: "status",
          // Same source of truth as every other dispatch. A ping is not tied
          // to one valve, so a per-output template resolves against output 1.
          statusKeyword: repo.getSettings().keywordStatus.replace("{output}", "1"),
        }),
      });
      // The worker's own words, not the status code. A 503 here means the
      // worker answered and told us the modem is missing — reporting that as
      // "could not reach the worker" sends whoever is troubleshooting to the
      // wrong machine entirely.
      if (!res.ok) throw new WorkerRejected(await describeWorkerError(res));
      const dispatch = (await res.json()) as { trackingId: string };

      const result = await waitForPingResult(dispatch.trackingId, workerUrl, 45_000);
      const ok = result?.status === "success";
      repo.setGatewayReachability(gatewayId, ok ? "ok" : "unreachable", ok);
      logActivity("ping", null, null, null, null);
      return {
        gatewayId,
        ok,
        replyText: result?.replyText ?? null,
        roundTripMs: ok ? Date.now() - started : null,
      };
    } catch (err) {
      repo.setGatewayReachability(gatewayId, "unreachable", false);
      logActivity("ping", null, null, null, null);
      return {
        gatewayId,
        ok: false,
        replyText: err instanceof Error ? err.message : String(err),
        roundTripMs: null,
      };
    }
  }

  async function waitForPingResult(
    trackingId: string,
    workerUrl: string,
    timeoutMs: number
  ): Promise<{ status: string; replyText: string | null } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${workerUrl}/status/${trackingId}`);
        if (res.ok) {
          const record = (await res.json()) as { status: string; replyText: string | null };
          if (record.status !== "sent") return record;
        }
      } catch {
        // transient — keep polling until the deadline
      }
      await sleep(2000);
    }
    return null;
  }

  /* ---------- startup resume ---------- */

  /**
   * Re-adopts anything left mid-flight after a server restart — a real
   * command-queue-owning process instead of relying on whichever browser
   * tab happens to reload next (the old MockEngine design's actual weak
   * point, since the queue lived in the browser).
   */
  function resumeOnStartup() {
    const stuckPending = repo.listStuckPending();
    for (const command of stuckPending) pending.push(command.id);
    if (pending.length > 0) void processQueue();

    const settings = repo.getSettings();
    if (!settings.workerUrl) return;
    for (const command of repo.listStuckSent()) {
      if (command.workerTrackingId) void pollWorkerStatus(command.id, command.workerTrackingId, settings.workerUrl);
    }
  }

  return { queueCommand, queueBulkCommand, cancelCommand, pingGateway, resumeOnStartup };
}

export type QueueEngine = ReturnType<typeof createQueueEngine>;
