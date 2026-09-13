# i2i Smart Valve Control System — Complete Build Brief

> **This document is the single source of truth for building this system.**
> If you are an AI coding assistant (e.g. Claude Code) with no prior context: **read this entire file before writing any code.** Every decision, constraint, and reason is here on purpose. When something in the code conflicts with this document, this document wins unless the human tells you otherwise.

---

## 0. How to use this document

- Read top to bottom once. Do not skip the "Physical reality" and "SMS queue engine" sections — they are the parts that make or break this project.
- Build in the **order given in section 7 (Roadmap)**. Do not jump ahead to the hardware/modem code. The whole system is built and tested with a **fake ("pretend") modem** first, and the real modem is swapped in at the very end.
- A **Step 1 foundation already exists in this repository** (see section 6). Continue from it; do not start over.
- Keep everything **simple and reliable**. This ships to a non-technical client who must be able to run it easily. Favor boring, proven solutions over clever ones.
- Write plain-language comments. A junior developer (and the client's future maintainer) should be able to follow the code.

---

## 1. What this system is (plain-language overview)

The client (**i2i**, a smart-building company in Qatar) installs **smart water/gas valves** inside apartments and shops across many buildings. Each valve can be opened or closed remotely. They need a piece of software that lets an operator, sitting in a control office, **open, close, and check the status of any valve** from a simple dashboard.

The catch: **there is no internet at the valves.** Everything works over the **mobile phone network using SMS text messages**. Each valve has a small industrial gateway with its own SIM card (its own phone number). To command a valve, the software sends it an SMS; the gateway switches the valve and sends an SMS back confirming the new state.

So this system is, in one sentence:

> **A local web dashboard that controls physical valves by sending and receiving SMS text messages through a modem attached to an office PC — with no internet required.**

**Who uses it:**
- **Admin** — sets up buildings, units, valves, and users; full control.
- **Operator** — opens/closes/checks valves day to day.
- **Viewer** — can see status but cannot send commands.

**Scale:** up to **500 valves per building**, and an **unlimited number of buildings** (target minimum: 100 buildings × 500 = 50,000 valves stored/managed). See section 3 for the important throughput reality that shapes the design.

---

## 2. The physical reality (hardware) — you must understand this

There are two pieces of hardware. Understanding them is essential, because it dictates the entire architecture.

### 2.1 The office modem (one, at the control office)
- **Device:** Robustel M1000 MP industrial cellular modem.
- **Connection:** plugged into the **office PC** by USB (it appears as a serial **COM port**).
- **SIM:** it holds one normal SIM card ("SIM A", e.g. Ooredoo/Vodafone Qatar).
- **Job:** this is the software's "radio." The software talks to it with **AT commands** over the serial port to **send SMS** and **read incoming SMS**. It is the bridge between the software and every valve in the field.

### 2.2 The field gateways (one per valve, out in the buildings)
- **Device:** Teltonika **TRB141** LTE gateway. One is installed at each valve.
- **SIM:** each TRB141 has **its own SIM card** ("SIM B") — its own unique phone number, addressable like any mobile phone.
- **Relay:** the TRB141 has a built-in **relay** (an electrical switch). The relay is wired to the valve. When the relay closes/opens, the valve opens/closes. (The relay is a **dry contact** — it switches the valve's own power, it does not power the valve.)
- **Job:** it receives an SMS command, switches its relay, and replies by SMS with the new state.

### 2.3 The round trip (memorize this)

```
Operator clicks "Open valve"  (browser)
        │  HTTP
        ▼
   Backend server  (Node, on the office PC)
        │  queues the command, then sends it
        ▼
   Robustel modem  (COM port)  ──SMS──►  GSM network  ──SMS──►  TRB141 (SIM B)
                                                                    │ switches relay
                                                                    ▼
                                                                  VALVE opens
   Dashboard updates  ◄── WebSocket ── Backend parses reply ◄──SMS── TRB141 replies "VALVE ON"
```

### 2.4 The single most important architectural consequence

**The browser cannot talk to the modem.** Browsers are blocked from using serial/COM ports for security. Therefore:

- There is a **backend program** (a long-running Node.js process) that runs **on the office PC** — the same PC the modem is plugged into. This backend **owns the modem and the message queue**.
- The **browser (frontend) only ever talks to the backend** over HTTP and WebSocket. It never touches the modem, the serial port, or the database directly.

This split is non-negotiable and shapes everything below.

---

## 3. How SMS control actually works (and the throughput reality)

### 3.1 The command/reply format (TRB141 side)

Each TRB141 is configured (on the device itself, via its web UI) with **SMS rules**. A rule says: *"when an SMS arrives containing this password and this keyword, do this action and reply with this text."* The software must send messages that match those rules.

The agreed format is: **`<sms_password> <keyword>`** — the password, a space, then the keyword.

| Intent | SMS the software SENDS | What the TRB141 does | Reply the software RECEIVES |
|---|---|---|---|
| Open valve | `<password> valveon` | closes relay → valve opens | `VALVE ON` |
| Close valve | `<password> valveoff` | opens relay → valve closes | `VALVE OFF` |
| Check status | `<password> iostatus` | (built-in rule) reads I/O | a status string containing the state |

**Important for the code:** the exact keywords and reply texts are **configured on the physical device** and could be tuned. So the software must keep the keywords and the reply-to-status mapping in a **single config/constants file** (not hard-coded all over). The software maps a reply string to one of three statuses: `open`, `closed`, or `unknown`.

- `password` is stored per valve (`valves.sms_password`).
- The message is addressed to the valve's phone number (`valves.sim_number`).

### 3.2 The office modem side (real, later)

The backend uses **node-serialport** to open the modem's COM port and drive it with AT commands (e.g. text-mode SMS: `AT+CMGF=1`, `AT+CMGS="<number>"`, then the message body). Incoming SMS are read/notified and parsed. **You do NOT build this until the very end (section 7, Step 8).** Until then you use the pretend modem (section 8).

### 3.3 The throughput reality — this shapes the whole design

There is **one modem**. A single modem is a single SIM with a single radio, so it sends SMS **one at a time**, roughly **one every few seconds (about 5–10 per minute)**. This has three consequences you must design around:

1. **Never send in parallel.** All outgoing SMS go through **one controlled queue**, sent one after another at a safe pace. (Sending many at once jams or hangs the modem.)
2. **Never poll all valves.** Do **not** build a loop that texts all 500 (or 50,000) valves to refresh their status — it would take hours and cost a fortune in SMS. Instead:
   - **Store the last known state** of each valve (`valves.last_status`, `valves.last_seen_at`).
   - The dashboard shows that stored state, with a "last confirmed" time.
   - A status SMS is only sent when a human **explicitly refreshes one valve** (or acts on it).
3. **Accept many commands, process them in order.** The system must **accept 30+ commands at once** (operators clicking quickly) and queue them, tracking each to its reply, without blocking the UI. A burst of ~30 clears in a few minutes on one modem.

**Future (not V1):** the design must allow **adding more modems** later as a "pool" to raise throughput. Build the modem access behind an interface (section 4.3) so a pool can be added without rewriting the queue. V1 ships with **one** modem.

---

## 4. Architecture

### 4.1 Two parts

- **Backend** — a long-running Node.js process on the office PC. Owns: the database, the modem, the SMS queue engine, the HTTP API, and the WebSocket server. This is the brain.
- **Frontend** — a web dashboard (React) served to any browser on the office network. Talks to the backend only.

Both run on the **same office PC**. Other staff open the dashboard from their own browsers over the **local network** (`http://<office-pc-ip>:<port>`). No internet, no cloud.

### 4.2 The four logical layers

1. **Presentation** — React dashboard (roles, EN/AR, live status).
2. **Application** — the SMS queue engine, command generation, reply parsing, retry/timeout, business logic.
3. **Transport** — the modem interface (pretend now, Robustel via node-serialport later).
4. **Data** — SQLite database (devices, users, commands/logs).

### 4.3 The modem interface (the key abstraction)

**All modem access goes through one interface**, so the "pretend" modem (for building now) and the "real" modem (later) are interchangeable. Define it once:

```js
// A Modem can send an SMS and notifies when one arrives.
class Modem {
  async open() {}                         // connect / open the port
  async close() {}                        // disconnect
  isReady() { return true; }              // is it connected & usable
  async send(toNumber, text) {}           // send one SMS; resolve on success, throw on failure
  // Emits an event when an SMS arrives:
  //   modem.on('sms', ({ from, text, receivedAt }) => { ... })
}
```

- **PretendModem** (build now) — implements this by faking replies (section 8).
- **SerialModem** (build last) — implements this with node-serialport + AT commands.

The **queue engine depends only on this interface**, never on a concrete modem. Swapping pretend → real changes one line (which class you instantiate).

### 4.4 Deployment model (how it runs, and why it must be easy)

- The whole thing runs as **one Node process on the office PC**, serving the built React app as static files plus the API and WebSocket.
- The **database is a single SQLite file** (see section 5) — no database server to install or maintain.
- On delivery it should run as a **Windows service that auto-starts on boot** (e.g. via NSSM) and **auto-reconnects to the modem** on a consistent COM port, so a power cut or restart brings it back with no manual steps (checklist item 17).
- Staff just open the browser. **Ease of running for the client is a top priority** — every tech choice below favors "install Node, double-click, done."

---

## 5. Technology stack (decided — do not deviate without asking the human)

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node.js (LTS, ≥ 22.5)** | one language, owns the serial port and the web server |
| Web framework | **Express** | simple, stable, well-known |
| Database | **SQLite via Node's built-in `node:sqlite`** | **no database server and no native build** — the client installs only Node. Single-file DB. This is the biggest "easy to run" win. |
| Frontend | **React + Vite** | standard; `vite build` outputs static files the backend serves in production (single process, easy to run) |
| Live updates | **Socket.IO** | push valve-status changes to the browser instantly, no refresh/polling |
| Auth | **JWT + bcrypt** | secure login and Admin/Operator/Viewer roles |
| Bilingual | **i18next / react-i18next** | English + Arabic, including right-to-left layout |
| Real modem (last) | **node-serialport** | industry standard for COM-port + AT commands |

**Important stack notes:**
- **Do NOT use MySQL.** The old proposal mentioned it, but we chose SQLite specifically so the client has no database server to run. SQLite still meets every requirement (local, offline, ≥1 year of logs, CSV export).
- **Do NOT use `better-sqlite3` or other native SQLite modules.** They need a compiler/prebuilt binary and complicate delivery. Node's built-in `node:sqlite` needs nothing. (Start scripts pass `--disable-warning=ExperimentalWarning` to silence its experimental notice.)
- Keep dependencies minimal. Every extra dependency is a delivery risk.

---

## 6. What already exists (Step 1 — the foundation, DONE)

This repository already contains a working Step 1. **Build on it; do not recreate it.**

```
i2i-valve-system/
  package.json          scripts: start / dev (node --disable-warning=ExperimentalWarning src/server.js)
  setup.bat / start.bat one-click install & run for Windows
  data/                 the SQLite file (valve-system.db) is auto-created here
  src/
    server.js           Express app: serves /public, JSON API, /api/health, mounts routes
    db.js               opens node:sqlite, creates ALL tables on first run (schema below)
    routes/
      buildings.js      GET / POST / DELETE buildings (the first working feature)
  public/               a plain HTML/JS page (buildings add/list/delete) — placeholder UI
```

Step 1 proves the chain works: browser → API → SQLite → back. It uses a plain HTML page as a placeholder; **from Step 3 onward the real UI becomes a React app** (the plain page can be retired once React is in).

### 6.1 The database schema (already created by `src/db.js`) — exact definition

All five tables exist from Step 1. This is the data model for the whole system.

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,               -- bcrypt hash, never plaintext
  role          TEXT    NOT NULL DEFAULT 'operator',   -- admin | operator | viewer
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE buildings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  address    TEXT    DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE units (            -- an apartment / shop / room inside a building
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL,
  name        TEXT    NOT NULL,               -- e.g. "Apartment 402"
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE
);

CREATE TABLE valves (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id      INTEGER NOT NULL,
  valve_code   TEXT    NOT NULL,              -- e.g. "SN0001" (human label)
  sim_number   TEXT    NOT NULL,              -- the TRB141's phone number (the address)
  sms_password TEXT    NOT NULL,              -- the password set in that TRB141's SMS rule
  last_status  TEXT    NOT NULL DEFAULT 'unknown',  -- open | closed | unknown
  last_seen_at TEXT,                          -- when we last got a confirmed reply
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
);

CREATE TABLE commands (         -- every command = one SMS = one log/audit row
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  valve_id     INTEGER NOT NULL,
  user_id      INTEGER,                       -- who triggered it
  action       TEXT    NOT NULL,              -- open | close | status
  command_text TEXT,                          -- the actual SMS text sent
  status       TEXT    NOT NULL DEFAULT 'pending',  -- pending|sent|success|failed|no_response
  sent_at      TEXT,
  reply_text   TEXT,                          -- the raw SMS reply received
  reply_at     TEXT,
  retries      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (valve_id) REFERENCES valves(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)
);
```

**The `commands` table is both the command queue history AND the audit log.** Joining `commands → valves → units → buildings → users` yields every field the client requires in logs (item 10): date/time, building, unit, valve ID, SIM number, sent command, received response, user action, final status. Do not invent a separate log table; extend `commands` if needed.

Add helpful indexes as data grows: `commands(valve_id)`, `commands(status)`, `commands(created_at)`, `valves(sim_number)`, `units(building_id)`, `valves(unit_id)`.

---

## 7. Build roadmap (do these in order)

Each step is shippable and testable on its own. **Steps 1–7 need no hardware.** Only Step 8 needs the real modem.

### Step 1 — Foundation ✅ DONE
Running backend + SQLite + all tables + buildings CRUD + placeholder page. (Section 6.)

### Step 2 — Authentication & roles  *(no hardware)*
- **Goal:** secure the system before it holds real data.
- Build: user registration/seed (create a first **admin** on first run), login endpoint (bcrypt verify → JWT), auth middleware, role checks (`admin` / `operator` / `viewer`).
- Rules: **Viewer** cannot send commands. **Operator** can operate valves but not manage users. **Admin** can do everything including user management.
- Every meaningful action must be attributable to a user (for the audit log).
- **Acceptance:** can log in, get a token, hit protected routes; wrong role is rejected; passwords are only stored as bcrypt hashes.

### Step 3 — Buildings / Units / Valves management  *(no hardware)*
- **Goal:** admins onboard the physical layout with no developer help (item 8).
- Build full CRUD for **units** (under a building) and **valves** (under a unit). Extend the existing buildings CRUD.
- A valve form captures: `valve_code`, `sim_number`, `sms_password`, and its unit.
- Validate input (required fields, phone-number format, unique `sim_number`).
- **Introduce the React (Vite) frontend here** and start building the real UI: a tree/list of Buildings → Units → Valves. Retire the placeholder HTML page.
- **Acceptance:** an admin can create a building, add units, add valves, edit and delete them, entirely through the UI.

### Step 4 — The modem interface + Pretend modem + **SMS queue engine**  *(no hardware — THE CORE)*
- **Goal:** the heart of the system, fully built and tested without any hardware. **Spend the most care here.**
- Build the `Modem` interface (section 4.3) and the **PretendModem** (section 8).
- Build the **SMS queue engine** (section 8): accept commands, send one at a time at a safe rate, track each through its lifecycle (`pending → sent → success/failed/no_response`), retry a finite number of times, time out non-responders, and match incoming replies to the right pending command by sender number.
- Persist every command to the `commands` table; update `valves.last_status` / `last_seen_at` on confirmed replies.
- **Acceptance (test hard against the pretend modem):** fire 30 commands at once → all are queued and processed in order; failures are marked `failed` after N retries; a valve that never replies is marked `no_response` and its valve status becomes `unknown`; replies flip `last_status` correctly; nothing blocks the UI.

### Step 5 — Command flow + Dashboard + live status  *(no hardware)*
- **Goal:** the operator experience.
- Build the dashboard: buildings/units/valves with **status indicators** (open / closed / unknown / pending) and **Open / Close / Refresh** buttons per valve (respecting roles).
- Wire **Socket.IO** so status changes push to all open browsers instantly (item shows Pending → Sent → Success/Failed/No response lifecycle, item 13).
- Show **"last confirmed"** time per valve. **No auto-polling** (section 3.3).
- **Acceptance:** clicking Open queues a command, the valve shows Pending, then updates to Open when the pretend reply arrives — live, no refresh, across two browser windows at once.

### Step 6 — Logs, export, timeouts, notifications  *(no hardware)*
- Logs screen: searchable/filterable table from `commands` joined to valve/unit/building/user (item 10).
- **CSV/Excel export** (item 11) and **archive-and-clear** of old logs after export (item 12). Retain ≥ 1 year (item 9).
- Timeout/no-response detection and flags (item 15).
- Email / in-app **alerts** for fault states and non-responsive devices (item, notifications).
- **Acceptance:** logs show full history with all fields; export produces a valid CSV; old logs can be archived and cleared.

### Step 7 — Bilingual EN / AR  *(no hardware)*
- Wire i18next; translate the UI; support **right-to-left** layout for Arabic (item 21).
- **Acceptance:** switching to Arabic flips the layout and translates all labels.

### Step 8 — Real modem driver (Robustel M1000 MP)  *(needs hardware)*
- Implement **SerialModem** against the same `Modem` interface using **node-serialport** + AT commands (text-mode SMS send + incoming-SMS read/parse).
- Add a **COM-port detect / select** screen and validate the channel before operations (item, modem auto-detect).
- Swap PretendModem → SerialModem (one line). Everything else is unchanged.
- Measure real round-trip time; tune the queue's send rate.
- **Acceptance:** one real command opens a real valve (or fires the relay/LED on a bench TRB141) and the reply updates the dashboard.

### Step 9 — Packaging for delivery  *(easy-to-run)*
- `vite build` the frontend; backend serves the static build.
- Provide a Windows install: run as an **auto-starting service** (NSSM), auto-reconnect to the modem, consistent COM port. Optionally bundle Node so the client installs nothing.
- Ship: installer/instructions, admin credentials, DB location, backup guidance, admin training (items 25, 26).
- **Acceptance:** on a clean Windows PC, the client can install, reboot, and the dashboard is reachable on the LAN with the service already running.

---

## 8. The SMS Queue Engine (detailed design — the hard part)

This is where projects like this succeed or fail. Build it carefully and test it exhaustively against the pretend modem.

### 8.1 What it must guarantee
- **One outgoing SMS at a time**, paced (e.g. a small gap between sends; make the rate a config value, default ~one every 3–5 seconds).
- **Accept many commands at once** (30+); they wait their turn in the queue. The API returns immediately with a "queued" response; the browser learns the outcome later via WebSocket.
- **Full lifecycle per command:** `pending` → `sent` (handed to modem) → `success` (matching reply parsed) OR `failed` (send error after retries) OR `no_response` (no reply within timeout).
- **Finite retries** (e.g. default 2), with a configurable interval, to avoid endless loops and SMS cost (item 14).
- **Timeout** per command (e.g. default 60s): if no reply, mark `no_response` and set the valve's status to `unknown` (item 15).
- **Reply matching:** an incoming SMS's **sender number** (`from`) identifies the valve (`valves.sim_number`); match it to the oldest pending command for that valve, parse the reply → status, mark `success`, update `valves.last_status` + `last_seen_at`, and emit a WebSocket event.
- **Survive restart:** on startup, any commands left `pending`/`sent` should be re-queued or marked appropriately (item 17: persist the queue).

### 8.2 The pretend modem (build this to develop with no hardware)

`PretendModem implements Modem`:
- `send(toNumber, text)`: waits a configurable delay (simulating network time), then **emits an `sms` event** as if the TRB141 replied — parse the outgoing `text` for the keyword (`valveon`/`valveoff`/`iostatus`) and emit a matching reply (`VALVE ON` / `VALVE OFF` / a status string) with `from = toNumber`.
- Make it **misbehave on purpose** (config flags/probabilities): sometimes throw on `send` (to test `failed`), sometimes **never reply** (to test `no_response`), sometimes reply slowly. This is how you prove the engine is robust before real hardware.

### 8.3 Config that must be centralized (constants file)
- SMS keywords: `valveon`, `valveoff`, `iostatus` (tunable to match the device).
- Reply→status mapping (e.g. contains "ON" → `open`, contains "OFF" → `closed`, else `unknown`).
- Send rate, retry count, retry interval, per-command timeout.
- These live in **one config file** because they must match how the physical TRB141s are configured, and the human may change them.

### 8.4 Multi-modem future hook (design, don't build)
- The queue talks to a **modem provider**, not a single modem object. For V1 the provider returns the one modem. Later a **pool** can hand out whichever modem is free, giving parallel lanes — without changing the queue's logic. Keep this seam clean; do not hard-wire a single global modem everywhere.

---

## 9. Scope — the agreed requirements (V1)

This is the contract. Build exactly this. Anything not listed is **out of V1 scope** unless the human approves it (items 33, 36).

**Core / offline:** fully offline, no internet (1, 23); valve control via SMS only (2); local GSM SIMs, carrier-agnostic (3); send + receive SMS (4); Open/Close/Status commands, matching the real TRB141 format (5).
**Scale:** store/manage ≥100 buildings × 500 units, on-demand per-valve commanding (6); architecture allows adding modems/channels later (7, 37, 38); state the max buildings = unlimited by design (39). **Fleet-wide auto-polling and carrier bulk-SMS are NOT in V1** (item 6 note).
**Setup:** admin adds/edits/deletes buildings, units, valves, SIM numbers with no developer (8).
**Logs:** ≥1 year retention (9); log fields = date/time, building, unit, valve ID, SIM, sent command, received response, user action, final status (10); export CSV/Excel (11); archive-and-clear after export (12).
**Reliability:** show status Pending/Sent/Success/Failed/No-Response (13); finite configurable auto-retry (14); auto timeout/no-response detection (15); controlled outbound queue, no modem overload (16); survive PC restart/power loss with auto-start + auto-reconnect + persisted queue (17); concurrent handling of ~30 commands (37).
**Security & UX:** login + role-based access Admin/Operator/Viewer (18); log all user actions (19); dashboard shows online/offline (= last-known SMS status, not live network), open/closed, recent activity, last communication (20); EN/AR bilingual with RTL (21).
**Deployment:** installed locally on i2i hardware (22); no cloud/hosting needed (23); pilot/UAT before full rollout (24); admin training (25); delivery package incl. installer, docs, DB structure, admin credentials, deployment guidance (26).
**Ownership:** deliver full source on final payment (29); i2i may modify/extend after handover (30); IP belongs to i2i (31); software keeps working with no kill-switch/expiry (32).
**Housekeeping:** machine-locked licensing against outside parties, perpetual for i2i (28); V1 stays simple and stable (34); future features are separate change requests (35, 36).

---

## 10. Coding conventions & principles

- **Simplicity over cleverness.** This must be maintainable by others and easy to run.
- **Plain-language comments** explaining the "why," not just the "what."
- **Security:** always hash passwords with bcrypt; never store plaintext; use JWT for sessions; **use parameterized SQL** (prepared statements) everywhere — never string-concatenate SQL; validate and sanitize all input.
- **Separation:** browser ⇢ backend only. Backend owns DB, modem, queue. Keep the modem behind the `Modem` interface.
- **Errors are expected** (SMS fails, no reply). Handle them as normal flow, not crashes. The app must never hang because a message didn't arrive.
- **Config in one place** (section 8.3), not scattered magic values.
- **Test the queue engine hard** against the pretend modem before writing any serial code.
- **Backend binds to `0.0.0.0`** (so LAN browsers can reach it), listens on a configurable port (default 3000).
- Keep the delivered footprint tiny: minimal dependencies, no native modules, SQLite file DB.

---

## 11. How to run

**Development (your machine, no hardware):**
```bash
npm install        # first time
npm run dev        # backend with auto-reload; uses the pretend modem
# open http://localhost:3000
```
Frontend (once React/Vite is added in Step 3): run the Vite dev server for the UI and proxy API/WebSocket to the backend; for production, `vite build` and let the backend serve the static output.

**Delivery (client office PC):** install Node (LTS), run the backend as an auto-starting Windows service, plug in the Robustel modem on a fixed COM port, staff open `http://<office-pc-ip>:3000`. No database server, no internet.

---

## 12. Critical do's and don'ts (read again before coding)

**DO**
- Build and test the whole system against the **pretend modem** first.
- Build the queue to send **one SMS at a time**, accept **many at once**, retry finitely, and time out.
- **Store last-known valve state**; show it instantly; only send status SMS on explicit refresh.
- Keep the browser away from the modem — backend owns it.
- Keep it easy to run: **Node's built-in SQLite, no native modules, single process.**

**DON'T**
- Don't use MySQL or `better-sqlite3` (delivery-hard). Use `node:sqlite`.
- Don't poll all valves on a timer. It doesn't scale on one modem.
- Don't send SMS in parallel or straight from an API handler — always through the queue.
- Don't write the real serial/modem code until Step 8. The pretend modem comes first.
- Don't add features beyond section 9 without the human's approval.

---

*End of build brief. Build in order, test against the pretend modem, keep it simple, keep it easy to run.*
