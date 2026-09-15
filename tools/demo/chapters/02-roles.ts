/* Chapter 2 — Roles: who can do what, and why the screens differ. */
import type { Page } from "playwright";
import { beat, clearCaption, clearHighlight, highlight, say, titleCard } from "../narrator.ts";
import { go, signInQuietly, signOut } from "./common.ts";

export async function run(page: Page, base: string): Promise<void> {
  await signInQuietly(page, base);
  await titleCard(page, "Chapter 2", "Roles", "Admin, operator and viewer — and what each one sees");

  await say(page, "There are three kinds of account, and the system enforces the difference.", 1);
  await highlight(page, "nav");
  await say(page, "Signed in as an administrator, the menu shows everything — including Gateways, Settings and Users.");
  await clearHighlight(page);

  await say(page, "An administrator sets the system up: adds TRB gateways, changes keywords, manages accounts.", 2);
  await beat(page, 800);

  await signOut(page);
  await signInQuietly(page, base, "operator", "demo1234");
  await say(page, "This is the same system, signed in as an operator.", 3);
  await highlight(page, "nav");
  await say(page, "Gateways, Settings and Users are gone. An operator runs the system; they do not reconfigure it.");
  await clearHighlight(page);
  await say(page, "They keep the Modem screen, because they are the person standing next to the PC when sends stop working.");

  await signOut(page);
  await signInQuietly(page, base, "viewer", "demo1234");
  await say(page, "And as a viewer.", 4);
  await go(page, `${base}/buildings/unit?building=1&unit=1`);
  await say(page, "A viewer sees everything but can change nothing — there are no Turn ON or Turn OFF buttons at all.");
  await beat(page, 1500);
  await say(page, "The buttons are not merely hidden. The server refuses the command too.", 5);
  await clearCaption(page);
}
