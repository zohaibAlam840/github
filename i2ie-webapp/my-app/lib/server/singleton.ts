/**
 * Module-scope state (the SQLite connection, the queue engine's in-memory
 * lane) must survive Next.js dev-mode hot-reload, which otherwise
 * re-evaluates route modules and would silently reset it — the same
 * globalThis-caching pattern the Next.js docs recommend for a Prisma
 * client. In production (`next start`) this just runs once anyway.
 */

import { openDb } from "./db";
import { createRepo, type Repo } from "./repo";
import { createQueueEngine, type QueueEngine } from "./queue";

declare global {
  // eslint-disable-next-line no-var
  var __i2iRepo: Repo | undefined;
  // eslint-disable-next-line no-var
  var __i2iQueue: QueueEngine | undefined;
}

function init(): { repo: Repo; queue: QueueEngine } {
  const dbPath = process.env.DB_PATH ?? "./data/i2i.db";
  const db = openDb(dbPath);
  const repo = createRepo(db);
  const queue = createQueueEngine(repo);
  queue.resumeOnStartup();
  console.log(`[i2i] SQLite database ready: ${dbPath}`);
  return { repo, queue };
}

export function getRepo(): Repo {
  if (!global.__i2iRepo) {
    const { repo, queue } = init();
    global.__i2iRepo = repo;
    global.__i2iQueue = queue;
  }
  return global.__i2iRepo;
}

export function getQueue(): QueueEngine {
  if (!global.__i2iQueue) getRepo();
  return global.__i2iQueue!;
}
