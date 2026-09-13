import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/singleton";

export async function GET(req: Request) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  return NextResponse.json(getRepo().listCommandLogs(limit));
}
