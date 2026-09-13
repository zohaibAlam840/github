/**
 * SSE stream — EventSource can't set custom headers, so the session token
 * travels as a query param for this one route only (every other route uses
 * a normal Authorization header). See lib/server/events.ts for the hub.
 */

import { getSession } from "@/lib/server/auth";
import { addClient, removeClient } from "@/lib/server/events";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = getSession(url.searchParams.get("token"));
  if (!session) return new Response(null, { status: 401 });

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval>;
  let thisController: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      thisController = controller;
      addClient(controller);
      controller.enqueue(encoder.encode(":ok\n\n"));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":hb\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeat);
      removeClient(thisController);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
