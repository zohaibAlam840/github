# Modem Presence & Health — Core Design

How the software knows whether the modem is there, whether it works, and what to do when that
changes. This is the heart of the serial transport, so it is written out before any code.

---

## 1. There are two refresh loops, and they must not be the same one

This is the first and most important decision.

| Loop | Who drives it | Current interval |
|---|---|---|
| **Dashboard → worker** `GET /health` | Every open browser tab | **10 seconds** |
| **Worker → modem** | The supervisor | *does not exist yet* |

The tempting design is to have `/health` probe the modem when asked. **That would be a serious
mistake.** Three open tabs would mean three AT probes every ten seconds, on the same single serial
line that sends SMS — constant self-inflicted traffic competing with real work, growing with every
browser someone leaves open.

**So the rule is: `GET /health` performs no I/O.** It returns a cached snapshot that the supervisor
maintains on its own schedule, with a `checkedAt` timestamp so the UI can show how fresh it is.

The dashboard refresh never touches the modem. It reads the last known answer.

---

## 2. Presence is not a boolean

"Is the modem there" has at least seven meaningfully different answers, each needing a different
response from the software and a different message to the operator.

```
ABSENT        No candidate device at all
                 → scan for one

UNDRIVEN      USB device present, Windows has no driver bound
                 → "SIM7600 detected, driver not installed" + link
                 → invisible to SerialPort.list(); only the PnP probe sees this

PORT_ONLY     A COM port exists, nothing answers AT
                 → could be a USB-serial bridge with nothing behind it

IDENTIFIED    Answers AT; we know manufacturer, model, IMEI
                 → but not yet usable

NOT_READY     Identified, but a specific blocker:
                 no SIM / SIM PIN / no signal / not registered / no SMS centre
                 → each reported by name, never as a generic failure

READY         All readiness checks pass; can send

VERIFIED      Proven by a real SMS round trip to a TRB141
                 → the only state we promote to primary sender

DEGRADED      Was READY/VERIFIED, now failing checks
                 → transient; may recover before we fail over
```

Every state carries a **reason string** and a timestamp. "No modem found" while a device is sitting
plugged into the machine is the error message we are specifically designing away.

---

## 3. The tiered check — what actually happens on each tick

Not everything needs testing every time. Cost and value differ enormously, so checks are tiered.

**Supervisor tick: every 15 seconds.**

### Tier 0 — OS enumeration. Free. Every tick.

`SerialPort.list()`, no serial I/O at all.

The key insight: **unplugging is detectable without talking to the modem.** The port simply vanishes
from the enumeration. That is unambiguous and instant — no waiting for an AT timeout, no three-strike
counter. If the active port is gone, it's gone.

Also used when *searching*: diff the port list against the previous scan and **only probe ports that
are new**. Without this we would re-open and re-interrogate the same unrelated Arduino every fifteen
seconds forever.

### Tier 1 — Liveness. One command. Every tick, *unless already proven*.

`AT` → `OK`, short timeout.

**But skipped entirely if any AT command has succeeded in the last 15 seconds.** A successful send
*is* a liveness check — better evidence than a probe, because it exercised the real path. So during
busy periods the health checker goes quiet and generates no traffic at all. It only probes when the
modem has been idle.

### Tier 2 — Reachability. Every 4th tick (~1 minute).

`AT+CSQ` (signal), `AT+CREG?` (registration). These genuinely change over time and directly predict
whether a send will succeed.

### Tier 3 — Configuration drift. Every 20th tick (~5 minutes), and after every reconnect.

`AT+CPIN?`, `AT+CSCA?`, `AT+CPMS?`

These rarely change but are catastrophic when wrong. `AT+CPMS?` is the one that matters most over
time — it reports storage used against capacity, and **storage filling silently stops all incoming
replies** (see the hardware reference, §6). This is the check that catches it weeks before it bites.

### Tier 4 — Real round trip. On first connect, and on demand.

A live `iostatus` to a TRB141. The only thing that proves the whole chain.

---

## 4. Busy is not dead — and this distinction is load-bearing

A confirmed command is two sends plus a settle: comfortably 15+ seconds holding the serial line. A
health probe queued behind that will not return quickly.

**If we counted that as failure, the system would fail over to the phone precisely when the modem was
busy working correctly.**

So:

- The health probe acquires the AT mutex **with a timeout**
- Could not acquire in time → recorded as **`skipped — busy`**, which is a *healthy* signal
- Only a probe that actually ran and *failed* increments the failure counter

Combined with the Tier 1 rule above (recent success skips the probe), the result is that a heavily
used modem is barely probed at all — its real traffic is the evidence.

---

## 5. The failure ladder

Not every failure deserves the same response. Recovery is attempted before surrender.

```
Port vanished from enumeration
        → immediate demotion. No ambiguity, no counting.

AT probe fails, 1st and 2nd time
        → record, stay active. Could be a transient blocked read.

AT probe fails, 3rd consecutive time
        → close and reopen the port.
          Often clears a wedged USB serial device.

Still failing after reopen
        → AT+CRESET (module reset). Takes ~20s to return.
          Worth one attempt before giving up on working hardware.

Still failing
        → demote to the phone gateway.
          Cooldown before retrying this device, so we don't thrash.
```

Recovery from demotion requires passing the **full readiness check**, not just `AT` → `OK`. Otherwise
the system flaps between transports on a marginal device.

---

## 6. Failover and in-flight commands — two different situations

Switching transports while a command waits for its reply orphans that command: the reply arrives on
the old transport's listener after we stopped listening.

**Planned switch** (a modem appears while running on the phone):
Wait for the queue to be idle. There is no urgency, and waiting makes the handover lossless.

**Hard failure** (the modem died):
Do **not** wait for idle. Any command in flight on that modem will never receive its reply — the
hardware is gone. Waiting only delays the truth. Instead:

1. Mark in-flight dispatches as failed, with the real reason — *"modem disconnected while waiting for
   a reply"*
2. Then switch

This is better for the operator than the alternative: without it, those commands sit showing
"pending" until the 8-minute ceiling expires, with nothing on screen explaining why.

---

## 7. The architectural gap: unsolicited messages

Current [serialModem.ts](../sms-worker/src/transports/serialModem.ts) parses like this:

```js
private onLine(line: string) {
  this.responseBuffer.push(trimmed);       // ← everything goes here
  if (trimmed === "OK" || ...) { /* resolve pending command */ }
}
```

Every line is treated as part of the pending command's response. But the modem sends **unsolicited
result codes (URCs)** at any moment, including mid-command:

```
+CMTI: "SM",20      ← an SMS just arrived
+CDS: ...           ← delivery status report
+CREG: 0,1          ← registration changed
```

With the current code, a `+CMTI` arriving while we wait for an `OK` is **swallowed into that
command's response and lost** — meaning a valve reply silently never arrives.

Since receiving is push-based via `+CMTI` (hardware reference §5), this is not an edge case. It is
the normal path, and it is currently broken.

**Required: a URC demultiplexer.** Known URC prefixes are routed to handlers; everything else goes to
the pending command's buffer. This has to sit underneath everything else, because both the health
checker and the SMS receive path depend on it.

---

## 8. Identity is the IMEI, not the COM port

COM port numbers change — different USB socket, a reboot, another device enumerating first. Anything
we remember about a modem must be keyed to something stable.

`AT+CGSN` returns the IMEI. That is the identity:

- Verified modems are stored by IMEI, so a proven device is re-adopted without re-running the SMS test
- If the IMEI changes, it is a **different device** and must be verified afresh, even on the same port
- The negative cache for non-modem ports keys on `pnpId`/`serialNumber` for the same reason

---

## 9. What we need to build

| # | Component | Why |
|---|---|---|
| 1 | **AT mutex / serialiser** | One line, shared. Multi-step CMGS must be atomic |
| 2 | **URC demultiplexer** | §7. Everything else depends on it |
| 3 | **Liveness timestamp** | Any successful AT refreshes it; suppresses needless probes |
| 4 | **Tiered health checker** | §3 |
| 5 | **Modem state machine** | §2, with reason strings |
| 6 | **Port-list diffing + negative cache** | Avoid re-probing the same non-modems forever |
| 7 | **Windows PnP probe** | The only way to see undriven devices |
| 8 | **Device registry** (VID:PID) | Identify device + name its driver. Must include `9001` **and** `9011` |
| 9 | **IMEI identity + verified store** | §8 |
| 10 | **Failure ladder with recovery** | §5 |
| 11 | **In-flight dispatch handling** | §6 |
| 12 | **Raw AT traffic log** | Diagnose real hardware we do not own |
| 13 | **Storage monitor** (`AT+CPMS?`) | Alert before replies stop arriving |
| 14 | **Corrected `init()`** | `AT+CSCS`, `AT+CSMP`, `AT+CPMS`, `AT+CNMI` — see hardware reference §3 |
| 15 | **Cached health snapshot** | §1 — `/health` must not cause I/O |

Items 1, 2 and 14 are prerequisites for everything else and should be built first.

---

## 10. What the dashboard receives

`GET /health` returns the snapshot, not a probe:

```jsonc
{
  "activeTransport": "router",
  "checkedAt": "2026-09-12T09:14:22Z",   // freshness, so the UI can show staleness
  "modem": {
    "state": "verified",
    "reason": null,
    "comPort": "COM5",
    "model": "SIMCOM SIM7600G-H",
    "imei": "86...",
    "signal": { "rssi": 17, "bars": 3 },
    "registration": "home",
    "sim": "ready",
    "smsc": "+974...",
    "storage": { "used": 3, "total": 40 },   // rising = trouble ahead
    "verifiedAt": "2026-09-12T08:02:00Z"
  },
  "hardware": [ /* every USB candidate, incl. undriven, with required driver */ ],
  "lastTransition": { "from": "mobile", "to": "router", "at": "...", "reason": "..." }
}
```

Every failure state carries the reason, so the UI never has to invent one. The `storage` and
`checkedAt` fields are what turn this from a status badge into something genuinely diagnostic.
