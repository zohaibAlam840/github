# i2i SMS Worker

Runs on the office PC and owns the cellular modem. The dashboard talks to it
over a small local HTTP API; it talks to the TRB141 field gateways by SMS.

Everything is local. There is no cloud service in the path, and the machine
does not need internet — only cellular coverage and a SIM that can send SMS.

```
Dashboard (Next.js, localhost:3000)
        |  HTTP, localhost:3900
   this worker
        |  AT commands over USB serial
   SIM7600G-H modem
        |  SMS over the mobile network
   TRB141 gateway  ->  relay  ->  valve
```

## Requirements

- **Node.js LTS, 64-bit.** `serialport` ships a prebuilt binary; a machine with
  a different architecture would need a compiler, which the office PC does not
  have. Check with `echo $env:PROCESSOR_ARCHITECTURE` — it must say `AMD64`.
- **The modem's Windows driver.** Without it Windows creates **no COM port at
  all**, so the modem is invisible to any software. For a SIM7600 that is the
  SIMCom SIM7500/SIM7600 USB driver, followed by a reboot.
- A SIM that is **allowed to send SMS and has credit**. This is not automatic:
  many IoT/M2M SIMs are provisioned for data only, register on the network
  perfectly, and refuse every message.

## Install

```powershell
npm install
npm run selftest        # no hardware needed - proves the code arrived intact
```

Copy `.env.example` to `.env` and set what this installation needs. Every value
has a working default; the worker runs with no `.env` at all, auto-detecting
the modem.

## Commands

| | |
|---|---|
| `npm run worker` | The worker itself. |
| `npm run diagnose` | Standalone hardware check — scans every port, tests whatever answers, prints a pass/fail report and writes the raw AT traffic to `data/`. Depends on nothing else; run it first on a new machine. |
| `npm run diagnose -- COM8` | The same, against one port. |
| `npm run test-command -- <sim> <open\|close\|status>` | Sends a real command to a real gateway from the command line. |
| `npm run selftest` | Pure-logic assertions — number formats, reply parsing, UCS2 decoding, error codes. No hardware. |

**Only one program can hold a COM port.** Stop the worker before running
`diagnose`, and vice versa.

## First run on a new machine

1. `npm run selftest` — expect all tests to pass.
2. `npm run diagnose` — read the report top to bottom. The lines that decide
   everything are **SIM card**, **Signal**, **Network registration** and
   **SMS centre**. A blank SMS centre makes every send fail silently.
3. `npm run worker` — expect `Modem ready on COMn`.
4. `npm run test-command -- <gateway-sim> status` — the real round trip.

`GET /health` reports exactly why nothing is working if any of that fails, and
the dashboard's **SMS device** card (Settings) shows the same thing with
buttons.

## The API

All on `localhost:3900` by default. CORS is wide open because this only ever
listens on a trusted local machine.

| Method | Path | |
|---|---|---|
| GET | `/health` | Modem state, and why. **Reads a cached snapshot — never touches the serial line.** Every dashboard tab polls this every 10s. |
| GET | `/ports` | Every serial port, with the last scan's verdict. Enumeration only, no probing. |
| GET | `/hardware` | USB devices Windows has no driver for — the only way to see a modem that has no COM port. |
| POST | `/rescan` | Force a full re-detection. Drops the current modem first, so it can recover from "attached to the wrong port". |
| POST | `/test-sms` | Send one SMS to any number. No gateway, no keywords — answers "modem or gateway?" in one call. |
| POST | `/send` | Dispatch open/close/status to a gateway. Returns a tracking id immediately. |
| POST | `/send-raw` | Send arbitrary text to a gateway. |
| GET | `/status/:id` | Poll a dispatch. Replies can take minutes, so nothing holds a request open. |
| GET | `/inbox` | Every SMS sent or received, newest first. |

A request that needs the modem when none is available answers **503** with a
plain-language reason, not a generic failure.

## How it behaves

**It starts without a modem and keeps looking.** At boot, USB enumeration can
easily lose the race against a service starting. Exiting would mean a machine
that never recovers until somebody logs in.

**Health checks never compete with real work.** A successful AT command within
the last 15 seconds counts as proof of life and skips the probe entirely — real
traffic is better evidence than a synthetic ping. Signal and registration are
checked every 4th tick, SIM and storage every 20th.

**Recovery is a ladder.** A port that vanishes is an immediate loss. Otherwise
three failed probes trigger a close-and-reopen, which clears a wedged USB
device surprisingly often, and only then does it give up and rescan.

**Replies are pushed, not polled.** `AT+CNMI` makes the modem announce a new
message the moment it lands. Not every module supports every form of that
command, so the worker tries four and takes the first that is accepted; if none
are, it falls back to sweeping, and shortens the sweep interval because the
sweep is then the only path rather than a safety net.

**Messages are deleted as they are read.** Storage holds about 20 messages on a
SIM. Once it is full **the network silently stops delivering** — the system
looks healthy and simply never receives another reply.

## Files worth knowing

| | |
|---|---|
| `src/transports/serialModem.ts` | The modem. AT framing, the send mutex, URC routing, UCS2 decoding, error translation. |
| `src/transports/supervisor.ts` | Owns the modem for the life of the process, and is itself the transport the rest of the worker uses. |
| `src/transports/detect.ts` | Finds a modem that can actually send SMS, not merely one that answers `AT`. |
| `src/transports/health.ts` | What "is the modem there?" means: six states, each with a different action. |
| `src/hardware/windowsPnp.ts` | Sees USB devices Windows has no driver for. |
| `src/confirmationTracker.ts` | Dispatch-then-poll, because a round trip can take minutes. |
| `src/commands.ts` | Number formats, keyword composition, reply interpretation. All configurable. |
| `data/at-log.txt` | Every AT line in and out. **Ask for this file whenever something misbehaves in the field.** |

## When something goes wrong

1. `GET /health` — the `reason` field is written to be acted on, not decoded.
2. `data/at-log.txt` — the raw traffic, including which `AT+CNMI` form the
   module accepted.
3. `npm run diagnose` — stop the worker first.

See [`../docs/FIELD-TEST-2026-09-13.md`](../docs/FIELD-TEST-2026-09-13.md) for
what real hardware actually did, including the failures and what they meant,
and [`../docs/SIM7600G-H-REFERENCE.md`](../docs/SIM7600G-H-REFERENCE.md) for the
AT commands themselves.
