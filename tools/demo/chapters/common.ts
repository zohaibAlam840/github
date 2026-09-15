/*
 * Shared scaffolding for chapters.
 *
 * Every chapter starts from a clean browser context, so each one has to
 * sign in for itself — that is deliberate, because each video must stand
 * alone in the manual. Nobody watches chapter 9 having just watched 8.
 */

import type { Page } from "playwright";
import { beat, click, type } from "../narrator.ts";

/** Signs in without narrating it — chapter 1 is the one that explains this. */
export async function signInQuietly(
  page: Page,
  base: string,
  username = "admin",
  password = "demo1234"
): Promise<void> {
  await page.goto(`${base}/login`);
  await page.waitForLoadState("networkidle");
  await type(page, "form input:not([type='password'])", username);
  await type(page, "form input[type='password']", password);
  await click(page, "form button[type='submit']");
  await page.waitForURL("**/dashboard**", { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

/** Navigate and settle, so nothing is captured mid-render. */
export async function go(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await beat(page, 700);
}

/**
 * Signs out completely.
 *
 * Two places hold the session, and clearing only one leaves you signed in:
 * the server's cookie, and the user record lib/auth.tsx keeps in
 * localStorage so a refresh does not sign you out. With the cookie gone but
 * localStorage intact, the app still believes it is signed in and bounces
 * /login straight to /dashboard — so the next sign-in finds no form and
 * times out looking for it.
 *
 * Not done by navigating to /api/auth/logout either: that route only accepts
 * POST, so a browser GET lands on a Chrome error page which then interrupts
 * the next navigation.
 */
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear()).catch(() => {});
}
