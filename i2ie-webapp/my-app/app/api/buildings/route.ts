import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/singleton";

export async function GET(req: Request) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json(getRepo().listBuildings());
}

export async function POST(req: Request) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json();
  return NextResponse.json(getRepo().createBuilding(body.name, body.address ?? ""), { status: 201 });
}
