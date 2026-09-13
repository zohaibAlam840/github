import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/singleton";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json(getRepo().listUnitsByBuilding(Number(id)));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  return NextResponse.json(getRepo().createUnit(Number(id), body.name), { status: 201 });
}
