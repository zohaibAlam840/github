import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/singleton";
import type { Role } from "@/lib/types";

export async function GET(req: Request) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json(getRepo().listUsers());
}

export async function POST(req: Request) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json();
  try {
    const user = getRepo().createUser(body.name, body.username, body.password, body.role as Role);
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
