# i2i SMS Worker

The one piece of the i2i CMS that has to run physically in the office, on
the same LAN as the phone/modem sending SMS to the TRB141 gateways —
Supabase's cloud can't reach that phone's local IP, so this bridges the two.

## What it does today

- Sends SMS via the phone gateway app ("SMS Gateway for Android" by
  capcom6, Local Server mode) — verified working end-to-end on the bench,
  including real delivery-status tracking (Pending → Processed → Sent →
  Delivered).
- Implements the two-message confirmation pattern the TRB141 actually
  needs: the `valveon`/`valveoff` action rule sends no reply, so a
  follow-up `iostatus` command is sent and *its* reply (parsed from the
  `%rb` relay placeholder) is the real confirmation. A plain status query
  (the dashboard's "Refresh" button) is the exception — it already IS the
  confirmation, so `confirmationTracker.ts`'s `dispatchAndTrack()` sends
  it once, not the actuation pattern's two messages (that was a real bug:
  Refresh used to send `iostatus` twice back-to-back for no reason).
- Runs a small webhook listener so incoming replies can be captured
  automatically instead of a human reading the phone screen.
- Supports optional per-gateway password prefixing, for TRBs whose SMS
  rules use "By router admin password" instead of "No authorization"
  (format not yet bench-verified — see `src/commands.ts`).
- `src/transports/serialModem.ts` — AT-command control (Hayes text-mode SMS:
  `AT+CMGF=1`/`AT+CMGS`/`AT+CMGL`) for the SIM7600G or Robustel M1000 MP,
  using `serialport`. Written against the documented command set but **not
  yet run against real hardware** — treat it the same way the phone-gateway
  path was treated before it was bench-verified: plug in the device, watch
  the worker's console output, and confirm the prompt-handling / CMGL
  parsing actually matches what that specific modem sends before trusting
  it in production.
- **Auto transport selection** (`src/transports/factory.ts`,
  `src/transports/detect.ts`) — on startup the worker probes every serial
  port on the machine with a plain `AT` command. If a router/modem answers,
  that's used ("router" mode); if none does, it falls back to the mobile
  phone gateway ("mobile" mode) automatically. Nothing is ever a
  "simulated" transport — it's always one of these two real paths, chosen
  based on what's actually plugged in. Override with `SMS_TRANSPORT=serial_modem`
  or `SMS_TRANSPORT=phone_gateway` in `.env` to force one path (with
  `COM_PORT` set for the serial case), or leave `SMS_TRANSPORT` unset/`auto`
  for the automatic behavior. `GET /health` on the control server reports
  which one is currently active (`{ transport: "router"|"mobile", detail,
  comPort }`) — this is what the dashboard's Topbar polls to show the truth
  instead of a hardcoded label.

## What's still a stub

- `src/queue.ts` — the actual Supabase-backed queue loop. Needs the
  Supabase project before it can be written for real; see the TODO
  comments in that file for exactly what it will do.

## Setup

```
cd sms-worker
npm install
cp .env.example .env   # fill in your phone gateway's IP/credentials
```

## Manual bench testing (works today, no Supabase needed)

```
npm run test-command -- 03401588816 open
npm run test-command -- 03401588816 close
```

This sends the real two-message sequence to a real TRB141 and prints the
parsed relay state — the same pipeline the queue loop will use once it's
wired to Supabase.

## Running the worker for real

```
npm run worker
```

Currently starts the webhook listener and then reports that the queue loop
isn't implemented yet (until Supabase credentials are added).

## Modem diagnostic (pre-check)

Standalone check for whether this machine has a modem that can actually
send and receive SMS. Run it before installing anything else — it has no
dependency on `.env`, the transport, or any other part of the worker.

```
npm run diagnose            # scan every port, test whatever answers
npm run diagnose -- COM5    # test one specific port
```

It reports pass/fail on: modem detected, module identity, IMEI, SIM card,
radio/flight mode, signal strength, network registration, operator, SMS
text mode, SMS centre, message storage headroom, and character set.

On Windows it also asks the OS about USB devices that have **no driver
installed** — those create no COM port at all, so they are invisible to a
port scan and would otherwise look like "nothing is plugged in".

Every line sent and received is written to `data/diagnose-<timestamp>.log`.
Always ask for that file back when investigating a problem in the field.
