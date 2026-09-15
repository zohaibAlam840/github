/*
 * Records a chapter against the REAL system.
 *
 * No seeding, no mock worker, no demo database — the actual dashboard, the
 * actual data/i2i.db, and the actual seeded admin account. The commissioning
 * chapter is recorded this way on purpose: it is the one an engineer will
 * follow on the real machine, and a walkthrough filmed against a fixture is
 * worth less than one filmed against the thing itself.
 *
 *   npx tsx record-live.ts 12-addtrb
 *
 * IT WRITES REAL DATA. Whatever the chapter creates — a gateway, a building,
 * an apartment, a valve — is really created. Back the database up first, or
 * run it on a machine whose data you are willing to change.
 *
 * It does NOT send SMS: the chapter skips the verify step for exactly that
 * reason.
 */

import { chromium, type Page } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAPTERS } from "./chapters/index.ts";

const PORT = 3458;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_DIR = resolve(import.meta.dirname, "../../i2ie-webapp/my-app");
const REAL_DB = resolve(APP_DIR, "data/i2i.db");
const OUT_DIR = resolve(import.meta.dirname, "out");
const RAW_DIR = resolve(OUT_DIR, "raw");
const VIEWPORT = { width: 1280, height: 720 };

function findChromium(): string | undefined {
  const root = resolve(process.env.LOCALAPPDATA ?? process.env.HOME ?? "", "ms-playwright");
  let entries: string[] = [];
  try { entries = readdirSync(root); } catch { return undefined; }
  const found: { rev: number; path: string }[] = [];
  for (const entry of entries) {
    const m = /^chromium(?:_headless_shell)?-(\d+)$/.exec(entry);
    if (!m) continue;
    for (const rel of [
      "chrome-win64/chrome.exe", "chrome-win/chrome.exe",
      "chrome-headless-shell-win64/chrome-headless-shell.exe",
      "chrome-linux/chrome",
    ]) {
      const full = resolve(root, entry, rel);
      if (existsSync(full)) found.push({ rev: Number(m[1]), path: full });
    }
  }
  if (!found.length) return undefined;
  found.sort((a, b) =>
    Number(b.path.includes("chrome.exe")) - Number(a.path.includes("chrome.exe")) || b.rev - a.rev);
  return found[0].path;
}

async function waitFor(url: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { await fetch(url); return true; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return false;
}

async function main() {
  const name = process.argv[2];
  const chapter = CHAPTERS.find((c) => c.name === name);
  if (!chapter) {
    console.error(`Usage: npx tsx record-live.ts <chapter>\nKnown: ${CHAPTERS.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(RAW_DIR, { recursive: true });

  // A backup taken automatically, because this writes to real data and
  // "I should have copied it first" is not a recoverable position.
  if (existsSync(REAL_DB)) {
    const backup = `${REAL_DB}.before-recording`;
    copyFileSync(REAL_DB, backup);
    console.log(`[live] backed up the real database -> ${backup}`);
  }

  console.log(`[live] starting the REAL dashboard on ${PORT} (real database, no mock worker)...`);
  const server = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "start", "-p", String(PORT)],
    { cwd: APP_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
      shell: process.platform === "win32" }
  );
  if (!(await waitFor(BASE, 90_000))) {
    server.kill();
    throw new Error(`The dashboard did not start on ${PORT}.`);
  }
  console.log("[live] dashboard up");

  const browser = await chromium.launch({
    headless: true, slowMo: 220, executablePath: findChromium(),
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
    locale: "en-GB",
    timezoneId: "Asia/Qatar",
  });
  // See record.ts for why this shim is needed.
  await context.addInitScript(() => {
    (globalThis as unknown as { __name: unknown }).__name = (fn: unknown) => fn;
  });
  const page: Page = await context.newPage();

  let failed = false;
  try {
    await chapter.run(page, BASE);
  } catch (err) {
    failed = true;
    console.error(`[live] ${name} FAILED:`, (err as Error).message);
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      const src = await video.path();
      const dest = resolve(OUT_DIR, `${name}.webm`);
      rmSync(dest, { force: true });
      renameSync(src, dest);
      console.log(`[live] -> ${dest}`);
    }
    await browser.close();
    server.kill();
    try { for (const f of readdirSync(RAW_DIR)) rmSync(resolve(RAW_DIR, f), { force: true }); } catch {}
  }

  console.log(failed ? "[live] FAILED" : "[live] done");
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
