/**
 * Session tokens — deliberately simple: an in-memory Map, not JWTs or a
 * sessions table. This only ever runs on a trusted office LAN; a server
 * restart just means everyone logs in again, an acceptable trade for not
 * building token refresh/revocation machinery nothing here needs yet.
 */

import type { Role } from "../types";
import { newToken } from "./db";

export interface Session {
  userId: number;
  username: string;
  name: string;
  role: Role;
}

const sessions = new Map<string, Session>();

export function createSession(session: Session): string {
  const token = newToken();
  sessions.set(token, session);
  return token;
}

export function getSession(token: string | null): Session | null {
  if (!token) return null;
  return sessions.get(token) ?? null;
}

export function destroySession(token: string) {
  sessions.delete(token);
}

export function bearerToken(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

/** Shared guard for Route Handlers — reads the Authorization header from a Request. */
export function requireSession(req: Request): Session | null {
  return getSession(bearerToken(req.headers.get("authorization")));
}
