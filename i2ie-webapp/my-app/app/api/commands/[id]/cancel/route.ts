import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getQueue } from "@/lib/server/singleton";

/**
 * POST /api/commands/:id/cancel — stop waiting on a command.
 *
 * Viewers cannot cancel: it changes a valve's recorded state to unverified,
 * which is a write, not a read.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireSession(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (session.role === "viewer") {
    return NextResponse.json({ error: "Viewer accounts cannot stop commands" }, { status: 403 });
  }
  const { id } = await params;
  const command = getQueue().cancelCommand(Number(id), session.name);
  if (!command) return NextResponse.json({ error: "Command not found" }, { status: 404 });
  return NextResponse.json(command);
}
