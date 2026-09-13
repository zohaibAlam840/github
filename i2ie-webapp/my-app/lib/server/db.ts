/**
 * SQLite connection + schema. Uses Node's built-in node:sqlite — no native
 * dependency to compile/ship to the office PC. This lives inside the Next.js
 * process itself (see app/api/**‍/route.ts) — no separate backend service.
 * Foreign keys with ON DELETE CASCADE reproduce the old MockEngine's manual
 * cascade-delete logic (building -> units -> valves -> commands, and
 * gateway -> valves -> commands) declaratively instead of by hand.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import type { Settings } from "../types";

export const DEFAULT_SETTINGS: Settings = {
  keywordOpen: "v{output}on",
  keywordClose: "v{output}off",
  keywordStatus: "status",
  replyOnToken: "ON",
  replyOffToken: "OFF",
  sendGapMs: 2200,
  maxRetries: 2,
  replyTimeoutMs: 7000,
  confirmAfterCommand: true,
  smsTransport: "serial_modem",
  comPort: null,
  workerUrl: null,
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = scryptSync(password, salt, 64).toString("hex");
  if (check.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < check.length; i++) diff |= check.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer'))
    );

    CREATE TABLE IF NOT EXISTS buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      sim_number TEXT NOT NULL,
      num_outputs INTEGER NOT NULL CHECK (num_outputs IN (1,2)),
      auth_password TEXT,
      reachability TEXT NOT NULL DEFAULT 'unknown',
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS valves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      gateway_id INTEGER NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
      output_index INTEGER NOT NULL CHECK (output_index IN (1,2)),
      valve_code TEXT NOT NULL,
      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_seen_at TEXT,
      pending_command_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      valve_id INTEGER NOT NULL REFERENCES valves(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      command_text TEXT NOT NULL,
      status TEXT NOT NULL,
      sent_at TEXT,
      reply_text TEXT,
      reply_at TEXT,
      retries INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      events_json TEXT NOT NULL DEFAULT '[]',
      worker_tracking_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commands_valve ON commands(valve_id);
    CREATE INDEX IF NOT EXISTS idx_commands_created ON commands(created_at DESC);

    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      valve_code TEXT,
      building_name TEXT,
      user_name TEXT,
      action TEXT,
      valve_status TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_json TEXT NOT NULL
    );
  `);

  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db: DatabaseSync) {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (userCount.n === 0) {
    const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
    const password = process.env.SEED_ADMIN_PASSWORD ?? "admin";
    const name = process.env.SEED_ADMIN_NAME ?? "Administrator";
    db.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, 'admin')"
    ).run(name, username, hashPassword(password));
    console.log(`[db] Seeded first-run admin account: username="${username}" — change the password after logging in.`);
  }

  const settingsRow = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!settingsRow) {
    db.prepare("INSERT INTO settings (id, data_json) VALUES (1, ?)").run(
      JSON.stringify(DEFAULT_SETTINGS)
    );
  }
}

export function newToken(): string {
  return randomUUID();
}
