/*
 * Builds the portfolio the tutorials are recorded against.
 *
 * Every chapter must start from identical data, or the videos disagree with
 * each other and with the manual's screenshots. So this wipes and rebuilds a
 * SEPARATE database file — never the one an operator might be using.
 *
 * It also turns demo mode ON. That is what makes recording safe: commands
 * resolve with realistic timing and outcomes, no SMS is sent, no credit is
 * spent, and no modem needs to be attached. Every simulated event is
 * prefixed [DEMO] by the queue itself.
 */

import { openDb, hashPassword } from "../../i2ie-webapp/my-app/lib/server/db.ts";
import { createRepo } from "../../i2ie-webapp/my-app/lib/server/repo.ts";
import { resolve } from "node:path";

export const DEMO_DB = resolve(import.meta.dirname, "demo-data/demo.sqlite");

/** Plausible Doha addresses — the manual should not look like lorem ipsum. */
const BUILDINGS = [
  {
    name: "Al Mansoura Tower",
    address: "Al Mansoura St, Doha",
    units: ["101", "102", "103", "201", "202", "203", "301", "302"],
    gateway: { label: "TRB-MANSOURA-1", sim: "+97455010101" },
  },
  {
    name: "Musheireb Residences",
    address: "Musheireb, Doha",
    units: ["A1", "A2", "B1", "B2"],
    gateway: { label: "TRB-MUSHEIREB-1", sim: "+97455020202" },
  },
  {
    name: "Lusail Marina Block C",
    address: "Marina District, Lusail",
    units: ["C-01", "C-02", "C-03"],
    gateway: { label: "TRB-LUSAIL-C", sim: "+97455030303" },
  },
];

/**
 * The worker each chapter points at.
 *
 * "healthy" is the mock worker: the Topbar chip is green, the Modem page
 * shows a real SIM7600G-H, and commands resolve like the bench unit does.
 * "failing" is a port with nothing on it, so the bulk chapter exercises the
 * genuine failure and skip paths rather than a staged imitation of them.
 */
export type WorkerProfile = "healthy" | "failing";

export const MOCK_WORKER_PORT = 3901;

export function seedDemo(profile: WorkerProfile = "healthy"): void {
  /*
   * Clear the TABLES, never delete the file.
   *
   * The dashboard process is running against this database and holds it
   * open, and Windows refuses to unlink a file with an open handle — the
   * reseed between chapters fails with EPERM. Emptying the tables through a
   * second connection works fine: WAL allows concurrent connections, and
   * the dashboard reads every row live rather than caching it.
   */
  const db = openDb(DEMO_DB);
  for (const table of ["commands", "activity", "valves", "units", "buildings", "gateways"]) {
    db.exec(`DELETE FROM ${table}`);
    db.exec(`DELETE FROM sqlite_sequence WHERE name = '${table}'`);
  }
  const repo = createRepo(db);

  // Demo mode ON: simulated commands, no SMS, no hardware required.
  /*
   * Never demo mode. Simulation invents random outcomes and stamps every
   * event [DEMO], which would be visible in the footage and would teach an
   * operator to expect a label the real system never shows. The real code
   * path is used throughout; only the worker behind it changes.
   */
  repo.updateSettings({
    demoMode: false,
    workerUrl:
      profile === "healthy"
        ? `http://127.0.0.1:${MOCK_WORKER_PORT}`
        : "http://127.0.0.1:59999", // nothing listens here, on purpose
    modemNumber: "+97430373901",
    skipAfterFailures: 3,
    maxRetries: profile === "healthy" ? 2 : 0,
    sendGapMs: 400,
    confirmAfterCommand: true,
  });

  // One account per role, so the roles chapter can sign in as each of them
  // and show exactly what changes.
  db.prepare("DELETE FROM users WHERE username <> 'admin'").run();
  for (const [name, username, role] of [
    ["Fatima Al-Kuwari", "operator", "operator"],
    ["Site Viewer", "viewer", "viewer"],
  ] as const) {
    db.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)"
    ).run(name, username, hashPassword("demo1234"), role);
  }
  // A known password for the admin too - the sign-in chapter types it on
  // screen, so it must not be a secret and must not be the shipped default.
  db.prepare("UPDATE users SET password_hash = ?, name = ? WHERE username = 'admin'")
    .run(hashPassword("demo1234"), "Ahmed Al-Sayed");

  for (const b of BUILDINGS) {
    const building = repo.createBuilding(b.name, b.address);
    const gateway = repo.createGateway(b.gateway.label, b.gateway.sim, 1, null);

    for (const unitName of b.units) {
      const unit = repo.createUnit(building.id, unitName);
      repo.createValve(
        unit.id,
        `${b.name.split(" ")[0].toUpperCase()}-${unitName}`,
        gateway.id,
        1
      );
    }
  }

  /*
   * Give the portfolio a lived-in spread of states.
   *
   * Everything "unknown" makes every status bar flat amber, which both
   * looks wrong and teaches nothing about what the colours mean.
   */
  const allValves = repo.listValves();
  allValves.forEach((v, i) => {
    if (i % 3 === 0) repo.setValveStatus(v.id, "on", true);
    else if (i % 3 === 1) repo.setValveStatus(v.id, "off", true);
    // every third stays unknown — a real portfolio always has some
  });

  const counts = repo.summary();
  console.log(
    `[seed] ${BUILDINGS.length} buildings, ${counts.units} units, ${counts.valves} valves, worker: ${profile}`
  );
  console.log(`[seed] ${DEMO_DB}`);
  db.close();
}

if (import.meta.filename === process.argv[1]) seedDemo();
