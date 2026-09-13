"use client";

/*
 * Auth context — real backend-backed (see lib/server/, app/api/auth/*).
 *
 * The user record is kept in localStorage so a refresh keeps you signed in;
 * the actual session TOKEN lives in lib/api.ts (restored synchronously at
 * module load, not here) and is attached to every request as
 * `Authorization: Bearer`. A 401 from any request (e.g. the server
 * restarted and its in-memory sessions are gone) forces a sign-out via
 * setUnauthorizedHandler below, instead of the UI hanging on stale state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setUnauthorizedHandler } from "./api";
import { connectEventStream, disconnectEventStream } from "./socket";
import type { Role, User } from "./types";

const STORAGE_KEY = "i2i.auth";

interface AuthContextValue {
  user: User | null;
  /** true once localStorage has been read (avoid redirect flicker). */
  ready: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  /** Can this user send valve commands? (admin + operator, NOT viewer) */
  canOperate: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setUser(null);
    window.localStorage.removeItem(STORAGE_KEY);
    disconnectEventStream();
    void api.auth.logout();
  }, []);

  // Restore the persisted session once, on the client. lib/api.ts already
  // restored the token itself at module-load time (see its own comment on
  // why that can't wait for this effect), so this just restores the user
  // record for rendering and reopens the live-events stream.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setUser(JSON.parse(raw) as User);
        connectEventStream();
      }
    } catch {
      // Corrupt storage -> treat as signed out.
    }
    setReady(true);
  }, []);

  // Any 401 (e.g. the server restarted and its in-memory sessions are gone)
  // forces a real sign-out instead of leaving stale "logged in" UI up with
  // every request quietly failing.
  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const u = await api.auth.login(username, password);
    setUser(u);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    connectEventStream();
    return u;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      login,
      logout,
      canOperate: user?.role === "admin" || user?.role === "operator",
      isAdmin: user?.role === "admin",
    }),
    [user, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Which roles may see a nav item / screen. */
export const ALL_ROLES: Role[] = ["admin", "operator", "viewer"];
