import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/*
 * LAN deployment model (updated 2026-08-23 — see lib/api.ts and app/api/):
 *
 * This app now runs as a real Next.js server (`next start`), not a static
 * export. The database (SQLite via node:sqlite) and the SMS-command queue
 * live inside this SAME process as Next.js Route Handlers under app/api/ —
 * no separate Express/local-api backend. The whole dashboard+data layer
 * ships as ONE Node process on the office PC, reachable from any browser on
 * the office network (http://<office-pc-ip>:3000). `sms-worker` is still a
 * genuinely separate process (needs direct LAN/serial access to the phone
 * or modem gateway, independent of any web request), reached over plain
 * HTTP the same way it always was.
 */
const nextConfig: NextConfig = {
  images: { unoptimized: true },
  /*
   * Pin the workspace root to THIS directory.
   *
   * Turbopack infers the root from the nearest lockfiles, and a stray
   * package-lock.json one level up made it pick the parent — which is how
   * a deployment ended up serving a route manifest that 404'd /api/auth/login
   * while other routes worked. Inference is not something a shipped app
   * should depend on.
   */
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
