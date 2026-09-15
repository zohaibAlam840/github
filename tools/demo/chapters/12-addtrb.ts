/*
 * Chapter 12 — Adding a TRB gateway and wiring it to an apartment.
 *
 * The commissioning workflow: what you do once per device, on the day the
 * hardware goes in. It was the gap in the manual — every other chapter
 * assumes the gateways already exist.
 *
 * Recorded against the REAL system: the real database, the real worker
 * address, and the real admin account. No mock worker and no seeded demo
 * data, because this chapter is what someone will follow on the actual
 * machine, and a tutorial that only works against a fixture is worth less
 * than one recorded against the thing itself.
 *
 * The verify step is deliberately SKIPPED on camera. It sends a real SMS to
 * the number typed in, and spending credit to make a video — on a prepaid
 * SIM that is already short — would be a poor trade. The chapter says so
 * rather than quietly stepping past it.
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
import { go, signInQuietly } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  // The real seeded administrator, not a demo account.
  await signInQuietly(page, base, "admin", "admin");

  await titleCard(
    page,
    "Chapter 12",
    "Adding a TRB gateway",
    "Registering a new device and wiring it to an apartment"
  );

  await go(page, `${base}/gateways`);
  await say(page, "A gateway is a TRB141 in a building. It receives the SMS and switches the relay.", 1);
  await say(page, "Everything else in the system hangs off gateways, so this is the first thing set up.", 2);

  await say(page, "Guided setup walks through it in three steps.", 3);
  await click(page, "a[href='/gateways/new'], button:has-text('Guided setup')");
  await beat(page, 1200);

  // --- Step 1: identify the device --------------------------------------
  await say(page, "First, a name you will recognise. Use the building, not a serial number.", 4);
  await type(page, "form input >> nth=0", "GW-MANSOURA-04");

  await say(page, "Then the SIM number in the TRB. This is the address every command is sent to.", 5);
  await type(page, "form input >> nth=1", "055 123 4567");
  await beat(page, 1200);
  await say(page, "Local formats are accepted and corrected — it becomes a full Qatar number when you leave the field.", 6);
  await beat(page, 1800);

  await say(page, "If the TRB's SMS rules use password authorization, put that password here.", 7);
  await say(page, "Leave it blank if the rules are set to No authorization. It is added to the front of every command.", 8);
  await beat(page, 1000);

  await click(page, "form button[type='submit']");
  await beat(page, 1500);

  // --- Step 2: verification, explained but not spent --------------------
  await say(page, "Step two offers to ping the device to prove it answers.", 9);
  await say(page, "That sends a real SMS and costs real credit, so it is skipped here — do run it on a real install.", 10);
  await beat(page, 1200);
  await click(page, "button:has-text('Skip for now')");
  await beat(page, 1500);

  // --- Step 3: wire a valve to an apartment ----------------------------
  await say(page, "Step three connects the gateway to the place it actually controls.", 11);

  await say(page, "If the building does not exist yet, add it here without leaving the wizard.", 12);
  await type(page, "input[placeholder*='building' i] >> nth=0", "Al Mansoura Tower");
  await click(page, "button:has-text('Add') >> nth=0");
  await beat(page, 1500);

  await say(page, "Then the apartment.", 13);
  await type(page, "input[placeholder*='Apartment' i], input[placeholder*='Unit' i] >> nth=0", "Apartment 402");
  await click(page, "button:has-text('Add') >> nth=1");
  await beat(page, 1500);

  await say(page, "Finally the valve itself — whatever code is on the pipe or the plan.", 14);
  await type(page, "input[placeholder*='SN' i], input[placeholder*='Valve' i] >> nth=0", "SN0042");
  await beat(page, 1000);

  await say(page, "That is the link the system remembers: this apartment, on this gateway.", 15);
  await click(page, "button[type='submit']:has-text('Add this valve'), form button[type='submit']");
  await beat(page, 2000);

  await say(page, "Add more valves the same way, or finish.", 16);
  await click(page, "button:has-text('Finish')");
  await beat(page, 2000);

  await say(page, "The gateway is registered and the apartment can now be controlled from the Buildings screen.", 17);
  await beat(page, 2000);
  await clearCaption(page);
}
