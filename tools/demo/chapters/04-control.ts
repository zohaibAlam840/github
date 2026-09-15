/* Chapter 4 — Turning a valve on and off. The core of the system. */
import type { Page } from "playwright";
import { beat, clearCaption, click, say, titleCard } from "../narrator.ts";
import { go, signInQuietly } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  await signInQuietly(page, base);
  await titleCard(page, "Chapter 4", "Controlling a valve", "Turning water on and off by SMS");

  await go(page, `${base}/buildings/unit?building=1&unit=1`);
  await say(page, "This is what the system is for: cutting or restoring water to one apartment.", 1);
  await say(page, "Each valve has three actions — turn on, turn off, and check the status now.", 2);
  await beat(page, 1000);

  await say(page, "Select Turn OFF to cut the supply.", 3);
  await click(page, "button:has-text('Turn OFF')");

  await say(page, "The command opens a live progress window. Nothing is hidden from you.", 4);
  await beat(page, 2500);
  await say(page, "An SMS goes to the TRB gateway in the building, which switches the relay.", 5);
  await beat(page, 3500);
  await say(page, "When the gateway replies, the valve is confirmed — and the exact message it sent is shown.", 6);
  await beat(page, 3000);
  await clearCaption(page);
}
