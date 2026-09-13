import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/singleton";

export async function DELETE(req: Request) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  getRepo().resetPortfolio();
  return new Response(null, { status: 204 });
}
