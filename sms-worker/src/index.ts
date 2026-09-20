/**
 * Office-side worker. Owns the cellular modem and exposes it to the
 * dashboard over a small local HTTP API.
 *
 * The worker starts even when no modem is present, and keeps looking. That
 * is deliberate: on the office PC this runs as a service at boot, and USB
 * enumeration can easily lose that race — exiting would mean a machine that
 * never recovers without someone logging in. Instead the supervisor keeps
 * scanning and GET /health reports exactly why nothing is working, which the
 * dashboard shows.
 */

import { loadConfig } from "./config.js";
import { configureCommands } from "./commands.js";
import { ModemSupervisor } from "./transports/supervisor.js";
import { startControlServer } from "./controlServer.js";
import { recordIncoming } from "./inbox.js";

async function main() {
  const config = loadConfig();
  // Reply wording and number format vary by deployment — see commands.ts.
  configureCommands(config);

  /*
   * Announce the reply polarity on every start.
   *
   * This is the one setting whose loss is completely silent. It lives only
   * in .env, which is gitignored, so a fresh clone or a redeploy onto a new
   * machine quietly reverts to stock — and a site whose TRB rules were
   * inverted for the client then reports every valve backwards, with nothing
   * anywhere saying so. The symptom (a status check appearing to flip the
   * valve) sends people looking for a bug in the dashboard instead.
   *
   * One line in the startup log turns that from invisible into obvious.
   */
  const inverted = config.replyOnPattern === "open";
  console.log(
    `[worker] Reply polarity: "${config.replyOnPattern}" = ON, "${config.replyOffPattern}" = OFF` +
      (inverted ? "  <-- INVERTED for this site; TRB rules must be swapped to match" : " (stock)")
  );

  const supervisor = new ModemSupervisor(config);

  console.log("[worker] Looking for a modem...");
  await supervisor.start();

  const health = supervisor.health();
  if (health.state === "ready") {
    console.log(
      `[worker] Modem ready on ${health.comPort}: ${health.model ?? "unknown model"} ` +
        `(IMEI ${health.imei ?? "?"}, signal ${health.signal ?? "?"}/31, ${health.registration}, SMSC ${health.smsc})`
    );
  } else {
    console.warn(`\n[worker] No modem in service yet — ${health.reason}`);
    console.warn("  The worker will keep looking. Things worth checking:");
    console.warn("    1. Is the modem plugged in, and is its driver installed?");
    console.warn("       (with no driver Windows creates no COM port at all)");
    console.warn("    2. Is the SIM card seated, active, and not PIN-locked?");
    console.warn("    3. Is the MAIN antenna connected?");
    console.warn("  Run `npm run diagnose` for a full report.\n");
  }

  // Subscribed once, for the life of the process. The supervisor re-attaches
  // this to whatever modem is current, so recovery replacing the transport
  // underneath us cannot drop an inbound message.
  supervisor.onReceive((msg) => {
    console.log(`[worker] Incoming SMS from ${msg.fromNumber}: "${msg.text}"`);
    recordIncoming(msg);
  });

  startControlServer(config, supervisor);
}

main().catch((err) => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});
