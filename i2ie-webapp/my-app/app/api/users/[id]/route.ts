import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/singleton";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  getRepo().deleteUser(Number(id));
  return new Response(null, { status: 204 });
}
