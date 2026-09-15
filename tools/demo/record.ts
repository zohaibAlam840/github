/*
 * The recorder — runs chapters and produces the manual's video files.
 *
 * It owns the whole lifecycle deliberately: seed a fresh database, start a
 * dashboard pointed at THAT database on its own port, record, then stop.
 * Nothing here touches a running system or a real operator's data, and two
 * chapters can never disagree because one of them ran against leftover state.
 *
 *   npm run record            all chapters
 *   npm run record -- signin  just that one
 */

import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, renameSync, rmSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { seedDemo, DEMO_DB, MOCK_WORKER_PORT, type WorkerProfile } from "./seed.ts";
import { startMockWorker } from "./mockWorker.ts";
import { CHAPTERS } from "./chapters/index.ts";

/* A port of its own, so recording never collides with the real dashboard on
   3000 and never has to stop it. */
const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_DIR = resolve(import.meta.dirname, "../../i2ie-webapp/my-app");
const OUT_DIR = resolve(import.meta.dirname, "out");
const RAW_DIR = resolve(OUT_DIR, "raw");

/* 720p. Big enough to read the UI in the manual, small enough that twelve
   of these do not dominate the deployment. */
export const VIEWPORT = { width: 1280, height: 720 };

/*
 * Finds a Chromium that is actually on this machine.
 *
 * Playwright insists on ONE exact browser revision and refuses to launch
 * anything else, but `playwright install` needs to reach a CDN — which is
 * not a given on a machine behind a slow or filtered link, and is not a
 * given at all on the client's offline PC. Any recent Chromium records
 * video perfectly well, so prefer the pinned one and fall back to the
 * newest installed revision rather than failing outright.
 *
 * Returns undefined when the pinned browser is present, letting Playwright
 * do its normal thing.
 */
function findChromium(): string | undefined {
  const root = resolve(
    process.env.LOCALAPPDATA ?? process.env.HOME ?? "",
    "ms-playwright"
  );
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return undefined;
  }

  const candidates: { rev: number; path: string }[] = [];
  for (const entry of entries) {
    const m = /^chromium(?:_headless_shell)?-(\d+)$/.exec(entry);
    if (!m) continue;
    for (const rel of [
      "chrome-win64/chrome.exe",
      "chrome-win/chrome.exe",
      "chrome-headless-shell-win64/chrome-headless-shell.exe",
      "chrome-linux/chrome",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ]) {
      const full = resolve(root, entry, rel);
      if (existsSync(full)) candidates.push({ rev: Number(m[1]), path: full });
    }
  }
  if (candidates.length === 0) return undefined;

  // Full browser over headless shell (the shell cannot do headed runs), then
  // newest revision.
  candidates.sort(
    (a, b) =>
      Number(b.path.includes("chrome.exe")) - Number(a.path.includes("chrome.exe")) ||
      b.rev - a.rev
  );
  return candidates[0].path;
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

async function startDashboard(): Promise<ChildProcess> {
  console.log(`[rec] starting dashboard on ${PORT} against the demo database...`);
  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "start", "-p", String(PORT)],
    {
      cwd: APP_DIR,
      env: { ...process.env, DB_PATH: DEMO_DB, PORT: String(PORT) },
      stdio: "ignore",
      shell: process.platform === "win32",
    }
  );
  if (!(await waitForServer(BASE, 90_000))) {
    child.kill();
    throw new Error(
      `The dashboard did not start on ${PORT}. Run "npm run build" in ${APP_DIR} first.`
    );
  }
  console.log("[rec] dashboard up");
  return child;
}

async function recordChapter(
  browser: Browser,
  name: string,
  run: (page: Page, base: string) => Promise<void>
): Promise<void> {
  console.log(`\n[rec] === ${name} ===`);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
    // A fixed clock keeps timestamps identical across re-records, so the
    // manual's screenshots never drift out of step with the footage.
    locale: "en-GB",
    timezoneId: "Asia/Qatar",
  });
  /*
   * esbuild (inside tsx) compiles named functions with a `__name(...)`
   * helper to preserve Function.name. That helper exists in Node, but the
   * bodies we hand to page.evaluate are serialised and run in the BROWSER,
   * where it does not — so every evaluate throws "__name is not defined".
   * Defining it as identity in the page costs nothing and makes the
   * narration helpers work unchanged.
   */
  await context.addInitScript(() => {
    (globalThis as unknown as { __name: unknown }).__name = (fn: unknown) => fn;
  });

  const page = await context.newPage();

  try {
    await run(page, BASE);
  } catch (err) {
    console.error(`[rec] ${name} FAILED:`, (err as Error).message);
    throw err;
  } finally {
    // The video is only flushed to disk on context.close().
    const video = page.video();
    await context.close();
    if (video) {
      const src = await video.path();
      const dest = resolve(OUT_DIR, `${name}.webm`);
      rmSync(dest, { force: true });
      renameSync(src, dest);
      console.log(`[rec] -> ${dest}`);
    }
  }
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const chapters = (only.length
    ? CHAPTERS.filter((c) => only.includes(c.name))
    // Live chapters are recorded against the REAL system by record-live.ts.
    // Running them here would film the commissioning walkthrough against a
    // demo fixture, which is the opposite of the point.
    : CHAPTERS).filter((c) => !c.live || only.includes(c.name));

  if (chapters.length === 0) {
    console.error(
      `No chapter matched. Available: ${CHAPTERS.map((c) => c.name).join(", ")}`
    );
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(resolve(import.meta.dirname, "demo-data"), { recursive: true });

  seedDemo("healthy");

  const mock = await startMockWorker({ port: MOCK_WORKER_PORT });
  const server = await startDashboard();
  // slowMo is what separates a tutorial from a machine flickering through
  // screens: every Playwright action is paced so a viewer can follow it.
  const executablePath = findChromium();
  if (executablePath) console.log(`[rec] chromium: ${executablePath}`);
  const browser = await chromium.launch({ headless: true, slowMo: 220, executablePath });

  let failed = 0;
  try {
    for (const chapter of chapters) {
      try {
        /*
         * Reseed before EVERY chapter.
         *
         * Without this, chapter 7's failed and skipped commands would still
         * be sitting in the queue and the alerts list while chapter 8 is
         * recorded — so a video about the Logs screen would open on errors
         * that have nothing to do with it.
         */
        seedDemo(chapter.worker ?? "healthy");
        await recordChapter(browser, chapter.name, chapter.run);
      } catch {
        failed++;
      }
    }
  } finally {
    await browser.close();
    server.kill();
    mock.close();
    // Playwright leaves the pre-rename temp videos behind.
    try {
      for (const f of readdirSync(RAW_DIR)) rmSync(resolve(RAW_DIR, f), { force: true });
    } catch { /* nothing to clean */ }
  }

  console.log(
    `\n[rec] done: ${chapters.length - failed}/${chapters.length} chapters -> ${OUT_DIR}`
  );
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
