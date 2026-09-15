/* Chapter 3 — Buildings, apartments and valves. */
import type { Page } from "playwright";
import { beat, clearCaption, clearHighlight, click, highlight, say, titleCard, type } from "../narrator.ts";
import { go, signInQuietly } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  await signInQuietly(page, base);
  await titleCard(page, "Chapter 3", "Buildings and apartments", "How the portfolio is organised");

  await go(page, `${base}/buildings`);
  await say(page, "Everything is organised the way the property is: buildings, then apartments, then valves.", 1);
  await say(page, "Search finds a building or an apartment by name.", 2);
  await type(page, "input[placeholder*='Search'], input[type='search']", "Mansoura");
  await beat(page, 1500);
  await type(page, "input[placeholder*='Search'], input[type='search']", "");

  await go(page, `${base}/buildings/detail?id=1`);
  await say(page, "Opening a building shows its own summary — how many valves are on, off, or unknown.", 3);
  await highlight(page, ".grid > div:nth-child(3)");
  await beat(page, 1200);
  await clearHighlight(page);

  await say(page, "Adding an apartment is the first thing on the page, because it is the thing you do most.", 4);
  await beat(page, 1200);

  await say(page, "The first few apartments are shown here; the rest have their own page with search and paging.", 5);
  await beat(page, 1500);

  await go(page, `${base}/buildings/unit?building=1&unit=1`);
  await say(page, "Inside an apartment are its valves — each one wired to one output on one TRB gateway.", 6);
  await beat(page, 1500);
  await clearCaption(page);
}
