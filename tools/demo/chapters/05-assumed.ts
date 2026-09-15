/* Chapter 5 — Assumed versus confirmed. The most important idea in the system. */
import type { Page } from "playwright";
import { beat, clearCaption, clearHighlight, highlight, say, titleCard } from "../narrator.ts";
import { go, signInQuietly } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  await signInQuietly(page, base);
  await titleCard(page, "Chapter 5", "Assumed or confirmed", "Why the system never claims to know more than it does");

  await go(page, `${base}/buildings/unit?building=1&unit=1`);
  await say(page, "This is the idea that matters most in the whole system.", 1);
  await say(page, "Sending a command is not the same as knowing it worked.", 2);
  await say(page, "The TRB's switching rule does not reply. So after turning a valve off, we know what we asked for — not what happened.", 3);
  await beat(page, 1500);

  await say(page, "When a state has not been verified, it is marked ASSUMED.", 4);
  await beat(page, 1500);
  await say(page, "Check status now sends a separate question and waits for the gateway's answer.", 5);
  await beat(page, 1500);
  await say(page, "Only then does the mark disappear, and the time changes from last sent to last confirmed.", 6);
  await beat(page, 1500);

  await go(page, `${base}/dashboard`);
  await say(page, "The same honesty runs through everything. Unknown means we have not heard — not that it is closed.", 7);
  await highlight(page, ".grid > div:nth-child(5)");
  await beat(page, 1500);
  await clearHighlight(page);
  await say(page, "A system controlling water supply should never show a confidence it has not earned.", 8);
  await clearCaption(page);
}
