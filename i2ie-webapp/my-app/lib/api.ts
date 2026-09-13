/*
 * Typed API client — the ONLY place screens get data from.
 *
 * Calls the real backend now: Next.js Route Handlers under app/api/,
 * backed by SQLite (see lib/server/). Same-origin relative paths always —
 * this app and its API ship as one Next.js server, reachable from any
 * browser on the office LAN at http://<office-pc-ip>:3000, so a hardcoded
 * host would break that.
 */

import type {
  ActivityEvent,
  Building,
  BuildingStats,
  Command,
  CommandAction,
  CommandLog,
  DashboardSummary,
  Gateway,
  PingResult,
  Role,
  Settings,
  Unit,
  User,
  Valve,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const TOKEN_KEY = "i2i.token";

// Restored synchronously at module load (not inside a React effect) so it's
// already available the moment any component's mount-time effect calls an
// api.* function or lib/socket.ts's onAppEvent — no race with AuthProvider's
// own restore effect, which runs later (parent effects fire after children).
let authToken: string | null =
  typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Fired once on any 401 so the app can redirect to /login/ instead of hanging. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

/**
 * Two failures that are ROUTINE, not bugs.
 *
 * The session expiring, and the dev server restarting under a poller, both
 * reject a fetch that nobody awaited — every screen fires timers, and there
 * are ~35 of these call sites. Patching each with .catch() is churn that
 * regresses the moment someone adds the 36th, so they are typed here and
 * swallowed once at the boundary (app/providers.tsx). Anything NOT one of
 * these still surfaces as a real unhandled rejection, which is the point.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

/** The dashboard server could not be reached at all — restarting, or down. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "NetworkError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    // "TypeError: Failed to fetch" — the server is not answering. The next
    // poll tick recovers on its own, so this must not read as a crash.
    throw new NetworkError(err);
  }

  if (res.status === 401) {
    setAuthToken(null);
    onUnauthorized?.();
    throw new UnauthenticatedError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined });
const del = (path: string) => request<void>(path, { method: "DELETE" });

export const api = {
  auth: {
    /** POST /api/auth/login  { username, password } -> { user, token } */
    async login(username: string, password: string): Promise<User> {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "INVALID_CREDENTIALS");
      }
      const data = (await res.json()) as { user: User; token: string };
      setAuthToken(data.token);
      return data.user;
    },
    /** POST /api/auth/logout — best-effort, invalidates the server-side session. */
    async logout(): Promise<void> {
      try {
        await post<void>("/api/auth/logout");
      } catch {
        // Already unauthenticated or unreachable — clearing the local token is enough.
      }
      setAuthToken(null);
    },
  },

  dashboard: {
    /** GET /api/dashboard/summary */
    summary: () => get<DashboardSummary>("/api/dashboard/summary"),
    /** GET /api/dashboard/buildings  (buildings + status distribution) */
    buildingStats: () => get<BuildingStats[]>("/api/dashboard/buildings"),
    /** GET /api/dashboard/activity  (recent events, newest first) */
    activity: () => get<ActivityEvent[]>("/api/dashboard/activity"),
  },

  buildings: {
    /** GET /api/buildings */
    list: () => get<Building[]>("/api/buildings"),
    /** POST /api/buildings  { name, address? } */
    create: (name: string, address: string) => post<Building>("/api/buildings", { name, address }),
    /** DELETE /api/buildings/:id */
    remove: (id: number) => del(`/api/buildings/${id}`),
  },

  units: {
    /** GET /api/buildings/:id/units */
    listByBuilding: (buildingId: number) => get<Unit[]>(`/api/buildings/${buildingId}/units`),
    /** GET /api/units — every unit, unscoped (gateway detail page etc). */
    list: () => get<Unit[]>("/api/units"),
    /** POST /api/buildings/:id/units  { name } */
    create: (buildingId: number, name: string) => post<Unit>(`/api/buildings/${buildingId}/units`, { name }),
    /** DELETE /api/units/:id */
    remove: (id: number) => del(`/api/units/${id}`),
  },

  valves: {
    /** GET /api/valves?buildingId= */
    listByBuilding: (buildingId: number) => get<Valve[]>(`/api/valves?buildingId=${buildingId}`),
    /** GET /api/valves — every valve, unscoped (gateway detail page etc). */
    list: () => get<Valve[]>("/api/valves"),
    /**
     * POST /api/valves/:id/commands  { action } -> 202 { command }
     * Returns immediately with the QUEUED command; the outcome arrives
     * later over the live-events layer (command:update / valve:update).
     */
    queueCommand: (valveId: number, action: CommandAction) =>
      post<Command>(`/api/valves/${valveId}/commands`, { action }),
    /**
     * POST /api/valves/bulk-commands  { valveIds, action } -> 202 { commands }
     * Same single lane, same pacing — see the server queue's own comment.
     * Returns only the commands actually queued (already-pending valves skipped).
     */
    queueBulkCommand: (valveIds: number[], action: CommandAction) =>
      post<Command[]>("/api/valves/bulk-commands", { valveIds, action }),
    /** POST /api/units/:id/valves  { valveCode, gatewayId, outputIndex } */
    create: (unitId: number, valveCode: string, gatewayId: number, outputIndex: 1 | 2) =>
      post<Valve>(`/api/units/${unitId}/valves`, { valveCode, gatewayId, outputIndex }),
    /** DELETE /api/valves/:id */
    remove: (id: number) => del(`/api/valves/${id}`),
  },

  gateways: {
    /** GET /api/gateways */
    list: () => get<Gateway[]>("/api/gateways"),
    /**
     * POST /api/gateways/:id/ping — reachability check via the gateway's
     * own configured status keyword (see lib/server/queue.ts's pingGateway).
     */
    ping: (gatewayId: number) => post<PingResult>(`/api/gateways/${gatewayId}/ping`),
    /** POST /api/gateways  { label, simNumber, numOutputs, authPassword } */
    create: (label: string, simNumber: string, numOutputs: 1 | 2, authPassword: string | null = null) =>
      post<Gateway>("/api/gateways", { label, simNumber, numOutputs, authPassword }),
    /** DELETE /api/gateways/:id */
    remove: (id: number) => del(`/api/gateways/${id}`),
    /** Valve count per gateway. */
    async valveCounts(): Promise<Map<number, number>> {
      const obj = await get<Record<string, number>>("/api/gateways/valve-counts");
      return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
    },
  },

  settings: {
    /** GET /api/settings */
    get: () => get<Settings>("/api/settings"),
    /** PUT /api/settings */
    update: (patch: Partial<Settings>) => put<Settings>("/api/settings", patch),
  },

  users: {
    /** GET /api/users */
    list: () => get<User[]>("/api/users"),
    /** POST /api/users  { name, username, password, role } */
    create: (name: string, username: string, password: string, role: Role) =>
      post<User>("/api/users", { name, username, password, role }),
    /** DELETE /api/users/:id */
    remove: (id: number) => del(`/api/users/${id}`),
    /** PUT /api/users/:id/password — own change needs currentPassword; an admin reset does not. */
    changePassword: (id: number, newPassword: string, currentPassword?: string) =>
      put<void>(`/api/users/${id}/password`, { newPassword, currentPassword }),
  },

  commands: {
    /** GET /api/commands?limit= — joined log rows, newest first. */
    list: (limit = 100) => get<CommandLog[]>(`/api/commands?limit=${limit}`),
    /** POST /api/commands/:id/cancel — stop waiting; the SMS may already be gone. */
    cancel: (id: number) => post<Command>(`/api/commands/${id}/cancel`, {}),
  },

  system: {
    /**
     * DELETE /api/system/portfolio — wipes every building/unit/valve/
     * gateway/command back to empty. Admin-only "clear all data" escape
     * hatch. Leaves users and settings untouched.
     */
    resetPortfolio: () => del("/api/system/portfolio"),
  },
};
