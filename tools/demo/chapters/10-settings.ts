/* Chapter 10 — Settings, and the alerts screen. */
import type { Page } from "playwright";
import { beat, clearCaption, say, titleCard } from "../narrator.ts";
import { go, signInQuietly } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  await signInQuietly(page, base);
  await titleCard(page, "Chapter 10", "Settings and alerts", "Tuning the system, and what needs attention");

  await go(page, `${base}/settings`);
  await say(page, "Settings is where the system is matched to the gateways in the field. Administrators only.", 1);
  await say(page, "These three keywords are the exact words sent to a TRB. They must match its SMS rules exactly.", 2);
  await beat(page, 2200);
  await say(page, "These two are what we look for in a reply to decide whether a valve is on or off.", 3);
  await beat(page, 2000);
  await say(page, "Pacing controls how fast commands leave, how many retries, and how long to wait for a reply.", 4);
  await beat(page, 2000);

  await say(page, "Confirmation is a real trade. On, every command costs two messages but the state is verified.", 5);
  await beat(page, 1800);
  await say(page, "Off, it costs one — and the valve's state is marked assumed until you check it.", 6);
  await beat(page, 1800);

  await say(page, "And this decides when to give up on a gateway that is not answering, instead of trying every valve behind it.", 7);
  await beat(page, 2200);

  await go(page, `${base}/alerts`);
  await say(page, "Alerts gathers everything that needs a look — unreachable gateways, unknown valves, failed commands.", 8);
  await beat(page, 2500);
  await say(page, "If a bulk send skipped a gateway, this is where it appears.", 9);
  await beat(page, 1500);
  await clearCaption(page);
}
