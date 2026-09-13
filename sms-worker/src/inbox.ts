/**
 * Per-TRB inbox — every SMS the worker has ever sent OR received, kept
 * around so the full exchange with a gateway can actually be looked at
 * later instead of only flashing by in a console.log line. Before this,
 * outgoing SMS were never recorded anywhere persistent (only tracked
 * transiently in confirmationTracker.ts's 30-min in-memory map), and an
 * unmatched/unsolicited incoming reply was silently dropped — this is what
 * "store what was sent before and what the reply is" in the dashboard's
 * per-gateway Inbox card is backed by.
 *
 * File-backed, on purpose: a worker restart shouldn't lose history that
 * already arrived, and this machine runs offline by design.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingSms } from "./transports/types.js";

export interface InboxMessage {
  id: number;
  direction: "sent" | "received";
  /** The gateway's own SIM number either way — who we sent TO, or who replied FROM. */
  simNumber: string;
  text: string;
  ts: string; // ISO
}

const DATA_FILE = fileURLToPath(new URL("../data/inbox.json", import.meta.url));
const MAX_MESSAGES = 2000;

let messages: InboxMessage[] = [];
let nextId = 1;

function load() {
  try {
    if (existsSync(DATA_FILE)) {
      messages = JSON.parse(readFileSync(DATA_FILE, "utf8")) as InboxMessage[];
      nextId = (messages.at(-1)?.id ?? 0) + 1;
    }
  } catch (err) {
    console.warn(`[inbox] Failed to load ${DATA_FILE}: ${err instanceof Error ? err.message : err}`);
  }
}

function persist() {
  try {
    const dir = dirname(DATA_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.warn(`[inbox] Failed to persist ${DATA_FILE}: ${err instanceof Error ? err.message : err}`);
  }
}

load();

function record(entry: Omit<InboxMessage, "id">) {
  messages.push({ id: nextId++, ...entry });
  if (messages.length > MAX_MESSAGES) {
    messages = messages.slice(messages.length - MAX_MESSAGES);
  }
  persist();
}

/** Call right before/after handing text to transport.send() — the actual outbound SMS text, keyword or status query alike. */
export function recordOutgoing(simNumber: string, text: string) {
  record({ direction: "sent", simNumber, text, ts: new Date().toISOString() });
}

export function recordIncoming(msg: IncomingSms) {
  record({
    direction: "received",
    simNumber: msg.fromNumber,
    text: msg.text,
    ts: msg.receivedAt.toISOString(),
  });
}

/** Newest first — matches how every other list in this app is ordered. */
export function getInbox(): InboxMessage[] {
  return [...messages].reverse();
}
