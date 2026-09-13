/**
 * Self-test for the pure logic that decides what gets sent and how a reply
 * is read. No hardware, no ports — just the rules that would otherwise only
 * be exercised on a client's machine on installation day.
 *
 *   npm run selftest
 */

import { normalizeNumber, numbersMatch, parseRelayState, configureCommands } from "./commands.js";
import { decodeUcs2, describeAtError } from "./transports/serialModem.js";

let pass = 0;
let fail = 0;
function t(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}  ->  ${JSON.stringify(actual)}${ok ? "" : `  (expected ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}

console.log("\n== normalizeNumber (+974 configured) ==");
configureCommands({ defaultCountryCode: "+974" });
t('already international', normalizeNumber("+97455099003"), "+97455099003");
t('00 prefix', normalizeNumber("0097455099003"), "+97455099003");
t('local with leading 0', normalizeNumber("055099003"), "+97455099003");
t('bare 8 digits', normalizeNumber("55099003"), "+97455099003");
t('spaces and dashes', normalizeNumber("+974 5509-9003"), "+97455099003");
t('empty stays empty', normalizeNumber(""), "");

console.log("\n== normalizeNumber (disabled) ==");
configureCommands({ defaultCountryCode: "" });
t('sent exactly as stored', normalizeNumber("03401588816"), "03401588816");
t('+ still preserved', normalizeNumber("+923401588816"), "+923401588816");

console.log("\n== numbersMatch ==");
t('local vs international', numbersMatch("03401588816", "+923401588816"), true);
t('identical', numbersMatch("+97455099003", "+97455099003"), true);
t('different numbers', numbersMatch("+97455099003", "+97455099004"), false);
t('EMPTY must not match (was a bug)', numbersMatch("+97455099003", ""), false);
t('both empty', numbersMatch("", ""), false);
t('too short to be safe', numbersMatch("+97455099003", "003"), false);

console.log("\n== parseRelayState (default patterns) ==");
configureCommands({ replyOpenPattern: "open", replyClosedPattern: "clos" });
t('bench reply Closed', parseRelayState("Relay - Closed"), "closed");
t('bench reply Open', parseRelayState("Relay - Open"), "open");
t('lowercase', parseRelayState("relay - open"), "open");
t('unrelated text', parseRelayState("Command accepted"), "unknown");
t('AMBIGUOUS two-relay reply', parseRelayState("Relay1 - Open, Relay2 - Closed"), "unknown");

console.log("\n== parseRelayState (client words it differently) ==");
configureCommands({ replyOpenPattern: "ON", replyClosedPattern: "OFF" });
t('V1=ON', parseRelayState("V1=ON"), "open");
t('V1=OFF', parseRelayState("V1=OFF"), "closed");


console.log("\n== decodeUcs2 (real bodies captured from the client SIM) ==");
// Verbatim from AT+CMGL="ALL" on the client laptop, 2026-09-13. The operator's
// own notifications arrive UCS2-encoded even with AT+CSCS="IRA" set, so a TRB
// reply could too — and read as hex it would parse as "unknown" forever.
t(
  "operator notice decodes to text",
  decodeUcs2("00530049004D0020005000610063006B002E00200059006F00750020006800610076006500200035003000250020006C006500660074002E"),
  "SIM Pack. You have 50% left."
);
t("UCS2 relay reply decodes", decodeUcs2("00520065006C006100790020002D00200043006C006F007300650064"), "Relay - Closed");
t("plain text passes through", decodeUcs2("Relay - Closed"), "Relay - Closed");
t("plain reply from the test phone", decodeUcs2("test2"), "test2");
// Must NOT be mangled: ordinary text that happens to be hex, multiple of 4.
t("all-digit text is left alone", decodeUcs2("12345678"), "12345678");
t("odd length is left alone", decodeUcs2("00530049004"), "00530049004");

console.log("\n== describeAtError ==");
t("500 names the likely cause", describeAtError("+CMS ERROR: 500").includes("not enabled on the"), true);
t("303 keeps its code", describeAtError("+CMS ERROR: 303").includes("303"), true);
t("50 blames the operator", describeAtError("+CMS ERROR: 50").includes("operator"), true);
t("unknown code stays readable", describeAtError("+CMS ERROR: 999"), "SMS rejected by the network (code 999).");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
