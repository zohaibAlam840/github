import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/singleton";

/** Short, but not nothing — "admin" must stop being a valid password. */
const MIN_LENGTH = 8;

/**
 * PUT /api/users/:id/password
 *
 * Two cases, deliberately different:
 *   - Changing your OWN password requires the current one, so a walk-up at an
 *     unlocked screen cannot lock the real owner out.
 *   - An admin resetting SOMEONE ELSE'S does not — the whole point of a reset
 *     is that nobody knows the old one. An admin can already delete the
 *     account outright, so this grants no new power.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireSession(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const targetId = Number(id);
  const isSelf = targetId === session.userId;
  if (!isSelf && session.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can reset another user's password" }, { status: 403 });
  }

  const body = (await req.json()) as { currentPassword?: string; newPassword?: string };
  const newPassword = body.newPassword ?? "";
  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `The new password must be at least ${MIN_LENGTH} characters` },
      { status: 400 }
    );
  }

  try {
    getRepo().changePassword(targetId, newPassword, isSelf ? (body.currentPassword ?? "") : undefined);
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (code === "WRONG_PASSWORD") {
      return NextResponse.json({ error: "Your current password is not correct" }, { status: 400 });
    }
    if (code === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ error: code }, { status: 400 });
  }
  return new Response(null, { status: 204 });
}
