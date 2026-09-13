/**
 * Server-Sent Events hub for the Next.js Route Handler at app/api/events —
 * every browser tab on the LAN subscribes here, replacing MockEngine's
 * in-memory emitter (which only ever reached the one tab that created it).
 * Route Handlers stream via ReadableStreamDefaultController, not a raw
 * node:http ServerResponse — this is the one piece that genuinely differs
 * from a plain http server.
 */

import type { AppEventMap } from "../types";

type Controller = ReadableStreamDefaultController<Uint8Array>;

const encoder = new TextEncoder();
const clients = new Set<Controller>();

export function addClient(controller: Controller) {
  clients.add(controller);
}

export function removeClient(controller: Controller) {
  clients.delete(controller);
}

export function broadcast<K extends keyof AppEventMap & string>(event: K, payload: AppEventMap[K]) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  const bytes = encoder.encode(line);
  for (const controller of clients) {
    try {
      controller.enqueue(bytes);
    } catch {
      // Client disconnected without firing its cancel() callback yet.
      clients.delete(controller);
    }
  }
}
