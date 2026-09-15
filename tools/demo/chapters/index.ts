/*
 * The chapter list. Order here is the order in the manual.
 *
 * `name` becomes the video filename and the argument to
 * `npm run record -- <name>`, so keep it short and stable — the manual
 * page references these names.
 */

import type { Page } from "playwright";
import type { WorkerProfile } from "../seed.ts";
import { run as signin } from "./01-signin.ts";
import { run as roles } from "./02-roles.ts";
import { run as buildings } from "./03-buildings.ts";
import { run as control } from "./04-control.ts";
import { run as assumed } from "./05-assumed.ts";
import { run as stop } from "./06-stop.ts";
import { run as bulk } from "./07-bulk.ts";
import { run as queue } from "./08-queue.ts";
import { run as modem } from "./09-modem.ts";
import { run as settings } from "./10-settings.ts";
import { run as arabic } from "./11-arabic.ts";
import { run as addtrb } from "./12-addtrb.ts";

export interface Chapter {
  name: string;
  title: string;
  run: (page: Page, base: string) => Promise<void>;
  /**
   * Which worker this chapter is recorded against. Defaults to "healthy" —
   * only chapters that are ABOUT failure should ever see a failing one.
   */
  worker?: WorkerProfile;
  /** Recorded against the real system by record-live.ts, not the demo seed. */
  live?: boolean;
}

export const CHAPTERS: Chapter[] = [
  { name: "01-signin", title: "Signing in", run: signin },
  { name: "02-roles", title: "Roles", run: roles },
  { name: "03-buildings", title: "Buildings and apartments", run: buildings },
  { name: "04-control", title: "Controlling a valve", run: control },
  { name: "05-assumed", title: "Assumed or confirmed", run: assumed },
  { name: "06-stop", title: "Stopping and queueing", run: stop },
  // The only chapter that is ABOUT failure, so the only one pointed at a
  // worker that is not there.
  { name: "07-bulk", title: "Sending to a whole building", run: bulk, worker: "failing" },
  { name: "08-queue", title: "Queue and history", run: queue },
  { name: "09-modem", title: "The modem", run: modem },
  { name: "10-settings", title: "Settings and alerts", run: settings },
  { name: "11-arabic", title: "Arabic, dark mode and phones", run: arabic },
  /*
   * Recorded with record-live.ts against the REAL system, not the demo
   * fixture - see that file. It is listed here so the chapter list stays
   * the single source of truth, but the normal recorder should not run it.
   */
  { name: "12-addtrb", title: "Adding a TRB gateway", run: addtrb, live: true },
];
