/* Chapter 8 — The queue, the logs, and finding things. */
import type { Page } from "playwright";
import { beat, clearCaption, clearHighlight, click, highlight, say, titleCard, type } from "../narrator.ts";
import { go, signInQuietly } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  await signInQuietly(page, base);

  // Put some history on the record so the screens have something to show.
  await go(page, `${base}/buildings/detail?id=2`);
  await click(page, "button:has-text('Check status now')").catch(() => {});
  await click(page, "button:has-text('Send to all')").catch(() => {});
  await beat(page, 9000);

  await titleCard(page, "Chapter 8", "Queue and history", "Everything that happened, and how to find it");

  await go(page, `${base}/queue`);
  await say(page, "There is one modem, so commands go out one at a time. This is that line.", 1);
  await say(page, "Every command shows its exact SMS text, its status, and the reply that came back.", 2);
  await beat(page, 1500);

  await say(page, "You can narrow the list by date, by building, by TRB gateway, or by status.", 3);
  await beat(page, 1200);
  await say(page, "Use this when a resident calls about one apartment, or when one gateway is misbehaving.", 4);
  await beat(page, 1500);

  await say(page, "The valve, building and TRB in each row are links — they take you straight to it.", 5);
  await beat(page, 1500);

  await go(page, `${base}/logs`);
  await say(page, "Logs is the permanent record. Same filters, and it exports to a spreadsheet.", 6);
  await beat(page, 1500);
  await say(page, "Every command is stored against the person who sent it. There are no shared accounts.", 7);
  await beat(page, 1500);
  await clearCaption(page);
}
