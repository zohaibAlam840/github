/**
 * Data access layer — every SQL statement lives here, mapping snake_case
 * rows to the camelCase shapes lib/types.ts already defines. Callers
 * (queue.ts, app/api/**‍/route.ts) never see SQL.
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  ActivityEvent,
  ActivityKind,
  Building,
  BuildingStats,
  Command,
  CommandAction,
  CommandEvent,
  CommandLog,
  CommandStatus,
  DashboardSummary,
  Gateway,
  GatewayReachability,
  Role,
  Settings,
  Unit,
  User,
  Valve,
  ValveStatus,
} from "../types";
import { hashPassword, verifyPassword, DEFAULT_SETTINGS } from "./db";

const now = () => new Date().toISOString();

export function createRepo(db: DatabaseSync) {
  /* ---------- users ---------- */

  function findUserByUsername(username: string) {
    return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | { id: number; name: string; username: string; password_hash: string; role: Role }
      | undefined;
  }

  function verifyLogin(username: string, password: string): User | null {
    const row = findUserByUsername(username);
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    return { id: row.id, name: row.name, username: row.username, role: row.role };
  }

  function listUsers(): User[] {
    return db.prepare("SELECT id, name, username, role FROM users ORDER BY id").all() as unknown as User[];
  }

  function createUser(name: string, username: string, password: string, role: Role): User {
    if (findUserByUsername(username)) throw new Error("USERNAME_TAKEN");
    const info = db
      .prepare("INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)")
      .run(name, username, hashPassword(password), role);
    return { id: Number(info.lastInsertRowid), name, username, role };
  }

  function deleteUser(id: number) {
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  /* ---------- buildings ---------- */

  function rowToBuilding(r: any): Building {
    return { id: r.id, name: r.name, address: r.address, createdAt: r.created_at };
  }

  function listBuildings(): Building[] {
    return (db.prepare("SELECT * FROM buildings ORDER BY id").all() as any[]).map(rowToBuilding);
  }

  function createBuilding(name: string, address: string): Building {
    const createdAt = now();
    const info = db
      .prepare("INSERT INTO buildings (name, address, created_at) VALUES (?, ?, ?)")
      .run(name, address, createdAt);
    return { id: Number(info.lastInsertRowid), name, address, createdAt };
  }

  function deleteBuilding(id: number) {
    db.prepare("DELETE FROM buildings WHERE id = ?").run(id); // cascades units->valves->commands
  }

  /* ---------- units ---------- */

  function rowToUnit(r: any): Unit {
    return { id: r.id, buildingId: r.building_id, name: r.name, createdAt: r.created_at };
  }

  function listUnits(): Unit[] {
    return (db.prepare("SELECT * FROM units ORDER BY id").all() as any[]).map(rowToUnit);
  }

  function listUnitsByBuilding(buildingId: number): Unit[] {
    return (
      db.prepare("SELECT * FROM units WHERE building_id = ? ORDER BY id").all(buildingId) as any[]
    ).map(rowToUnit);
  }

  function createUnit(buildingId: number, name: string): Unit {
    const createdAt = now();
    const info = db
      .prepare("INSERT INTO units (building_id, name, created_at) VALUES (?, ?, ?)")
      .run(buildingId, name, createdAt);
    return { id: Number(info.lastInsertRowid), buildingId, name, createdAt };
  }

  function deleteUnit(id: number) {
    db.prepare("DELETE FROM units WHERE id = ?").run(id); // cascades valves->commands
  }

  /* ---------- gateways ---------- */

  function rowToGateway(r: any): Gateway {
    return {
      id: r.id,
      label: r.label,
      simNumber: r.sim_number,
      numOutputs: r.num_outputs,
      authPassword: r.auth_password,
      reachability: r.reachability,
      lastSeenAt: r.last_seen_at,
    };
  }

  function listGateways(): Gateway[] {
    return (db.prepare("SELECT * FROM gateways ORDER BY id").all() as any[]).map(rowToGateway);
  }

  function getGateway(id: number): Gateway | null {
    const r = db.prepare("SELECT * FROM gateways WHERE id = ?").get(id) as any;
    return r ? rowToGateway(r) : null;
  }

  function createGateway(
    label: string,
    simNumber: string,
    numOutputs: 1 | 2,
    authPassword: string | null
  ): Gateway {
    const info = db
      .prepare(
        "INSERT INTO gateways (label, sim_number, num_outputs, auth_password, reachability, last_seen_at) VALUES (?, ?, ?, ?, 'unknown', NULL)"
      )
      .run(label, simNumber, numOutputs, authPassword);
    return {
      id: Number(info.lastInsertRowid),
      label,
      simNumber,
      numOutputs,
      authPassword,
      reachability: "unknown",
      lastSeenAt: null,
    };
  }

  function deleteGateway(id: number) {
    db.prepare("DELETE FROM gateways WHERE id = ?").run(id); // cascades valves->commands
  }

  function setGatewayReachability(id: number, reachability: GatewayReachability, seen: boolean) {
    if (seen) {
      db.prepare("UPDATE gateways SET reachability = ?, last_seen_at = ? WHERE id = ?").run(
        reachability,
        now(),
        id
      );
    } else {
      db.prepare("UPDATE gateways SET reachability = ? WHERE id = ?").run(reachability, id);
    }
  }

  function gatewayValveCounts(): Map<number, number> {
    const rows = db
      .prepare("SELECT gateway_id AS g, COUNT(*) AS n FROM valves GROUP BY gateway_id")
      .all() as { g: number; n: number }[];
    return new Map(rows.map((r) => [r.g, r.n]));
  }

  /* ---------- valves ---------- */

  function rowToValve(r: any): Valve {
    return {
      id: r.id,
      unitId: r.unit_id,
      gatewayId: r.gateway_id,
      outputIndex: r.output_index,
      valveCode: r.valve_code,
      lastStatus: r.last_status,
      // SQLite has no boolean; the column is 0/1.
      statusVerified: r.status_verified !== 0,
      lastSeenAt: r.last_seen_at,
      pendingCommandId: r.pending_command_id,
    };
  }

  function listValves(): Valve[] {
    return (db.prepare("SELECT * FROM valves ORDER BY id").all() as any[]).map(rowToValve);
  }

  function listValvesByBuilding(buildingId: number): Valve[] {
    return (
      db
        .prepare(
          `SELECT v.* FROM valves v JOIN units u ON u.id = v.unit_id WHERE u.building_id = ? ORDER BY v.id`
        )
        .all(buildingId) as any[]
    ).map(rowToValve);
  }

  function getValve(id: number): Valve | null {
    const r = db.prepare("SELECT * FROM valves WHERE id = ?").get(id) as any;
    return r ? rowToValve(r) : null;
  }

  function createValve(unitId: number, valveCode: string, gatewayId: number, outputIndex: 1 | 2): Valve {
    const info = db
      .prepare(
        "INSERT INTO valves (unit_id, gateway_id, output_index, valve_code, last_status, last_seen_at, pending_command_id) VALUES (?, ?, ?, ?, 'unknown', NULL, NULL)"
      )
      .run(unitId, gatewayId, outputIndex, valveCode);
    return {
      id: Number(info.lastInsertRowid),
      unitId,
      gatewayId,
      outputIndex,
      valveCode,
      lastStatus: "unknown",
      statusVerified: true, // "unknown" is not a claim, so nothing is unverified about it
      lastSeenAt: null,
      pendingCommandId: null,
    };
  }

  function deleteValve(id: number) {
    db.prepare("DELETE FROM valves WHERE id = ?").run(id); // cascades commands
  }

  function setValvePending(id: number, commandId: number | null) {
    db.prepare("UPDATE valves SET pending_command_id = ? WHERE id = ?").run(commandId, id);
  }

  /**
   * @param seen      bump last_seen_at — we heard from the device just now.
   * @param verified  did a real TRB reply confirm this status, or are we
   *                  assuming it because we sent the command? Defaults to
   *                  true so every existing caller keeps its meaning; the
   *                  one-message path passes false explicitly.
   */
  function setValveStatus(id: number, status: ValveStatus, seen: boolean, verified = true) {
    const flag = verified ? 1 : 0;
    if (seen) {
      db.prepare("UPDATE valves SET last_status = ?, status_verified = ?, last_seen_at = ? WHERE id = ?").run(
        status,
        flag,
        now(),
        id
      );
    } else {
      db.prepare("UPDATE valves SET last_status = ?, status_verified = ? WHERE id = ?").run(status, flag, id);
    }
  }

  /** valveCode + building name, for activity-log entries (join, read-only). */
  function valveActivityContext(valveId: number): { valveCode: string; buildingName: string | null } | null {
    const r = db
      .prepare(
        `SELECT v.valve_code AS vc, b.name AS bn FROM valves v
         JOIN units u ON u.id = v.unit_id
         JOIN buildings b ON b.id = u.building_id
         WHERE v.id = ?`
      )
      .get(valveId) as any;
    return r ? { valveCode: r.vc, buildingName: r.bn } : null;
  }

  /* ---------- commands ---------- */

  function rowToCommand(r: any): Command {
    return {
      id: r.id,
      valveId: r.valve_id,
      userId: r.user_id,
      userName: r.user_name,
      action: r.action,
      commandText: r.command_text,
      status: r.status,
      sentAt: r.sent_at,
      replyText: r.reply_text,
      replyAt: r.reply_at,
      retries: r.retries,
      createdAt: r.created_at,
      events: JSON.parse(r.events_json ?? "[]"),
      workerTrackingId: r.worker_tracking_id,
    };
  }

  function createCommand(input: {
    valveId: number;
    userId: number;
    userName: string;
    action: CommandAction;
    commandText: string;
  }): Command {
    const createdAt = now();
    const info = db
      .prepare(
        `INSERT INTO commands (valve_id, user_id, user_name, action, command_text, status, sent_at, reply_text, reply_at, retries, created_at, events_json, worker_tracking_id)
         VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, 0, ?, '[]', NULL)`
      )
      .run(input.valveId, input.userId, input.userName, input.action, input.commandText, createdAt);
    return {
      id: Number(info.lastInsertRowid),
      valveId: input.valveId,
      userId: input.userId,
      userName: input.userName,
      action: input.action,
      commandText: input.commandText,
      status: "pending",
      sentAt: null,
      replyText: null,
      replyAt: null,
      retries: 0,
      createdAt,
      events: [],
      workerTrackingId: null,
    };
  }

  function getCommand(id: number): Command | null {
    const r = db.prepare("SELECT * FROM commands WHERE id = ?").get(id) as any;
    return r ? rowToCommand(r) : null;
  }

  function updateCommand(
    id: number,
    patch: Partial<{
      status: CommandStatus;
      sentAt: string | null;
      replyText: string | null;
      replyAt: string | null;
      retries: number;
      events: CommandEvent[];
      workerTrackingId: string | null;
    }>
  ) {
    const current = getCommand(id);
    if (!current) return;
    const merged = { ...current, ...patch };
    db.prepare(
      `UPDATE commands SET status = ?, sent_at = ?, reply_text = ?, reply_at = ?, retries = ?, events_json = ?, worker_tracking_id = ? WHERE id = ?`
    ).run(
      merged.status,
      merged.sentAt,
      merged.replyText,
      merged.replyAt,
      merged.retries,
      JSON.stringify(merged.events ?? []),
      merged.workerTrackingId ?? null,
      id
    );
  }

  function listCommandLogs(limit: number): CommandLog[] {
    const rows = db
      .prepare(
        `SELECT c.*, v.valve_code AS vc, u.name AS un, b.name AS bn, g.sim_number AS sn
         FROM commands c
         LEFT JOIN valves v ON v.id = c.valve_id
         LEFT JOIN units u ON u.id = v.unit_id
         LEFT JOIN buildings b ON b.id = u.building_id
         LEFT JOIN gateways g ON g.id = v.gateway_id
         ORDER BY c.id DESC LIMIT ?`
      )
      .all(limit) as any[];
    return rows.map((r) => ({
      ...rowToCommand(r),
      valveCode: r.vc ?? "—",
      unitName: r.un ?? "—",
      buildingName: r.bn ?? "—",
      simNumber: r.sn ?? "—",
    }));
  }

  function listStuckPending(): Command[] {
    return (db.prepare("SELECT * FROM commands WHERE status = 'pending' ORDER BY id").all() as any[]).map(
      rowToCommand
    );
  }

  function listStuckSent(): Command[] {
    return (
      db
        .prepare("SELECT * FROM commands WHERE status = 'sent' AND worker_tracking_id IS NOT NULL ORDER BY id")
        .all() as any[]
    ).map(rowToCommand);
  }

  /* ---------- activity ---------- */

  function insertActivity(input: {
    kind: ActivityKind;
    valveCode: string | null;
    buildingName: string | null;
    userName: string | null;
    action: CommandAction | null;
    valveStatus: ValveStatus | null;
  }): ActivityEvent {
    const ts = now();
    const info = db
      .prepare(
        `INSERT INTO activity (ts, kind, valve_code, building_name, user_name, action, valve_status) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(ts, input.kind, input.valveCode, input.buildingName, input.userName, input.action, input.valveStatus);
    db.exec("DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 200)");
    return {
      id: Number(info.lastInsertRowid),
      ts,
      kind: input.kind,
      valveCode: input.valveCode,
      buildingName: input.buildingName,
      userName: input.userName,
      action: input.action,
      valveStatus: input.valveStatus,
    };
  }

  function listActivity(limit = 50): ActivityEvent[] {
    return (db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?").all(limit) as any[]).map((r) => ({
      id: r.id,
      ts: r.ts,
      kind: r.kind,
      valveCode: r.valve_code,
      buildingName: r.building_name,
      userName: r.user_name,
      action: r.action,
      valveStatus: r.valve_status,
    }));
  }

  /* ---------- settings ---------- */

  function getSettings(): Settings {
    const row = db.prepare("SELECT data_json FROM settings WHERE id = 1").get() as { data_json: string };
    // Merge over defaults so a settings row saved before a new field
    // existed (e.g. confirmAfterCommand) gets that field's safe default
    // instead of undefined — undefined would be falsy for a boolean,
    // silently changing behavior for existing installs.
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.data_json) };
  }

  function updateSettings(patch: Partial<Settings>): Settings {
    const merged = { ...getSettings(), ...patch };
    db.prepare("UPDATE settings SET data_json = ? WHERE id = 1").run(JSON.stringify(merged));
    return merged;
  }

  /* ---------- dashboard aggregates ---------- */

  function summary(): DashboardSummary {
    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM buildings) AS buildings,
           (SELECT COUNT(*) FROM units) AS units,
           (SELECT COUNT(*) FROM valves) AS valves,
           (SELECT COUNT(*) FROM valves WHERE last_status = 'on') AS open,
           (SELECT COUNT(*) FROM valves WHERE last_status = 'off') AS closed,
           (SELECT COUNT(*) FROM commands WHERE status IN ('pending','sent')) AS pendingCommands`
      )
      .get() as any;
    return {
      buildings: counts.buildings,
      units: counts.units,
      valves: counts.valves,
      open: counts.open,
      closed: counts.closed,
      unknown: counts.valves - counts.open - counts.closed,
      pendingCommands: counts.pendingCommands,
    };
  }

  function buildingStats(): BuildingStats[] {
    const rows = db
      .prepare(
        `SELECT
           b.*,
           (SELECT COUNT(*) FROM units u WHERE u.building_id = b.id) AS unit_count,
           (SELECT COUNT(*) FROM valves v JOIN units u ON u.id = v.unit_id WHERE u.building_id = b.id) AS valve_count,
           (SELECT COUNT(*) FROM valves v JOIN units u ON u.id = v.unit_id WHERE u.building_id = b.id AND v.last_status = 'on') AS open_count,
           (SELECT COUNT(*) FROM valves v JOIN units u ON u.id = v.unit_id WHERE u.building_id = b.id AND v.last_status = 'off') AS closed_count,
           (SELECT COUNT(*) FROM valves v JOIN units u ON u.id = v.unit_id WHERE u.building_id = b.id AND v.last_status = 'unknown') AS unknown_count
         FROM buildings b ORDER BY b.id`
      )
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      createdAt: r.created_at,
      unitCount: r.unit_count,
      valveCount: r.valve_count,
      open: r.open_count,
      closed: r.closed_count,
      unknown: r.unknown_count,
    }));
  }

  /**
   * Runs fn inside a single SQLite transaction. Critical for any loop that
   * queues many commands at once (see queue.ts's queueBulkCommand): each
   * individual statement otherwise auto-commits on its own, and every
   * commit does a real disk sync in WAL mode — measured at ~5-6ms each on
   * this machine, so 200 queued commands (4 statements apiece) took 5.2
   * real seconds without this wrapper vs. 86ms with it. At the ~2,000-
   * gateway scale this app targets, an unbatched bulk send would block the
   * request for tens of seconds.
   */
  function transaction<T>(fn: () => T): T {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /* ---------- system ---------- */

  function resetPortfolio() {
    db.exec("DELETE FROM buildings"); // cascades everything except users/settings
    db.exec("DELETE FROM gateways"); // cascades any orphaned valves too
    db.exec("DELETE FROM activity");
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('buildings','units','gateways','valves','commands','activity')");
  }

  return {
    verifyLogin,
    listUsers,
    createUser,
    deleteUser,
    listBuildings,
    createBuilding,
    deleteBuilding,
    listUnits,
    listUnitsByBuilding,
    createUnit,
    deleteUnit,
    listGateways,
    getGateway,
    createGateway,
    deleteGateway,
    setGatewayReachability,
    gatewayValveCounts,
    listValves,
    listValvesByBuilding,
    getValve,
    createValve,
    deleteValve,
    setValvePending,
    setValveStatus,
    valveActivityContext,
    transaction,
    createCommand,
    getCommand,
    updateCommand,
    listCommandLogs,
    listStuckPending,
    listStuckSent,
    insertActivity,
    listActivity,
    getSettings,
    updateSettings,
    summary,
    buildingStats,
    resetPortfolio,
  };
}

export type Repo = ReturnType<typeof createRepo>;
