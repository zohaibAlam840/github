# SIM7600 Support — Build Backlog

Ordered by dependency. Each item says what it is, why the SIM7600 specifically needs it, and what it
unblocks. Built in this order, each step is testable before the next begins.

---

## Phase 1 — Learn about hardware we do not have

*These come first precisely because we have no device. They are how we get real information and how
we test everything after.*

### 1. Diagnostic script

Standalone script. Opens a port, runs the full health command set in sequence, prints a pass/fail
report, and writes **every raw line sent and received** to a file.

- **Why SIM7600:** their device is a real SIM7600G-H with its own firmware revision. The manual tells
  us what it *should* say. This tells us what it *does* say.
- **Unblocks:** the client pre-check session, and gives us genuine response data to build the parser
  against instead of guesses.
- **Note:** deliberately has no dependency on anything below — it is the only thing talking to the
  port, so it needs no mutex, no supervisor, no refactoring. It can ship today.

### 2. AT simulator

A fake modem that replays the documented SIM7600 responses over an injectable stream, including the
failure modes: no SIM, `SIM PIN`, `+CMS ERROR`, `+CSQ: 99,99`, storage full, UCS2 hex bodies, slow
replies, line noise, and URCs arriving mid-command.

- **Why SIM7600:** its responses are now precisely documented, so the simulation can be faithful
  rather than invented.
- **Unblocks:** everything below can be tested without hardware. Requires `SerialModemTransport` to
  accept an injected stream rather than opening the port itself — a small refactor, worth it.

---

## Phase 2 — Make the serial transport correct

*The current transport has never run against hardware and has three defects that would each break it.*

### 3. AT command mutex

Serialise all AT traffic. The multi-step `AT+CMGS` sequence (prompt → body → Ctrl+Z) is held as one
atomic critical section.

- **Why SIM7600:** one serial line, shared by sends, health checks and reads. Today a background poll
  can fire between the `>` prompt and the Ctrl+Z, corrupting both operations.
- **Unblocks:** safe concurrent health checking and receiving.

### 4. URC demultiplexer

Route unsolicited codes (`+CMTI:`, `+CDS:`, `+CREG:`, `RING`) to handlers instead of into the pending
command's response buffer.

- **Why SIM7600:** it pushes `+CMTI` asynchronously, including mid-command. Today that line is
  swallowed into whatever command is waiting and **lost** — a valve reply that silently never arrives.
- **Unblocks:** the entire receive path, delivery reports, live registration updates. Nothing that
  depends on receiving works until this exists.

### 5. Corrected `init()` sequence

```
ATE0 · AT+CMGF=1 · AT+CSCS="IRA" · AT+CSMP=17,167,0,0 · AT+CPMS="ME","ME","ME" · AT+CNMI=2,1
```

Plus a startup check that `AT+CSCA?` is not blank.

- **Why SIM7600:** current code sends only the first two. Without `AT+CSCS`, reply bodies can arrive
  as UCS2 hex and **every confirmation silently fails**. Without `AT+CNMI`, nothing is pushed at all.
  A blank SMS centre makes every send fail quietly.
- **Unblocks:** correct parsing and push-based receive.

### 6. Push-based receive, with delete

`+CMTI: "SM",n` → `AT+CMGR=n` → `AT+CMGD=n`. Keep `AT+CMGL="ALL"` as a startup sweep and safety net.

- **Why SIM7600:** receiving is push-based; the current 15-second poll adds latency and collides with
  sends. `+CMTI` (store-then-read) is chosen over `+CMT` (direct) so a message is not lost if the
  worker restarts mid-delivery.
- **Unblocks:** confirmations arriving promptly and reliably.

### 7. Storage monitor

Track `AT+CPMS?`, alert as capacity approaches.

- **Why SIM7600:** documented capacity is 40–50 messages. Once full, **the network stops delivering**
  and the system looks perfectly healthy while never receiving another reply. Delete-after-read (item
  6) prevents it; this catches it if prevention fails.

### 8. Raw AT traffic log

A rolling, persistent log of every line in and out.

- **Why SIM7600:** we do not own the hardware. When something misbehaves on a laptop in Qatar, this
  is the only forensic trail we will have.

---

## Phase 3 — Know what is plugged in

### 9. Device registry (VID:PID)

Table mapping USB IDs to device name, connection type, required driver and download link.

- **Why SIM7600:** `AT+CUSBPIDSWITCH` changes the PID between modes, so it may enumerate as
  `1E0E:9001` **or** `1E0E:9011`. Both must be recognised as the same device.

### 10. Windows PnP probe

Enumerate USB devices including undriven ones, match against the registry.

- **Why SIM7600:** with no driver installed it creates **no COM port at all** and is completely
  invisible to `SerialPort.list()`. This is the state the client's laptop will be in on day one.
- **Unblocks:** the message *"SIM7600 detected, driver not installed — install X and reboot"* instead
  of a useless "no modem found".

### 11. Qualifying detection

Rank candidate ports (skip NMEA / Diagnostic / Audio by name, prefer known VIDs), then qualify each
with `CPIN?`, `CMGF=1`, `CSCA?`, `CREG?`, `CSQ`, `CGMM`.

- **Why SIM7600:** it exposes **four to five COM ports and only the AT port works** — opening the
  Qualcomm diagnostic port can hang. And today's `AT` → `OK` test would happily accept a modem with
  no SIM card, then fail every send afterwards.

### 12. IMEI identity and verified store

Key everything on `AT+CGSN`, persisted to disk.

- **Why SIM7600:** COM port numbers change between reboots and USB sockets; the IMEI does not. Lets a
  proven modem be re-adopted after a restart **without re-running the SMS verification**.

---

## Phase 4 — Keep it alive

### 13. Modem state machine

Seven states — `ABSENT`, `UNDRIVEN`, `PORT_ONLY`, `IDENTIFIED`, `NOT_READY`, `READY`, `VERIFIED`
(plus `DEGRADED`) — each carrying a reason string and timestamp.

- **Why SIM7600:** it fails in many distinct ways (no SIM, PIN locked, no antenna, not registered, no
  SMS centre) and each needs a different action from whoever is standing next to it.

### 14. Tiered health checker

Tier 0 free port enumeration every tick · Tier 1 `AT` liveness, **skipped if any AT succeeded in the
last 15s** · Tier 2 signal/registration each minute · Tier 3 SIM/SMSC/storage every five minutes.

- **Why SIM7600:** one serial line shared with real SMS traffic. Checking must never compete with
  sending — and a successful send is better evidence of health than any probe.

### 15. Failure ladder with recovery

Port vanished → immediate demotion. Otherwise: 3 strikes → close/reopen the port → `AT+CRESET` →
demote with cooldown.

- **Why SIM7600:** USB serial devices wedge, and reopening the port often clears it. `AT+CRESET` is a
  documented module reset — worth one attempt before giving up on working hardware.

### 16. Supervisor

Owns the active transport. Planned switch waits for an idle queue; hard failure fails in-flight
commands with a real reason, then switches immediately.

- **Why SIM7600:** it is the primary sender with the phone as fallback, and the handover must not
  orphan a command that is waiting for its reply.

---

## Phase 5 — Show it and prove it

### 17. Cached health snapshot and endpoints

`GET /health` returns a stored snapshot and performs **no I/O**. Plus `/ports`, `/hardware`,
`/rescan`, `/test-sms`.

- **Why SIM7600:** the dashboard polls every 10 seconds from every open tab. Probing the modem on
  each request would flood the one serial line with self-inflicted traffic.

### 18. Dashboard "SMS device" card

State and reason, model, COM port, SIM, signal, SMSC, storage used, attached-hardware list with
driver links, plus Rescan and Test buttons.

### 19. First-connect verification against a TRB141

A real `iostatus` round trip before the modem is promoted to primary sender.

- **Why SIM7600:** everything above proves the modem is *configured* correctly. Only this proves it
  can actually reach the field.

---

## Order rationale

Items **1 and 2** come first because we have no hardware — they are how we learn and how we test.
Items **3, 4 and 5** are prerequisites for everything else; nothing that receives a message works
until the URC demultiplexer exists. Phases 3 and 4 are independently useful and can be demonstrated
without a modem using the simulator. Item **19** is last because it is the only one that genuinely
requires real hardware at both ends.
