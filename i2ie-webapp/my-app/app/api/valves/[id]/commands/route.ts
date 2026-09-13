import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getQueue } from "@/lib/server/singleton";
import type { CommandAction } from "@/lib/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireSession(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const action = body.action as CommandAction;
  try {
    const command = getQueue().queueCommand(Number(id), action, session.userId, session.name);
    return NextResponse.json(command, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
