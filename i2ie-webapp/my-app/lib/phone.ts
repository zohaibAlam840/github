/**
 * Loose SIM-number match — the same rule sms-worker/src/commands.ts uses,
 * because a number shows up in different formats across the phone gateway's
 * webhook, a modem's CMGL reply, and however a gateway was typed into the
 * dashboard (+974..., 00974..., local). Matching on the last 8 digits
 * avoids false negatives from format differences without a shared library
 * between the two projects.
 */
export function numbersMatch(a: string, b: string): boolean {
  return a.includes(b.replace(/^\+/, "").slice(-8)) || b.includes(a.replace(/^\+/, "").slice(-8));
}

/**
 * The country code assumed for numbers typed without one.
 *
 * Deliberately one named constant rather than a literal scattered through
 * forms. It must agree with DEFAULT_COUNTRY_CODE in the worker's .env — the
 * worker normalises again on the send path, and disagreeing codes would turn
 * a local number into a different one at each end. Change both together if
 * this system is ever deployed outside Qatar.
 */
export const DEFAULT_COUNTRY_CODE = "+974";

/**
 * Rewrites a typed number into the international form AT+CMGS requires.
 *
 * People type "0097466214698", "066214698", "66214698" and "+97466214698"
 * and mean the same SIM. The modem does not: AT+CMGS wants one consistent
 * form, and a gateway stored in local format simply fails to send. Mirrors
 * normalizeNumber() in sms-worker/src/commands.ts — keep the two in step.
 *
 * Idempotent: a number already starting with "+" is returned untouched, so
 * running this on every blur and again on save cannot corrupt it.
 */
export function normalizePhone(raw: string, countryCode = DEFAULT_COUNTRY_CODE): string {
  const trimmed = raw.replace(/[\s\-()]/g, "");
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("00")) return `+${trimmed.slice(2)}`;
  if (!countryCode) return trimmed;
  if (trimmed.startsWith("0")) return `${countryCode}${trimmed.slice(1)}`;
  return `${countryCode}${trimmed}`;
}
