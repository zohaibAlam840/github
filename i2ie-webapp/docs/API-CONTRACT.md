# i2i CMS — Frontend ⇄ Backend Contract

> **This document is the contract.** The frontend (Next.js static export in
> `my-app/`) is built against these exact routes, payload shapes, and socket
> events via its mock layer. The Express backend must implement them 1:1 —
> then the swap is: point `lib/api.ts` at real `fetch`, point `lib/socket.ts`
> at `socket.io-client`. No screen changes.

## Deployment shape (LAN)

- One Node process (Express) on the office PC, bound to `0.0.0.0:3000`.
- It serves the frontend's static build (`my-app/out/`) AND this API AND
  Socket.IO on the **same origin** — so the UI uses relative URLs only and
  works from any office PC (`http://<office-pc-ip>:3000`). No internet.
- Frontend build: `cd my-app && npm run build` → serve `out/` with
  `express.static` (routes are folders with `index.html`; `trailingSlash`
  is enabled).

## Conventions

- All bodies are JSON. Authenticated routes expect `Authorization: Bearer <jwt>`.
- Errors: `4xx/5xx` with `{ "error": "CODE", "message": "human text" }`.
  Known codes: `INVALID_CREDENTIALS`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`.
- Roles: `admin` | `operator` | `viewer`. Viewer never mutates; operator may
  send valve commands; only admin manages users/gateways/settings.
- Timestamps: ISO-8601 strings (UTC).
- TypeScript shapes referenced below live in `my-app/lib/types.ts` — that
  file is normative for field names and enums.

## Domain model (gateway-first)

- `Gateway` = one TRB141 (SIM number = the SMS address, 1–2 relay outputs).
- `Valve` = wired to `gateway_id` + `output_index` (1|2).
- `Command` = one queued SMS = one audit row.
  Status: `pending → sent → success | failed | no_response`.
- Valve status: `open | closed | unknown` (last-KNOWN state — never polled).

## REST endpoints

### Auth
| Method | Path | Body → Response | Roles |
|---|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → `{user: User, token: string}` | public |
| GET | `/api/auth/me` | → `{user: User}` | any |

### Dashboard
| Method | Path | Response | Roles |
|---|---|---|---|
| GET | `/api/dashboard/summary` | `DashboardSummary` | any |
| GET | `/api/dashboard/buildings` | `BuildingStats[]` | any |
| GET | `/api/dashboard/activity` | `ActivityEvent[]` (newest first, ≤50) | any |

### Buildings / Units / Valves
| Method | Path | Body → Response | Roles |
|---|---|---|---|
| GET | `/api/buildings` | → `Building[]` | any |
| POST | `/api/buildings` | `{name, address?}` → `Building` | admin |
| PUT | `/api/buildings/:id` | `{name?, address?}` → `Building` | admin |
| DELETE | `/api/buildings/:id` | → `{ok: true}` | admin |
| GET | `/api/buildings/:id/units` | → `Unit[]` | any |
| POST | `/api/buildings/:id/units` | `{name}` → `Unit` | admin |
| PUT | `/api/units/:id` | `{name}` → `Unit` | admin |
| DELETE | `/api/units/:id` | → `{ok: true}` | admin |
| GET | `/api/valves?buildingId=` | → `Valve[]` | any |
| POST | `/api/units/:id/valves` | `{valveCode, gatewayId, outputIndex}` → `Valve` | admin |
| PUT | `/api/valves/:id` | (same fields) → `Valve` | admin |
| DELETE | `/api/valves/:id` | → `{ok: true}` | admin |

### Commands (the queue)
| Method | Path | Body → Response | Roles |
|---|---|---|---|
| POST | `/api/valves/:id/commands` | `{action: "open"\|"close"\|"status"}` → **202** `{command: Command}` | admin, operator |
| GET | `/api/commands?limit=&status=&buildingId=&from=&to=` | → `CommandLog[]` (Command joined with `valveCode`, `unitName`, `buildingName`, `simNumber`; newest first) | any |

**Queue semantics (backend obligations):**
- POST returns **immediately** with the command in `pending` — the outcome
  arrives later via socket events. Never block the HTTP response on the SMS.
- One outbound SMS at a time, paced (config). Finite retries on send
  failure → `failed`. No reply within timeout → `no_response` and the
  valve's `lastStatus` becomes `unknown`.
- A confirmed reply sets valve `lastStatus` + `lastSeenAt` and the command
  to `success`.
- **Unsolicited inbound SMS** (TRB141 I/O-Juggler push, matched by sender
  number → gateway, output token in text → valve) is NOT an error: update
  the valve and emit `valve:update` with `source: "push"`.

### Gateways
| Method | Path | Body → Response | Roles |
|---|---|---|---|
| GET | `/api/gateways` | → `Gateway[]` (no passwords in payload) | any — valve rows display gateway label/output for all roles |
| POST | `/api/gateways` | `{label, simNumber, numOutputs, smsPassword, adminPassword}` → `Gateway` | admin |
| PUT | `/api/gateways/:id` | (same fields) → `Gateway` | admin |
| DELETE | `/api/gateways/:id` | → `{ok: true}` | admin |
| POST | `/api/gateways/:id/ping` | → `PingResult` (uses the TRB141 **built-in** status command + admin password — works before custom rules are provisioned) | admin |

Note: `smsPassword`/`adminPassword` are **write-only** — never returned by
GET (the mock layer omits them entirely).

### Users (admin)
| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/users` | → `User[]` |
| POST | `/api/users` | `{name, username, password, role}` → `User` |
| PUT | `/api/users/:id` | `{name?, role?, password?}` → `User` |
| DELETE | `/api/users/:id` | → `{ok: true}` |

### Settings (admin) — later step
| Method | Path | Response |
|---|---|---|
| GET/PUT | `/api/settings` | keywords, reply mappings, sendRateMs, retries, timeoutMs, comPort |
| GET | `/api/modem/status` | `{ready, mode: "simulated"\|"serial", port}` |

## Socket.IO events (server → client)

Same origin, default path `/socket.io`. Payloads mirror `lib/types.ts`.

| Event | Payload | When |
|---|---|---|
| `command:update` | `{command: Command}` | any lifecycle change (pending/sent/success/failed/no_response) |
| `valve:update` | `{valve: Valve, source: "reply" \| "push" \| "timeout"}` | confirmed reply, unsolicited device push, or timeout→unknown |
| `queue:update` | `{queued: number, processingId: number \| null}` | queue length / in-flight change |
| `modem:status` | `{ready: boolean, mode: "simulated"\|"serial", port: string \| null}` | modem connect/disconnect |
| `activity` | `{event: ActivityEvent}` | every feed-worthy occurrence |

No client → server socket messages in V1 (all mutations via REST).

## Mock parity

`my-app/lib/mock/engine.ts` implements this contract in-browser, including
queue pacing, retries, timeout, reply parsing, and random push events. If
the contract changes, change the engine AND this file in the same commit.
