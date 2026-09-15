/*
 * Chapter 1 — Signing in, and what the dashboard is telling you.
 *
 * The first thing anyone sees, so it sets the tone for the whole manual:
 * one idea per caption, nothing clicked without the pointer visibly going
 * there first, and a pause after every change so the viewer can take it in.
 *
 * Selectors are deliberately structural (input types, href, aria) rather
 * than text-based. Caption text is English, but the UI is bilingual, and a
 * selector matching a translated string would break the moment this is
 * re-recorded in Arabic.
 */

import type { Page } from "playwright";
import {
  beat,
  clearCaption,
  clearHighlight,
  click,
  highlight,
  say,
  titleCard,
  type,
} from "../narrator.ts";

export async function run(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/login`);
  await page.waitForLoadState("networkidle");

  await titleCard(
    page,
    "Chapter 1",
    "Signing in",
    "Getting into the dashboard, and reading the main screen"
  );

  await say(page, "The dashboard opens at the sign-in screen. Every person has their own account.", 1);

  await highlight(page, "form");
  await say(page, "There are no shared logins. Who did what is recorded against a name.");
  await clearHighlight(page);

  await say(page, "Type your username.", 2);
  await type(page, "form input:not([type='password'])", "admin");

  await say(page, "Then your password.", 3);
  await type(page, "form input[type='password']", "demo1234");

  await say(page, "Select Sign in.", 4);
  await click(page, "form button[type='submit']");

  await page.waitForURL("**/dashboard**", { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  await clearCaption(page);
  await beat(page, 900);

  await say(page, "This is the dashboard — the state of every valve you look after, at a glance.", 5);

  // --- the six tiles ---
  await highlight(page, ".grid > div:nth-child(1)");
  await say(page, "How many buildings are on the system.");

  await highlight(page, ".grid > div:nth-child(2)");
  await say(page, "And how many valves in total.");

  await highlight(page, ".grid > div:nth-child(3)");
  await say(page, "Valves currently on — water flowing to those apartments.");

  await highlight(page, ".grid > div:nth-child(4)");
  await say(page, "Valves currently off — supply cut.");

  await highlight(page, ".grid > div:nth-child(5)");
  await say(page, "Unknown means we have not heard from the valve, so we do not claim to know.");

  await highlight(page, ".grid > div:nth-child(6)");
  await say(page, "And anything still waiting on a reply shows here.");
  await clearHighlight(page);

  // --- portfolio and activity ---
  await say(page, "Below, the same picture broken down building by building.", 6);
  await highlight(page, "h2:has-text('by building'), h2 >> nth=0");
  await beat(page, 800);
  await clearHighlight(page);

  await say(page, "The coloured bar on each building shows its valves at a glance.");

  await say(page, "On the right, live activity — every command and reply as it happens.", 7);
  await highlight(page, "h2 >> nth=1");
  await beat(page, 800);
  await clearHighlight(page);

  await say(page, "You never need to refresh this page. It updates itself.");

  // --- the top bar ---
  await say(page, "Along the top: how many commands are queued right now.", 8);
  await highlight(page, "header a[href='/queue'], header >> text=Queue");
  await beat(page, 900);
  await clearHighlight(page);

  await say(page, "And whether the SMS modem is connected. If this is not green, nothing can be sent.");
  await beat(page, 800);

  // --- the sidebar ---
  await say(page, "Everything else is down the left.", 9);
  await highlight(page, "nav");
  await say(page, "What you see here depends on your role — an operator sees fewer items than an administrator.");
  await clearHighlight(page);

  await say(page, "That is the dashboard. Next: what each role is allowed to do.", 10);
  await clearCaption(page);
  await beat(page, 1200);
}
