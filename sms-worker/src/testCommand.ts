/**
 * Manual bench-test CLI — exercises the real dispatch+background-confirm
 * pipeline against a real TRB141, straight from the command line.
 * Prints each event as it happens (same records the dashboard would poll).
 *
 * Usage:
 *   npm run test-command -- <simNumber> <open|close|status> [authPassword]
 *
 * Example (matches the rules already proven working on the bench):
 *   npm run test-command -- 03401588816 open
 *   npm run test-command -- 03401588816 close mypassword123
 */

import { loadConfig } from "./config.js";
import { configureCommands } from "./commands.js";
import { ModemSupervisor } from "./transports/supervisor.js";
import { startControlServer } from "./controlServer.js";
import { dispatchAndTrack, getRecord } from "./confirmationTracker.js";

async function main() {
  const [, , simNumber, action, authPassword] = process.argv;
  if (!simNumber || !action || !["open", "close", "status"].includes(action)) {
    console.error("Usage: npm run test-command -- <simNumber> <open|close|status> [authPassword]");
    process.exit(1);
  }

  const config = loadConfig();
  // Reply wording and number format vary by deployment — see commands.ts.
  configureCommands(config);
  const supervisor = new ModemSupervisor(config);
  await supervisor.start();
  const health = supervisor.health();
  if (!supervisor.current()) {
    console.error(`No modem available: ${health.reason}`);
    process.exit(1);
  }
  console.log(
    `Modem: ${health.model ?? "unknown"} on ${health.comPort} ` +
      `(signal ${health.signal ?? "?"}/31, ${health.registration}, SMSC ${health.smsc})`
  );
  startControlServer(config, supervisor);

  const gateway = { simNumber, authPassword: authPassword ?? null };
  const output = 1; // bench setup has been using output 1 (Relay 3,4,5)
  const act = action as "open" | "close" | "status";

  // {output} is substituted in all three keywords, exactly as controlServer
  // does it — this CLI has to send the same text the dashboard would, or it
  // proves nothing about the real path.
  const fill = (k: string) => k.replace("{output}", String(output));
  const statusKeyword = fill(config.keywordStatus);
  const keyword =
    act === "open" ? fill(config.keywordOpen) : act === "close" ? fill(config.keywordClose) : statusKeyword;

  console.log(`Dispatching "${keyword}" to ${simNumber}, then "${statusKeyword}" to confirm...`);

  const record = await dispatchAndTrack(supervisor, gateway, act, keyword, statusKeyword, {
    expectedState: act === "open" ? "closed" : act === "close" ? "open" : undefined,
  });
  // Note: on this bench setup, valveon -> Relay=Closed, valveoff -> Relay=Open
  // (see memory i2i-valve-system.md) — that's why "open" expects relay "closed".

  console.log(`Tracking id: ${record.id} — polling until a final status...\n`);

  let printedCount = 0;
  const poll = setInterval(() => {
    const current = getRecord(record.id);
    if (!current) return;
    for (const evt of current.events.slice(printedCount)) {
      console.log(`  [${evt.ts}] ${evt.message}`);
    }
    printedCount = current.events.length;

    if (current.status !== "sent") {
      clearInterval(poll);
      console.log(`\nFinal status: ${current.status}`);
      if (current.replyText) console.log(`Reply: "${current.replyText}" (relay: ${current.relayState})`);
      process.exit(current.status === "success" ? 0 : 1);
    }
  }, 1000);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
