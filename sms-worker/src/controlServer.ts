/**
 * Local control server — three jobs, one small HTTP server:
 *
 *   POST /send          — the Next.js dashboard (running on localhost, a
 *                          different port) calls this directly to dispatch a
 *                          REAL command. Everything runs on the office PC:
 *                          dashboard -> this worker -> SIM7600 -> real
 *                          TRB141, with no cloud service in the path.
 *   GET  /status/:id    — poll the outcome of a /send call. /send returns
 *                          almost immediately (does NOT wait for the TRB's
 *                          reply, which can take minutes); the dashboard
 *                          polls this endpoint for progress instead of
 *                          holding one HTTP request open the whole time —
 *                          see confirmationTracker.ts for why.
 *   GET  /health        — the modem's live state: which port, which module,
 *                          SIM, signal, registration, service centre. Reads a
 *                          stored snapshot and performs no serial I/O — every
 *                          dashboard tab polls it every 10s, and the modem
 *                          has only one shared line.
 *   GET  /inbox         — every SMS this worker has ever sent OR received
 *                          (any TRB), newest first, tagged
 *                          direction:"sent"|"received" — the full exchange,
 *                          not just replies. The dashboard filters this by
 *                          SIM number per gateway for its Inbox card. See
 *                          inbox.ts.
 *   POST /send-raw      — like /send, but the caller supplies the exact SMS
 *                          text instead of picking open/close/status (the
 *                          Inbox page's ad-hoc "send a message" composer —
 *                          for testing a rule/keyword directly without
 *                          waiting on the fixed action buttons). Same
 *                          single-message-then-wait-for-reply path as a
 *                          plain status query; the password prefix is still
 *                          applied automatically if the gateway has one.
 *
 * CORS is wide open (Access-Control-Allow-Origin: *) because this only ever
 * runs on a trusted local machine during bench testing — not something to
 * carry into a real deployment without tightening it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SmsTransport } from "./transports/types.js";
import type { ModemSupervisor } from "./transports/supervisor.js";
import { findUndrivenModems } from "./hardware/windowsPnp.js";
import { normalizeNumber, type RelayState } from "./commands.js";
import { dispatchAndTrack, getRecord } from "./confirmationTracker.js";
import { getInbox, recordOutgoing } from "./inbox.js";
import type { WorkerConfig } from "./config.js";

function withCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

interface SendRequestBody {
  simNumber: string;
  authPassword?: string | null;
  action: "open" | "close" | "status";
  output?: 1 | 2;
  /** Default true. false = skip the confirmation SMS entirely (open/close only). */
  confirm?: boolean;
}

/** Answers a request whose handler threw, instead of leaving it hanging. */
function failed(res: ServerResponse, route: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[controlServer] ${route} failed:`, message);
  if (res.headersSent) return;
  res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }));
}

export function startControlServer(config: WorkerConfig, supervisor: ModemSupervisor) {
  /**
   * The modem can come and go while the process runs, so every handler asks
   * for it rather than capturing one at startup. Returns null and answers 503
   * when there is nothing usable — a clear "no modem" beats a confusing
   * failure further down.
   */
  const requireTransport = (res: ServerResponse): SmsTransport | null => {
    // Note this returns the SUPERVISOR, not the underlying modem. Anything
    // that subscribes for a reply has to survive the modem being replaced by
    // recovery mid-command — see the class comment in supervisor.ts.
    if (!supervisor.current()) {
      const health = supervisor.health();
      res.writeHead(503, { "Content-Type": "application/json" }).end(
        JSON.stringify({ error: "No modem available", state: health.state, reason: health.reason })
      );
      return null;
    }
    return supervisor;
  };
  const server = createServer((req, res) => {
    withCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    // Route on the PATH only. Matching req.url exactly meant an ordinary
    // cache-buster ("/health?t=1699") fell through to the 404 handler.
    const path = (req.url ?? "").split("?")[0];

    if (req.method === "GET" && path === "/health") {
      const health = supervisor.health();
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          ok: health.state === "ready",
          // The modem's real state, promoted to the top level so a caller
          // cannot read this payload and conclude "connected" without
          // opening the nested object. It used to say transport:"router"
          // unconditionally, which made the dashboard show a healthy green
          // chip over a machine with nothing plugged into it.
          state: health.state,
          reason: health.reason,
          detail: health.reason,
          comPort: health.comPort,
          modem: health,
          // The worker's OWN keywords — the ones actually used for every
          // dispatch. The dashboard has a separate copy that nothing syncs,
          // so showing these avoids acting on a value that will not be sent.
          keywordOpen: config.keywordOpen,
          keywordClose: config.keywordClose,
          keywordStatus: config.keywordStatus,
        })
      );
      return;
    }

    // Both of these talk to hardware or to PowerShell, so both can reject.
    // Without a catch the request simply never answers: the browser spins
    // until it times out, and Node logs an unhandled rejection nobody sees.
    if (req.method === "POST" && path === "/rescan") {
      supervisor
        .rescan()
        .then((health) => {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(health));
        })
        .catch((err) => failed(res, "/rescan", err));
      return;
    }

    if (req.method === "GET" && path === "/hardware") {
      findUndrivenModems()
        .then((devices) => {
          res.writeHead(200, { "Content-Type": "application/json" }).end(
            JSON.stringify({ undriven: devices, modem: supervisor.health() })
          );
        })
        .catch((err) => failed(res, "/hardware", err));
      return;
    }

    if (req.method === "GET" && path === "/ports") {
      supervisor
        .ports()
        .then((ports) => {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ports }));
        })
        .catch((err) => failed(res, "/ports", err));
      return;
    }

    // Sends ONE real SMS to a number the caller supplies, and reports what the
    // modem said. Deliberately separate from /send: this proves the modem can
    // reach the network, with no gateway, no keywords and no confirmation
    // logic in the way — so when a valve command fails, this answers "is it
    // the modem or is it the TRB?" in one click.
    if (req.method === "POST" && path === "/test-sms") {
      readJsonBody(req)
        .then(async (body) => {
          const { toNumber, text } = body as { toNumber?: string; text?: string };
          if (!toNumber) {
            res.writeHead(400, { "Content-Type": "application/json" }).end(
              JSON.stringify({ error: "toNumber is required" })
            );
            return;
          }
          const live = requireTransport(res);
          if (!live) {
            console.warn(`[controlServer] /test-sms rejected: ${supervisor.health().reason}`);
            return;
          }

          const to = normalizeNumber(toNumber);
          const message = text?.trim() || `i2i test ${new Date().toISOString().slice(11, 19)}`;
          console.log(`[controlServer] /test-sms "${message}" -> ${to}`);
          const result = await live.send(to, message);
          recordOutgoing(to, message);

          res.writeHead(result.ok ? 200 : 502, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              ok: result.ok,
              toNumber: to,
              text: message,
              providerId: result.providerId ?? null,
              // On failure this is already a sentence naming the likely cause
              // and who can fix it — see describeAtError in serialModem.ts.
              error: result.error ?? null,
            })
          );
        })
        .catch((err) => failed(res, "/test-sms", err));
      return;
    }

    if (req.method === "GET" && path === "/inbox") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(getInbox()));
      return;
    }

    if (req.method === "POST" && path === "/send") {
      readJsonBody(req)
        .then(async (body) => {
          const { simNumber, authPassword, action, output, confirm } = body as SendRequestBody;
          console.log(`[controlServer] /send received: ${action} -> ${simNumber} (output ${output ?? 1})`);
          if (!simNumber || !action) {
            console.warn("[controlServer] /send rejected: missing simNumber or action");
            res.writeHead(400, { "Content-Type": "application/json" }).end(
              JSON.stringify({ error: "simNumber and action are required" })
            );
            return;
          }

          // Checked before any of the dispatch logging below, so the console
          // never claims to have sent something it could not send.
          const live = requireTransport(res);
          if (!live) {
            console.warn(`[controlServer] /send rejected: ${supervisor.health().reason}`);
            return;
          }

          const outIdx = output ?? 1;
          // {output} is substituted in ALL THREE keywords. It used to be done
          // for open and close only, so a deployment whose status rule is
          // per-output ("iostatus{output}") sent the literal text "{output}"
          // over the air and got no reply, with nothing to explain why.
          const fill = (k: string) => k.replace("{output}", String(outIdx));
          const statusKeyword = fill(config.keywordStatus);
          const keyword =
            action === "open"
              ? fill(config.keywordOpen)
              : action === "close"
                ? fill(config.keywordClose)
                : statusKeyword;

          const gateway = { simNumber, authPassword: authPassword ?? null };
          const expectedState: RelayState | undefined =
            action === "open" ? "closed" : action === "close" ? "open" : undefined;
          // Bench mapping confirmed on this project's TRB: valveon -> relay
          // Closed, valveoff -> relay Open. See memory i2i-valve-system.md.

          const willConfirm = confirm ?? true;
          console.log(
            willConfirm
              ? `[controlServer] Dispatching "${keyword}" then "${statusKeyword}" to ${simNumber}...`
              : `[controlServer] Dispatching "${keyword}" to ${simNumber} (confirmation skipped by request)...`
          );
          // Returns as soon as the SMS is accepted — confirmation (if
          // requested) continues in the background. Poll GET /status/:id.
          const record = await dispatchAndTrack(
            live,
            gateway,
            action,
            keyword,
            statusKeyword,
            { expectedState, confirm: willConfirm }
          );
          console.log(`[controlServer] Dispatched, tracking id ${record.id}, status ${record.status}`);

          res.writeHead(202, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              trackingId: record.id,
              status: record.status,
              events: record.events,
              replyText: record.replyText,
              relayState: record.relayState,
            })
          );
        })
        .catch((err) => {
          console.error("[controlServer] /send failed:", err);
          res.writeHead(500, { "Content-Type": "application/json" }).end(
            JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
          );
        });
      return;
    }

    if (req.method === "POST" && path === "/send-raw") {
      readJsonBody(req)
        .then(async (body) => {
          const { simNumber, authPassword, text } = body as {
            simNumber: string;
            authPassword?: string | null;
            text: string;
          };
          console.log(`[controlServer] /send-raw received: "${text}" -> ${simNumber}`);
          if (!simNumber || !text) {
            res.writeHead(400, { "Content-Type": "application/json" }).end(
              JSON.stringify({ error: "simNumber and text are required" })
            );
            return;
          }

          const gateway = { simNumber, authPassword: authPassword ?? null };
          // Reuses dispatchAndTrack's "status" branch — one message out, no
          // assumption about what it does, any reply back is the result.
          // Passing text as both keyword args is deliberate: that branch
          // only ever reads the second (statusKeyword) one.
          const live = requireTransport(res);
          if (!live) return;
          const record = await dispatchAndTrack(
            live, gateway, "status", text, text, {});

          res.writeHead(202, { "Content-Type": "application/json" }).end(
            JSON.stringify({ trackingId: record.id, status: record.status, events: record.events })
          );
        })
        .catch((err) => {
          console.error("[controlServer] /send-raw failed:", err);
          res.writeHead(500, { "Content-Type": "application/json" }).end(
            JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
          );
        });
      return;
    }

    if (req.method === "GET" && path.startsWith("/status/")) {
      const id = path.slice("/status/".length);
      const record = getRecord(id);
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" }).end(
          JSON.stringify({ error: "Unknown tracking id (may have expired)" })
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(record));
      return;
    }

    res.writeHead(404).end();
  });

  // An http.Server is an EventEmitter: an 'error' with no listener is thrown
  // and takes the whole worker down with a stack trace. The common case is a
  // second copy already running, which on the office PC is exactly the sort
  // of thing that needs a sentence, not a crash dump.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n[controlServer] Port ${config.controlPort} is already in use.\n` +
          `  Another copy of this worker is probably already running.\n` +
          `  Close it, or set CONTROL_PORT to a different port.\n`
      );
    } else {
      console.error(`[controlServer] Server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(config.controlPort, () => {
    console.log(`[controlServer] Listening on http://localhost:${config.controlPort}`);
    console.log(`  POST /send        <- dashboard calls this for real commands`);
  });

  return server;
}
