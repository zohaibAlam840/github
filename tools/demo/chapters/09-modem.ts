/* Chapter 9 — The modem: what to look at when nothing is sending. */
import type { Page } from "playwright";
import { beat, clearCaption, clearHighlight, highlight, say, titleCard } from "../narrator.ts";
import { go, signInQuietly } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  await signInQuietly(page, base);
  await titleCard(page, "Chapter 9", "The modem", "The first screen to open when nothing is sending");

  await go(page, `${base}/modem`);
  await say(page, "Every SMS leaves through one modem plugged into this PC. This screen is its health.", 1);
  await say(page, "The dashboard does not talk to the modem directly — a separate worker program owns the port.", 2);
  await beat(page, 1200);
  await say(page, "This line says whether that worker is running. If it is not, nothing can be sent.", 3);
  await beat(page, 1500);

  await say(page, "Below is exactly which device is attached — model, IMEI, firmware, and which COM port.", 4);
  await beat(page, 2000);
  await say(page, "The port name matters. A SIM7600 exposes several; only the AT port accepts commands.", 5);
  await beat(page, 1800);

  await say(page, "Then the network: the operator, signal strength, whether the SIM is registered, and the SMS centre.", 6);
  await beat(page, 2200);
  await say(page, "A SIM does not store its own number, so it is recorded here by hand once.", 7);
  await beat(page, 1800);

  await say(page, "Message storage matters more than it looks. If the SIM fills up, replies silently stop arriving.", 8);
  await beat(page, 2000);

  await say(page, "Finally, every serial port on the PC, and the reason each one was rejected.", 9);
  await beat(page, 2000);
  await say(page, "Rescan looks again. Test SMS proves the whole chain with one real message.", 10);
  await beat(page, 1500);
  await clearCaption(page);
}
