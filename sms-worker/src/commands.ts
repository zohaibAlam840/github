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

export type RelayState = "open" | "closed" | "unknown";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

interface CommandConfig {
  replyOpenPattern: string;
  replyClosedPattern: string;
  defaultCountryCode: string;
}

// Defaults match the bench devices. loadConfig() overrides them at startup.
let cfg: CommandConfig = {
  replyOpenPattern: "open",
  replyClosedPattern: "clos",
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
/* Reply interpretation                                                */
/* ------------------------------------------------------------------ */

/**
 * Reads a relay state out of a TRB reply, e.g. "Relay - Closed".
 *
 * Two deliberate behaviours:
 *
 *  - The words are configurable. The device's Message text template is
 *    editable, so a client's units may word this differently.
 *
 *  - If a reply matches BOTH patterns it returns "unknown" rather than
 *    picking the first. A TRB141 has two relays, and a status reply that
 *    reports both ("Relay1 - Open, Relay2 - Closed") cannot be attributed to
 *    one valve. Guessing there would silently show the wrong state on the
 *    dashboard; "unknown" is visible and prompts a real fix.
 */
export function parseRelayState(replyText: string): RelayState {
  const t = replyText.toLowerCase();
  const open = cfg.replyOpenPattern ? t.includes(cfg.replyOpenPattern.toLowerCase()) : false;
  const closed = cfg.replyClosedPattern ? t.includes(cfg.replyClosedPattern.toLowerCase()) : false;

  if (open && closed) return "unknown"; // ambiguous — see above
  if (open) return "open";
  if (closed) return "closed";
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
