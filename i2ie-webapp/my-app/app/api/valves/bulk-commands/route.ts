import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getQueue } from "@/lib/server/singleton";
import type { CommandAction } from "@/lib/types";

export async function POST(req: Request) {
  const session = requireSession(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json();
  const valveIds = body.valveIds as number[];
  const action = body.action as CommandAction;
  const commands = getQueue().queueBulkCommand(valveIds, action, session.userId, session.name);
  return NextResponse.json(commands, { status: 202 });
}
