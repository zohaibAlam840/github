/*
 * A stand-in for sms-worker, used only while recording the manual.
 *
 * Why this exists: with no worker running, the Topbar shows a red "Worker
 * offline" chip and the Modem page is a wall of red. A tutorial that opens
 * on a broken-looking system teaches the wrong thing — an operator needs to
 * learn what NORMAL looks like, so they can recognise abnormal.
 *
 * It answers the same endpoints the real worker does, with the real
 * SIM7600G-H's actual identity (taken from the bench unit on COM8), and
 * resolves commands on realistic timing. No serial port is opened and no
 * SMS is sent — there is no modem on the recording machine.
 *
 * It is NOT a test double for the queue: chapters that demonstrate failure
 * point the dashboard at a dead port instead, so those paths are exercised
 * for real rather than faked here.
 */

import { createServer, type Server } from "node:http";

export interface MockWorkerOptions {
  port: number;
  /** Fraction of commands that come back confirmed; the rest go unconfirmed. */
  confirmRate?: number;
}

/** The bench SIM7600G-H, so the Modem chapter shows real values. */
const MODEM = {
  state: "ready",
  reason: "SIMCOM_SIM7600G-H ready (signal 31/31, home)",
  checkedAt: new Date().toISOString(),
  comPort: "COM8",
  portLabel: "Simcom HS-USB AT PORT 9001 (COM8)",
  model: "SIMCOM_SIM7600G-H",
  manufacturer: "SIMCOM INCORPORATED",
  imei: "862636058407253",
  firmware: "LE20B04SIM7600G22",
  ownNumber: null, // genuinely absent on this SIM — the Modem chapter explains why
  operator: "Vodafone Vodafone",
  technology: "LTE",
  sim: "ready",
  registration: "home",
  signal: 31,
  smsc: "+97477922222",
  storage: { used: 0, total: 23 },
  failures: 0,
  lastSuccessAt: new Date().toISOString(),
};

const PORTS = [
  { comPort: "COM8", label: "Simcom HS-USB AT PORT 9001 (COM8)", active: true, skipped: false, reason: null },
  { comPort: "COM9", label: "Simcom HS-USB Diagnostics 9001 (COM9)", active: false, skipped: true, reason: "not an AT port" },
  { comPort: "COM10", label: "Simcom HS-USB Audio 9001 (COM10)", active: false, skipped: true, reason: "not an AT port" },
];

type Record_ = {
  status: "sent" | "success" | "unconfirmed" | "failed" | "no_response";
  events: { ts: string; message: string }[];
  replyText: string | null;
  relayState: "on" | "off" | "unknown" | null;
};

export function startMockWorker(opts: MockWorkerOptions): Promise<Server> {
  const confirmRate = opts.confirmRate ?? 1;
  const tracked = new Map<string, Record_>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    /*
     * CORS, exactly as the real worker does it.
     *
     * The Topbar chip and the Modem page fetch /health from the BROWSER,
     * not from the Next.js server — so it is a cross-origin request from
     * the dashboard's port to the worker's. Without these headers the
     * browser blocks it, the fetch fails, and the chip reads "Worker
     * offline" even though the worker is running and healthy. That is the
     * exact red chip this mock exists to avoid.
     */
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === "GET" && path === "/health") {
      return send(200, {
        ok: true,
        state: "ready",
        reason: MODEM.reason,
        detail: "Modem ready.",
        comPort: MODEM.comPort,
        // Must match the dashboard's Settings, or the Modem page correctly
        // warns about a mismatch — which would look like a fault on video.
        keywordOpen: "valveon",
        keywordClose: "valveoff",
        keywordStatus: "iostatus",
        modem: MODEM,
      });
    }

    if (req.method === "GET" && path === "/ports") return send(200, { ports: PORTS });
    if (req.method === "GET" && path === "/hardware") return send(200, { undriven: [], ports: PORTS });
    if (req.method === "POST" && path === "/rescan") return send(200, { modem: MODEM });
    if (req.method === "GET" && path === "/inbox") return send(200, { messages: [] });

    if (req.method === "POST" && path === "/test-sms") {
      return send(200, { ok: true, detail: "Test message accepted by the network." });
    }

    if (req.method === "POST" && path === "/send") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const trackingId = Math.random().toString(36).slice(2);
        const ts = () => new Date().toISOString();

        tracked.set(trackingId, {
          status: "sent",
          events: [
            { ts: ts(), message: `Sending command "${body.keyword}"...` },
            { ts: ts(), message: `Handed to the modem, tracking id ${trackingId}` },
          ],
          replyText: null,
          relayState: null,
        });

        /*
         * Resolve after a delay in the same range the real TRB141 takes to
         * answer. Instant success would make the progress list flash past
         * with nothing readable on it.
         */
        setTimeout(() => {
          const record = tracked.get(trackingId);
          if (!record) return;
          const confirmed = Math.random() < confirmRate;
          const relayState =
            body.action === "on" ? "on" : body.action === "off" ? "off" : "on";
          if (confirmed) {
            record.status = "success";
            record.relayState = relayState;
            record.replyText = relayState === "on" ? "Relay open" : "Relay closed";
            record.events.push({ ts: ts(), message: `Reply received: ${record.replyText}` });
          } else {
            record.status = "unconfirmed";
            record.events.push({ ts: ts(), message: "Sent. Confirmation skipped by request." });
          }
        }, 1800 + Math.random() * 1400);

        // 202 Accepted, exactly as the real worker answers - so the mock
        // cannot hide a status-code assumption in the dashboard.
        send(202, {
          trackingId,
          status: "sent",
          events: tracked.get(trackingId)!.events,
          replyText: null,
          relayState: null,
        });
      });
      return;
    }

    if (req.method === "GET" && path.startsWith("/status/")) {
      const record = tracked.get(path.slice("/status/".length));
      if (!record) return send(404, { error: "unknown tracking id" });
      return send(200, record);
    }

    send(404, { error: "not found" });
  });

  return new Promise((resolve) => {
    server.listen(opts.port, "127.0.0.1", () => {
      console.log(`[mock-worker] listening on http://127.0.0.1:${opts.port}`);
      resolve(server);
    });
  });
}
