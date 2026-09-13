import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/singleton";

export async function GET(req: Request) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json(getRepo().listGateways());
}

export async function POST(req: Request) {
  if (!requireSession(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json();
  return NextResponse.json(
    getRepo().createGateway(body.label, body.simNumber, body.numOutputs, body.authPassword ?? null),
    { status: 201 }
  );
}
