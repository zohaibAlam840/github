/**
 * Manual bench-test CLI — exercises the real dispatch+background-confirm
 * pipeline against a real TRB141, straight from the command line.
 * Prints each event as it happens (same records the dashboard would poll).
 *
 * Usage:
 *   npm run test-command -- <simNumber> <on|off|status> [authPassword] [--keyword=TEXT]
 *
 * Example (matches the rules already proven working on the bench):
 *   npm run test-command -- 03401588816 on
 *   npm run test-command -- 03401588816 off mypassword123
 *
 * --keyword sends arbitrary text instead of the configured keyword. That is
 * how you probe a gateway's FACTORY rules ("status", "uptime", ...) without
 * editing Settings first — useful on a TRB nobody has configured yet, where
 * the question is simply "does this device answer anything at all".
 */

import { loadConfig } from "./config.js";
import { configureCommands } from "./commands.js";
import { ModemSupervisor } from "./transports/supervisor.js";
import { startControlServer } from "./controlServer.js";
import { dispatchAndTrack, getRecord } from "./confirmationTracker.js";

async function main() {
  // Pull flags out before positional args, so --keyword can go anywhere.
  const argv = process.argv.slice(2);
  const keywordFlag = argv.find((a) => a.startsWith("--keyword="));
  const rawKeyword = keywordFlag ? keywordFlag.slice("--keyword=".length) : null;
  const [simNumber, action, authPassword] = argv.filter((a) => !a.startsWith("--"));

  if (!simNumber || !action || !["on", "off", "status"].includes(action)) {
    console.error(
      "Usage: npm run test-command -- <simNumber> <on|off|status> [authPassword] [--keyword=TEXT]"
    );
    process.exit(1);
  }
  if (keywordFlag && !rawKeyword) {
    console.error("--keyword= needs a value, e.g. --keyword=status");
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
  const act = action as "on" | "off" | "status";

  // {output} is substituted in all three keywords, exactly as controlServer
  // does it — this CLI has to send the same text the dashboard would, or it
  // proves nothing about the real path.
  const fill = (k: string) => k.replace("{output}", String(output));
  const statusKeyword = rawKeyword ?? fill(config.keywordStatus);
  const keyword =
    rawKeyword ??
    (act === "on" ? fill(config.keywordOpen) : act === "off" ? fill(config.keywordClose) : statusKeyword);

  console.log(`Dispatching "${keyword}" to ${simNumber}...`);
  if (rawKeyword) {
    // A factory rule answers with router info, not "Relay open/closed", so the
    // reply will not parse to a relay state. That is not a failure: the point
    // of a raw-keyword probe is whether ANYTHING comes back, which is what
    // proves the round trip. Say so up front rather than let "unknown" read
    // as a fault.
    console.log(
      `Raw keyword probe — any reply at all proves the round trip; ` +
        `the relay state will read "unknown" unless the rule happens to report one.`
    );
  }

  const record = await dispatchAndTrack(supervisor, gateway, act, keyword, statusKeyword, {
    // Nothing to expect from an arbitrary keyword — claiming an expected
    // state here would report a wrong-state failure for a perfectly good reply.
    expectedState: rawKeyword || act === "status" ? undefined : act,
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
