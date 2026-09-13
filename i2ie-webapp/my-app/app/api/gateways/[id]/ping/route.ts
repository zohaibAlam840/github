import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getQueue } from "@/lib/server/singleton";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const result = await getQueue().pingGateway(Number(id));
  return NextResponse.json(result);
}
