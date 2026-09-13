/*
 * Live-events layer — the ONLY place the UI subscribes to real-time updates.
 *
 * Backed by a real Server-Sent Events stream (GET /api/events) from the
 * Next.js server — see lib/server/events.ts for the broadcaster and
 * lib/server/queue.ts for what actually emits these. Event names/payloads
 * are the AppEventMap contract in lib/types.ts and MUST NOT drift from it.
 */

import type { AppEventMap } from "./types";
import { getAuthToken } from "./api";

export type Unsubscribe = () => void;
export type { AppEventMap } from "./types";

type AnyListener = (payload: unknown) => void;

const EVENT_NAMES: (keyof AppEventMap & string)[] = ["command:update", "valve:update", "queue:update", "activity"];
const listeners = new Map<string, Set<AnyListener>>();

let source: EventSource | null = null;

function dispatch(eventName: string, raw: MessageEvent) {
  const set = listeners.get(eventName);
  if (!set || set.size === 0) return;
  let payload: unknown;
  try {
    payload = JSON.parse(raw.data);
  } catch {
    return;
  }
  for (const cb of set) {
    try {
      cb(payload);
    } catch {
      // A broken listener must never take down the stream.
    }
  }
}

function connect() {
  if (typeof window === "undefined" || source) return;
  const token = getAuthToken();
  if (!token) return;
  const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  for (const name of EVENT_NAMES) {
    es.addEventListener(name, (evt) => dispatch(name, evt as MessageEvent));
  }
  source = es;
}

/** Called from auth.tsx right after a successful login (fresh token available). */
export function connectEventStream() {
  connect();
}

/** Called from auth.tsx on logout — no point holding a stream open for nobody. */
export function disconnectEventStream() {
  source?.close();
  source = null;
}

export function onAppEvent<K extends keyof AppEventMap & string>(
  event: K,
  cb: (payload: AppEventMap[K]) => void
): Unsubscribe {
  connect(); // no-op if already connected or no token yet
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  const wrapped = cb as AnyListener;
  set.add(wrapped);
  return () => set!.delete(wrapped);
}
