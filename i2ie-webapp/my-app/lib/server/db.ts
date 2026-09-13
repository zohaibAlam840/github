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
import { DEFAULT_WORKER_URL } from "../workerStatus";

export const DEFAULT_SETTINGS: Settings = {
  // The keywords actually proven against a TRB141 — and the same defaults the
  // worker carries, so a fresh install agrees with itself. These were
  // "v{output}on"/"v{output}off"/"status" here and "valveon"/"valveoff"/
  // "iostatus" in the worker, which is how the audit log came to record a
  // command text that was never sent.
  //
  // {output} is still substituted, for deployments whose rules are per-output.
  keywordOpen: "valveon",
  keywordClose: "valveoff",
  keywordStatus: "iostatus",
  replyOnToken: "ON",
  replyOffToken: "OFF",
  sendGapMs: 2200,
  maxRetries: 2,
  replyTimeoutMs: 7000,
  // One SMS per command, not two.
  //
  // A TRB141 "Change I/O state" rule never replies, so verifying an
  // open/close means sending a second "status" message behind it. That
  // doubles SMS cost on what is a prepaid SIM, and doubles time on the one
  // serial line the health checks also share.
  //
  // The trade is real and is made visible rather than hidden: a command
  // resolves as "unconfirmed", and the valve's state is marked as assumed
  // until a Refresh actually verifies it. Operators who would rather pay for
  // certainty can turn this back on in Settings.
  confirmAfterCommand: false,
  smsTransport: "serial_modem",
  comPort: null,
  /*
   * Point at the worker out of the box.
   *
   * This used to be null, which silently selected the SIMULATED dispatch
   * path in queue.ts — random outcomes, 300-800ms, green ticks, no SMS.
   * A fresh install therefore looked like it worked while controlling
   * nothing, and the only cure was knowing to type an address nobody had
   * been told.
   *
   * 3900 is not a guess: the worker binds CONTROL_PORT (default 3900) or
   * exits with EADDRINUSE — it never falls back to another port — so this
   * address is correct on every default install. Keep it in step with
   * controlPort in sms-worker/src/config.ts.
   *
   * The honest failure (worker offline, said plainly) beats the dishonest
   * success it replaces.
   */
  workerUrl: DEFAULT_WORKER_URL,
  /*
   * Simulation is now opt-in, and off.
   *
   * It used to be selected by ACCIDENT — a null workerUrl silently switched
   * the queue to random outcomes and green ticks with no SMS sent. On a
   * system controlling real valves that is the most dangerous default
   * available, because the failure looks exactly like success.
   *
   * With this off, an unreachable worker produces an honest error naming the
   * address it tried. Turn it on deliberately to demo the dashboard with no
   * hardware attached; every event it produces is prefixed [DEMO].
   */
  demoMode: false,
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
      -- Did a real TRB reply confirm last_status, or are we assuming it
      -- because we sent the command and nothing came back to contradict us?
      -- With one-message dispatch (Settings.confirmAfterCommand = false) the
      -- assumed case is the NORMAL one, so the distinction has to be stored
      -- rather than inferred — otherwise the dashboard shows a confident
      -- open/closed that nothing ever verified.
      status_verified INTEGER NOT NULL DEFAULT 1,
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

  addMissingColumns(db);
  renameOpenClosedToOnOff(db);
  upgradeLegacyKeywords(db);
  seedIfEmpty(db);
  return db;
}

/**
 * Replaces the ORIGINAL default keywords with the ones proven against the
 * client's TRB141.
 *
 * getSettings() merges stored values OVER the defaults — correct, since an
 * admin's choice must survive a code update — but it meant a database seeded
 * before the defaults were corrected kept sending "status" and "v1on"
 * forever. That fails in the worst possible way: the device matches no rule,
 * so it never replies, which is indistinguishable from a dead gateway.
 *
 * Only values that are EXACTLY the old defaults are touched. Anything an
 * operator actually chose — including a deliberate "status", which is a real
 * TRB141 factory rule — is left alone, because silently rewriting a
 * configured keyword would be a worse bug than the one being fixed.
 *
 * Idempotent: after the first run no old values remain to match.
 */
function upgradeLegacyKeywords(db: DatabaseSync) {
  const row = db.prepare("SELECT data_json FROM settings WHERE id = 1").get() as
    | { data_json: string }
    | undefined;
  if (!row) return;

  const stored = JSON.parse(row.data_json) as Record<string, unknown>;
  const legacy: Record<string, [string, string]> = {
    keywordOpen: ["v{output}on", DEFAULT_SETTINGS.keywordOpen],
    keywordClose: ["v{output}off", DEFAULT_SETTINGS.keywordClose],
    keywordStatus: ["status", DEFAULT_SETTINGS.keywordStatus],
  };

  const changed: string[] = [];
  for (const [key, [old, replacement]] of Object.entries(legacy)) {
    if (stored[key] === old) {
      stored[key] = replacement;
      changed.push(`${key}: "${old}" -> "${replacement}"`);
    }
  }
  if (changed.length === 0) return;

  db.prepare("UPDATE settings SET data_json = ? WHERE id = 1").run(JSON.stringify(stored));
  console.warn(`[db] Upgraded legacy SMS keywords — ${changed.join(", ")}`);
}

/**
 * Rewrites the old open/closed vocabulary to on/off.
 *
 * "Open" meant three different things at once — water flowing, a relay
 * contact with no current, and whichever of those we had in mind — so the
 * codebase carried an inverted ternary to reconcile them. We now report the
 * gateway OUTPUT state, which is the only thing the device actually tells us.
 *
 * The mapping follows the hardware: sending `valveon` energises the output,
 * which CLOSES the relay contact, and the device answers "Relay closed".
 * So a stored 'closed' was an energised output and becomes 'on'.
 *
 * Idempotent — after the first run there are no old values left to match.
 */
function renameOpenClosedToOnOff(db: DatabaseSync) {
  const stale = db
    .prepare("SELECT COUNT(*) AS n FROM valves WHERE last_status IN ('open','closed')")
    .get() as { n: number };
  if (stale.n === 0) return;

  db.exec("UPDATE valves SET last_status = 'on'  WHERE last_status = 'closed'");
  db.exec("UPDATE valves SET last_status = 'off' WHERE last_status = 'open'");
  // Command and activity history use the ACTION vocabulary, where "open"
  // always meant "energise" — a straight rename with no inversion.
  db.exec("UPDATE commands SET action = 'on'  WHERE action = 'open'");
  db.exec("UPDATE commands SET action = 'off' WHERE action = 'close'");
  db.exec("UPDATE activity SET action = 'on'  WHERE action = 'open'");
  db.exec("UPDATE activity SET action = 'off' WHERE action = 'close'");
  db.exec("UPDATE activity SET valve_status = 'on'  WHERE valve_status = 'closed'");
  db.exec("UPDATE activity SET valve_status = 'off' WHERE valve_status = 'open'");
  console.warn(`[db] Migrated ${stale.n} valve row(s) from open/closed to on/off.`);
}

/**
 * Adds columns introduced after a database was first created.
 *
 * CREATE TABLE IF NOT EXISTS silently does nothing on an existing file, so a
 * new column in the schema above would never reach a database that already
 * exists — the office PC's, after the first deployment. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", so each one is checked against the table info
 * first. Adding a column is the only migration shape this needs; anything
 * more involved should become a real versioned migration.
 */
function addMissingColumns(db: DatabaseSync) {
  const additions: { table: string; column: string; ddl: string }[] = [
    {
      table: "valves",
      column: "status_verified",
      ddl: "ALTER TABLE valves ADD COLUMN status_verified INTEGER NOT NULL DEFAULT 1",
    },
  ];

  for (const { table, column, ddl } of additions) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (existing.some((c) => c.name === column)) continue;
    db.exec(ddl);
  }
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
