# SIM7600 Support — Change Inventory

Exactly what changes in the existing system. Current worker is 1,429 lines across 13 files; the
dashboard touch points are another ~1,500.

**Nothing in the phone-gateway path is removed.** It stays fully working as the fallback, and as the
thing that keeps the system deliverable if the modem misbehaves.

---

## A. Rewritten

### `sms-worker/src/transports/serialModem.ts` — 215 lines, substantially rewritten

The largest single change. It has never run against hardware and has three structural defects.

| What | Change |
|---|---|
| `constructor` | Stop opening the port itself. Accept an **injected stream** so the simulator can drive it |
| `init()` | Currently 2 commands (`ATE0`, `AT+CMGF=1`). Becomes 6, plus an `AT+CSCA?` validation |
| `onLine()` | **Add URC demultiplexing.** Today every line goes to `responseBuffer`; `+CMTI` is swallowed and lost |
| `sendAtCommand()` | Route through the new **mutex** |
| `writeAndWaitForPrompt()` + `send()` | Hold the whole `CMGS` sequence as **one atomic critical section** |
| `pollMessages()` | Demoted from primary path to startup sweep / safety net |
| *new* `onCmti()` | `+CMTI` → `AT+CMGR=n` → `AT+CMGD=n` — the real receive path |
| *new* `checkStatus()` | Implement via `+CDS` delivery reports, matched on `+CMGS: <mr>` — recovers the progress detail the phone path has |
| *new* health methods | `probeLiveness()`, `readSignal()`, `readStorage()` for the health checker |
| `seenIndices` | Delete — replaced by delete-after-read |

### `sms-worker/src/transports/detect.ts` — 85 lines, rewritten

From "first port that answers `AT` wins" to rank-then-qualify. Returns a rich `ModemProbe` (comPort,
verdict, reason, imei, model, simState, registration, signal, smsc) instead of `boolean`.

### `sms-worker/src/transports/factory.ts` — 75 lines, mostly replaced

Currently returns a one-shot `TransportSelection` snapshot at boot. Becomes a thin constructor used
*by* the supervisor, which owns the live transport instead.

---

## B. Modified

### `sms-worker/src/controlServer.ts` — 262 lines

- `GET /health` — extended payload; **critically, it must now read a cached snapshot and perform no
  I/O.** Existing fields keep their shape so today's Topbar keeps working unchanged
- `startControlServer(...)` signature — takes the supervisor instead of a frozen `TransportSelection`
- Every handler that uses `transport` — reads `supervisor.current()` instead of a captured reference
- **New:** `GET /ports`, `GET /hardware`, `POST /rescan`, `POST /test-sms`

### `sms-worker/src/index.ts` — 46 lines

Startup changes from "pick a transport once" to "start the supervisor". Transport logging moves to
supervisor transition events.

### `sms-worker/src/config.ts` — 50 lines

New: `TEST_GATEWAY_SIM`, `TEST_GATEWAY_PASSWORD`, scan/tick interval, AT log path, `SMSC` override.

### `sms-worker/src/confirmationTracker.ts` — 212 lines

- **New:** `hasActiveDispatch()` — so the supervisor knows whether a switch is safe
- **New:** `failActive(reason)` — on hard modem failure, fail in-flight commands with a real reason
  rather than leaving them "pending" until the 8-minute ceiling
- `confirmInBackground()` — use the transport's new `checkStatus()` when present

### `sms-worker/src/commands.ts` — 124 lines

- **New:** E.164 normalisation on the **outgoing** path. `AT+CMGS="..."` is strict about format;
  `numbersMatch()` already handles incoming loosely, but nothing normalises outgoing
- `parseRelayState()` — add a guard for UCS2-hex bodies, so a character-set problem is reported rather
  than silently returning `"unknown"` for everything

### `sms-worker/.env`

`SMS_TRANSPORT=phone_gateway` → **`auto`**. Without this one line, none of the modem code ever runs.
Plus the new `TEST_GATEWAY_SIM` entries.

### `sms-worker/package.json`

Two script entries: `diagnose`, `simulate`.

---

## C. New files

| File | Purpose |
|---|---|
| `src/at/mutex.ts` | Serialise all AT traffic |
| `src/at/urc.ts` | URC prefix routing |
| `src/at/log.ts` | Rolling raw traffic log |
| `src/hardware/deviceRegistry.ts` | VID:PID → device, driver, link (incl. `9001` **and** `9011`) |
| `src/hardware/windowsPnp.ts` | `Get-PnpDevice` — sees undriven devices |
| `src/transports/supervisor.ts` | Owns the transport; tick loop; failover |
| `src/transports/health.ts` | Tiered checker + state machine |
| `src/transports/verify.ts` | TRB141 first-connect round trip |
| `src/verifiedModems.ts` | IMEI store (same file-backed pattern as `inbox.ts`) |
| `src/diagnose.ts` | **Standalone pre-check script** |
| `src/simulator/fakeModem.ts` | AT simulator |
| `data/verified-modems.json` | Created at runtime |
| `data/at-log.txt` | Created at runtime |

---

## D. Dashboard changes

### `lib/workerStatus.ts` — 145 lines

Extend `WorkerHealth` with the modem block (state, reason, model, imei, signal, registration, sim,
smsc, storage, verifiedAt, checkedAt). New helpers `fetchPorts()`, `fetchHardware()`,
`triggerRescan()`, `runTestSms()` — mirroring the existing `fetchWorkerHealth` shape.

### `app/(app)/settings/page.tsx` — 305 lines

New **"SMS device"** card: state and reason, modem details, signal, storage, attached-hardware list
with driver links, Rescan and Test buttons.

### `components/shell/Topbar.tsx` — 139 lines

**Minimal change.** It already renders `router` / `mobile` / `offline` / `demo` from `/health` and
polls every 10s. Worth adding a staleness indicator using the new `checkedAt`.

### `lib/types.ts`, `locales/en.json`, `locales/ar.json`

New shared types; new strings in both languages (Arabic must keep parity).

---

## E. Deleted

| File | Why |
|---|---|
| `sms-worker/src/queue.ts` (26 lines) | Dead Supabase stub. The Next.js app has owned the queue since the pivot — it throws on call and `index.ts` catches it. Removing it also removes the misleading "queue loop not implemented" startup message |

`src/testCommand.ts` (82 lines) stays — still useful for manual bench work.

---

## F. Not changed

Worth stating explicitly:

- `src/transports/httpPhoneGateway.ts` — untouched. The phone path keeps working exactly as it does
- `src/inbox.ts` — untouched; records sent/received regardless of transport
- `src/transports/types.ts` — the `SmsTransport` interface already fits. `checkStatus?` is already
  optional and the serial transport simply starts implementing it
- The entire Next.js command queue, database, SSE layer and all dashboard screens other than Settings
- `sms-worker/README.md` still describes Supabase and should be corrected, but that is documentation
  debt, not part of this work

---

## Summary

| | Count |
|---|---|
| Rewritten | 3 files |
| Modified | 8 files (7 worker + `.env`) |
| New | 13 files |
| Dashboard | 5 files |
| Deleted | 1 file |

The riskiest change by far is `serialModem.ts`, because it is the one file that is both heavily
rewritten and impossible for us to test against real hardware — which is exactly why the simulator
and the diagnostic script come first in the build order.
