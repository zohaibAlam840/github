/* Chapter 6 — Stopping a command, and the duplicate guard. */
import type { Page } from "playwright";
import { beat, clearCaption, click, say, titleCard } from "../narrator.ts";
import { go, signInQuietly } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  await signInQuietly(page, base);
  await titleCard(page, "Chapter 6", "Stopping and queueing", "What to do when you change your mind");

  await go(page, `${base}/buildings/unit?building=1&unit=1`);
  await say(page, "Commands take a few seconds — an SMS has to reach the building and come back.", 1);
  await click(page, "button:has-text('Check status now')");
  await say(page, "While one is running you can close this window. The command keeps going in the background.", 2);
  await beat(page, 1200);

  await say(page, "Stop is different. It gives up on waiting for the reply.", 3);
  await beat(page, 2500);
  await say(page, "Be clear about what Stop can and cannot do.", 4);
  await say(page, "If the SMS has already left the modem, there is no way to recall it — the valve may still act.", 5);
  await say(page, "So a stopped command is recorded as stopped, never as failed. The state is simply unknown again.", 6);
  await beat(page, 2500);

  await say(page, "You also cannot stack commands on one valve. A second press is refused while one is in flight.", 7);
  await beat(page, 2000);
  await clearCaption(page);
}
