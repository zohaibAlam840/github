/* Chapter 11 — Arabic, dark mode, and phones. */
import type { Page } from "playwright";
import { beat, clearCaption, click, say, titleCard } from "../narrator.ts";
import { go, signInQuietly } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  await signInQuietly(page, base);
  await titleCard(page, "Chapter 11", "Arabic, dark mode and phones", "The same system, however it suits you");

  await go(page, `${base}/dashboard`);
  await say(page, "The whole dashboard is available in Arabic.", 1);
  await click(page, "button:has-text('العربية')");
  await beat(page, 2500);
  await say(page, "Not only translated — the entire layout flips to right-to-left, including the menu and the tables.", 2);
  await beat(page, 3000);

  await say(page, "Switch back at any time. The choice is remembered per person.", 3);
  await click(page, "button:has-text('English')").catch(() => {});
  await beat(page, 2000);

  await say(page, "There is a dark theme for a control room, or a screen left on all day.", 4);
  await click(page, "header button:nth-of-type(1)").catch(() => {});
  await beat(page, 2500);

  await say(page, "And it works on a phone — useful for a caretaker standing in the building.", 5);
  await page.setViewportSize({ width: 420, height: 860 });
  await beat(page, 2500);
  await say(page, "The menu folds away, and the controls stack instead of running off the edge.", 6);
  await go(page, `${base}/buildings`);
  await beat(page, 2500);
  await page.setViewportSize({ width: 1280, height: 720 });
  await beat(page, 1200);
  await clearCaption(page);
}
