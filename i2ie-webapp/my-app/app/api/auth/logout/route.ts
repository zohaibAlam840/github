import { bearerToken, destroySession } from "@/lib/server/auth";

export async function POST(req: Request) {
  const token = bearerToken(req.headers.get("authorization"));
  if (token) destroySession(token);
  return new Response(null, { status: 204 });
}
