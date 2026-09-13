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
