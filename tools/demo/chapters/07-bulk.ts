/*
 * Chapter 7 — Sending to a whole building, and what happens when a TRB is
 * not answering.
 *
 * Doubles as the acceptance test for BulkSendProgress: the demo data has a
 * deliberately dead gateway, so this exercises the per-valve list, the
 * failure path, the skip, and the summary in one run.
 */

import type { Page } from "playwright";
import { beat, clearCaption, click, say, titleCard, type } from "../narrator.ts";

export async function run(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/login`);
  await page.waitForLoadState("networkidle");
  await type(page, "form input:not([type='password'])", "admin");
  await type(page, "form input[type='password']", "demo1234");
  await click(page, "form button[type='submit']");
  await page.waitForURL("**/dashboard**");

  await titleCard(
    page,
    "Chapter 7",
    "Sending to a whole building",
    "One command to every valve — and what happens when a gateway is down"
  );

  await page.goto(`${base}/buildings/detail?id=1`);
  await page.waitForLoadState("networkidle");
  await beat(page, 800);

  await say(page, "A building page can send one command to every valve in it.", 1);
  await say(page, "There is still only one modem, so they go out one at a time, in order.");

  await click(page, "button:has-text('Turn OFF')");
  await say(page, "Choose the command, then send to the whole building.", 2);
  await click(page, "button:has-text('Send to all')");

  await say(page, "Each valve appears as its own row — you can see exactly which one is being sent to.", 3);
  await beat(page, 6000);

  await say(page, "If a TRB stops answering, the system gives up on it rather than spending an SMS on every valve behind it.", 4);
  await beat(page, 10000);

  await say(page, "The skipped valves are listed, and the gateway is raised on the Alerts screen.", 5);
  await beat(page, 4000);
  await clearCaption(page);
}
