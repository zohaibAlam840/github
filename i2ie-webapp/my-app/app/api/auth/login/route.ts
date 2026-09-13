import { NextResponse } from "next/server";
import { getRepo } from "@/lib/server/singleton";
import { createSession } from "@/lib/server/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = body?.username as string | undefined;
  const password = body?.password as string | undefined;
  if (!username || !password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }
  const user = getRepo().verifyLogin(username, password);
  if (!user) return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  const token = createSession({ userId: user.id, username: user.username, name: user.name, role: user.role });
  return NextResponse.json({ user, token });
}
