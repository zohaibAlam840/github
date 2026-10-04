import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/singleton";

/** One command, joined to its valve/unit/building/gateway — the detail screen. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const command = getRepo().getCommandLog(Number(id));
  if (!command) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(command);
}
