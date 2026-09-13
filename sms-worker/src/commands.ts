/**
 * Command composition, number formatting, and reply interpretation.
 *
 * The two-message pattern this supports was proven on the bench: a TRB141
 * "Change I/O state" rule (valveon/valveoff) never replies, only "Send
 * status" (iostatus) does — and only with whatever the rule's Message text
 * template contains. Ours is set to "Relay - %rb", so the reply reports the
 * actual relay rather than the unrelated Configurable I/O pins the default
 * template shows.
 *
 * Everything here that depends on how a particular client's devices are
 * configured is a SETTING, not a constant. On a remote installation day the
 * difference between "change a value" and "change the code" is the
 * difference between a minute and an afternoon.
 */

import type { IncomingSms, SmsTransport } from "./transports/types.js";

export interface GatewayInfo {
  simNumber: string;
  /** TRB SMS Utilities admin password, if that rule uses "By router admin password". null = "No authorization". */
  authPassword: string | null;
}

export type RelayState = "on" | "off" | "unknown";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

interface CommandConfig {
  replyOnPattern: string;
  replyOffPattern: string;
  defaultCountryCode: string;
}

/**
 * Defaults match the devices we have actually seen. loadConfig() overrides
 * them at startup.
 *
 * READ THESE CAREFULLY — they look backwards and are not.
 *
 * A TRB141 status reply describes the RELAY CONTACT, not the output state:
 * sending `valveon` energises the output, which CLOSES the contact, and the
 * device answers "Relay closed" (confirmed on the client's gateway,
 * 2026-09-13). So the text that means the output is ON is "clos".
 *
 * This inversion is real and unavoidable — it belongs to the hardware. What
 * matters is that it now lives in exactly one place, named, with this comment
 * on it, instead of being spread across an inverted ternary and a UI label.
 */
let cfg: CommandConfig = {
  replyOnPattern: "clos", // "Relay closed"  -> contact closed -> output ON
  replyOffPattern: "open", // "Relay open"    -> contact open   -> output OFF
  defaultCountryCode: "",
};

/** Called once at startup so these behaviours track the worker's config. */
export function configureCommands(next: Partial<CommandConfig>) {
  cfg = { ...cfg, ...next };
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/**
 * AT+CMGS is strict about number format, but operators type numbers into the
 * dashboard however they like — the bench data has "03401588816" stored while
 * replies arrive as "+923401588816". AT+CMGS wants one consistent form.
 *
 * NOTE the country code has to match where the SIMs actually are. A Pakistani
 * "0340..." with a Qatari "+974" would produce a nonsense number, so this is
 * deliberately a single explicit setting rather than a guess per number.
 * Leave it empty to send numbers exactly as stored.
 */
export function normalizeNumber(raw: string, countryCode = cfg.defaultCountryCode): string {
  const trimmed = raw.replace(/[\s\-()]/g, "");
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("00")) return `+${trimmed.slice(2)}`;
  if (!countryCode) return trimmed; // rewriting disabled
  if (trimmed.startsWith("0")) return `${countryCode}${trimmed.slice(1)}`;
  return `${countryCode}${trimmed}`;
}

/**
 * Loose match — the same number appears in different formats depending on
 * whether it was typed by an operator or reported by the network. Comparing
 * the last 8 digits sidesteps that.
 */
export function numbersMatch(a: string, b: string): boolean {
  const tailA = a.replace(/^\+/, "").replace(/\D/g, "").slice(-8);
  const tailB = b.replace(/^\+/, "").replace(/\D/g, "").slice(-8);
  // Guard against empty input: "".slice(-8) is "", and includes("") is always
  // true, so an empty sender used to match every pending command and could
  // resolve one with someone else's reply.
  if (tailA.length < 6 || tailB.length < 6) return false;
  return tailA === tailB;
}

/* ------------------------------------------------------------------ */
/* Command text                                                        */
/* ------------------------------------------------------------------ */

/**
 * Prefixes the keyword with the gateway's password if it has one.
 * ASSUMED format "<password> <keyword>" per Teltonika's docs — NOT verified
 * against a real password-protected rule. Confirm before relying on it in
 * production.
 */
export function composeCommandText(keyword: string, gateway: GatewayInfo): string {
  return gateway.authPassword ? `${gateway.authPassword} ${keyword}` : keyword;
}

/* ------------------------------------------------------------------ */
/* Keyword resolution                                                  */
/* ------------------------------------------------------------------ */

export interface KeywordSet {
  on: string;
  off: string;
  status: string;
}

/**
 * Works out the exact text to send for one action on one output.
 *
 * Lives here, and is tested, because getting it wrong is silent: the wrong
 * keyword produces no reply and no error, which is indistinguishable from an
 * unreachable gateway.
 *
 * `overrides` are the caller's own settings — the dashboard's Settings screen.
 * They win over the worker's environment, which is the fallback for callers
 * that have no settings of their own (the test-command CLI). Two independent
 * copies of these values used to exist with DIFFERENT defaults, so editing
 * the keyword in Settings changed nothing that went over the air and the
 * audit log recorded a command text that was never sent.
 *
 * `{output}` is substituted from whichever source the template came from, so
 * a per-output deployment works either way.
 */
export function resolveKeywords(
  action: "on" | "off" | "status",
  output: number,
  fallback: KeywordSet,
  overrides?: Partial<{ keyword: string; statusKeyword: string }>
): { keyword: string; statusKeyword: string } {
  const fill = (k: string) => k.replace("{output}", String(output));
  const statusKeyword = fill(overrides?.statusKeyword ?? fallback.status);

  if (action === "status") return { keyword: statusKeyword, statusKeyword };

  const keyword = overrides?.keyword
    ? fill(overrides.keyword)
    : fill(action === "on" ? fallback.on : fallback.off);

  return { keyword, statusKeyword };
}

/* ------------------------------------------------------------------ */
/* Reply interpretation                                                */
/* ------------------------------------------------------------------ */

/**
 * Reads the OUTPUT state out of a TRB reply, e.g. "Relay closed" -> "on".
 *
 * ON/OFF, not open/closed, and deliberately so. "Open" means opposite things
 * for a valve (water flows) and for a relay contact (no current), and we
 * cannot know the valve's physical position anyway — that depends on whether
 * the solenoid is normally-open or normally-closed, which is wiring nobody on
 * our side has seen. The output state is the only thing the device actually
 * tells us, so it is the only thing we claim.
 *
 * Three deliberate behaviours:
 *
 *  - The words are configurable, because the device's Message text template
 *    is editable and a client's units may word it differently.
 *
 *  - The mapping from those words to ON/OFF lives in the patterns (see the
 *    cfg defaults above), not in code.
 *
 *  - A reply matching BOTH patterns returns "unknown" rather than picking
 *    one. A TRB141 has two relays, and a reply reporting both ("Relay1 open,
 *    Relay2 closed") cannot be attributed to a single output. Guessing would
 *    silently show the wrong state; "unknown" is visible and prompts a fix.
 */
export function parseRelayState(replyText: string): RelayState {
  const t = replyText.toLowerCase();
  const on = cfg.replyOnPattern ? t.includes(cfg.replyOnPattern.toLowerCase()) : false;
  const off = cfg.replyOffPattern ? t.includes(cfg.replyOffPattern.toLowerCase()) : false;

  if (on && off) return "unknown"; // ambiguous — see above
  if (on) return "on";
  if (off) return "off";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* Waiting for a specific reply                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolves with the first inbound message from `fromNumber`, or null on
 * timeout. Always unsubscribes — handlers left attached accumulate for the
 * life of the process.
 */
export function waitForReplyFrom(
  transport: SmsTransport,
  fromNumber: string,
  timeoutMs: number
): Promise<IncomingSms | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      unsubscribe();
      resolve(null);
    }, timeoutMs);

    const unsubscribe = transport.onReceive((msg) => {
      if (done) return;
      if (!numbersMatch(msg.fromNumber, fromNumber)) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(msg);
    });
  });
}
