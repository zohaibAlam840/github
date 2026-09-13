# Field test — client laptop, SIM7600G-H

**Date:** 13 September 2026
**Access:** remote session on the client's Windows 11 laptop
**Hardware:** SIMCom SIM7600 series on USB, Vodafone Qatar SIM
**Outcome:** transport proven in both directions. Three defects found that would
have blocked the deployment. TRB141 round trip still untested.

This is the record of what was actually observed, as opposed to what was
assumed. Every claim below has the raw AT output behind it in
[Raw captures](#raw-captures). Where something is unverified it says so.

---

## 1. Verdict

| | Status |
|---|---|
| Windows driver + COM port | **Proven** |
| SIM, radio, network registration | **Proven** |
| Outgoing SMS | **Proven to delivery** — `+CMGS: 3`, and the recipient confirmed the message arrived on their handset |
| Incoming SMS | **Proven** (message received from a real phone) |
| Our worker running against this modem | **Never tested** |
| TRB141 command round trip | **Never tested** |

The transport layer is not in doubt. Everything still open is either our code
meeting this hardware for the first time, or the client's TRB141 configuration.

---

## 2. Environment

Device Manager → Ports (COM & LPT), driver already installed by the client:

```
Simcom HS-USB AT PORT 9001      (COM8)   <- the only one that speaks AT
Simcom HS-USB Diagnostics 9001  (COM9)   <- Qualcomm diag; opening it can hang
Simcom HS-USB Audio 9001        (COM10)
Simcom HS-USB NMEA 9001         (COM12)
```

`9001` is the SIM7600's default USB composition, which is what
`detect.ts` expects. No driver install or reboot was needed — the client had
already done it.

**Implication for detection:** `detect.ts` skips ports whose name matches
`/bluetooth|nmea|diagnostic|audio|gps/i` and ranks `\bAT\b` plus vendor
`1E0E` highest. These four labels exercise that logic exactly as designed, so
auto-detect should land on COM8. **This has not been confirmed by running our
code** — see [§7](#7-still-unproven).

---

## 3. Modem facts

| Property | Value | Source |
|---|---|---|
| SIM | `+CPIN: READY` | `AT+CPIN?` |
| Radio | `+CFUN: 1` (not flight mode) | `AT+CFUN?` |
| Signal | **31/31** | `AT+CSQ` |
| Registration | `0,1` home — on CREG, CGREG **and** CEREG | `AT+CREG?` etc. |
| Operator | `Vodafone Vodafone`, MCC-MNC **427-02** | `AT+COPS?` |
| Network | `LTE, Online, EUTRAN-BAND1` | `AT+CPSI?` |
| **SMS centre** | **`+97477922222`**, type 145 | `AT+CSCA?` |
| SMS parameters | `+CSMP: 17,169,0,0` | `AT+CSMP?` |
| **Message storage** | **`"SM"` — SIM, 20 slots** | `AT+CPMS?` |
| Own number | **not available** | `AT+CNUM` returned bare `OK` |

`427-02` is Vodafone Qatar. An earlier note in this project called the SMSC
Ooredoo's — that was wrong; `+974 7792 2222` is a Vodafone range and is correct
for this SIM.

---

## 4. Timeline

| Time | Event |
|---|---|
| — | Device Manager confirms driver + four COM ports |
| — | `modemcheck.ps1` — every check passes, signal 31/31, storage `"SM",0,20` |
| — | First send attempt → `+CMS ERROR: Unknown error` |
| — | `AT+CMEE=1` added → error resolves to **`+CMS ERROR: 500`** |
| 15:28 | Operator notices in storage: *"you have used all the 50 MB included in your SIM Pack"* |
| 15:33 | **Client recharges the SIM with QR 10** (operator confirmation SMS, index 4) |
| 15:36 | Inbound SMS `test2` from `+97430373901` arrives — **receive proven** |
| — | Send retried → **`+CMGS: 3`** — network accepted the message |
| — | `AT+CNMI=2,1,0,1,0` → **`+CMS ERROR: 303`** — defect found |
| — | `AT+CMGL="ALL"` → six operator messages, all **UCS2 hex** — defect found |
| — | **Recipient of `+97470911946` confirmed the message arrived** — send proven to delivery |

`+CMS ERROR: 500` was the SIM having no credit / no SMS allowance. The recharge
resolved it. Nothing in our software was ever at fault for that failure — but
our software had no way to *say* so, which is defect #1.

---

## 5. Findings

### F1 — `AT+CMEE=1` was missing from our init *(fixed)*

**Evidence.** The first send returned `+CMS ERROR: Unknown error`. Only after
setting `AT+CMEE=1` by hand did the same failure report `+CMS ERROR: 500`.

**Impact.** Without numeric error codes, the modem's own explanation never
reaches us. Diagnosing this cost a full round trip on a remote session.

**Fix.** `AT+CMEE=1` added to the init sequence in `serialModem.ts`, as a
`tryCommand` so a module that rejects it does not fail init.

---

### F2 — `AT+CNMI=2,1,0,1,0` is rejected by this module *(fixed — was blocking)*

**Evidence.**

```
AT+CNMI=2,1,0,1,0  =>  +CMS ERROR: 303      (operation not supported)
```

**Impact.** This is the worst defect found today. Our init issued that as a hard
`command()`, which throws on error. Init would have failed, `ready` would never
have been set, and the supervisor would have reported *"found but failed to
initialise"*. **The worker would have refused to use a modem that works
perfectly**, with the real cause buried in `data/at-log.txt`.

The `ds=1` field (delivery status reports) is the unsupported part.

**Fix.** A fallback ladder, richest form first:

```
AT+CNMI=2,1,0,1,0   push + delivery reports
AT+CNMI=2,1,0,0,0   push only          <- this module should land here
AT+CNMI=2,1         minimal
AT+CNMI=1,1,0,0,0   last resort
```

The accepted form is recorded and exposed as `notificationMode`. If **no**
variant is accepted, the sweep interval automatically drops from 120s to 15s,
because at that point the sweep is the only way a reply is ever noticed rather
than a safety net.

**Consequence to expect:** delivery reports (`+CDS`) are **not available** on
this module. The Queue screen's progress trail will say *"Still waiting for TRB
reply…"* rather than *"…delivery: Delivered"*. That is correct behaviour, not a
bug — but it is a capability we do not have here.

---

### F3 — message bodies arrive UCS2-encoded *(fixed)*

**Evidence.** `AT+CSCS="IRA"` returned `OK`, and yet:

```
+CMGL: 2,"REC READ","8611110097102111110101","","26/09/13,15:28:39+12"
00530049004D0020005000610063006B002E00200059006F00750020006800610076006500200035003000250020006C006500660074002E
```

which decodes to `SIM Pack. You have 50% left.`

**Why.** `AT+CSCS` sets the character set of the AT *interface*. It does not
change how the **sender** encoded the message. A message whose TP-DCS is UCS2
comes back as hex regardless.

**Impact.** A TRB141 reply encoded this way would reach `parseRelayState()` as
hex, parse as `"unknown"`, and the valve state would silently never update —
with nothing anywhere explaining why.

**Fix.** `decodeUcs2()` in `serialModem.ts`, applied once in `readAndDelete()`
so the relay parser, the Inbox and the activity trail all see real text. The
guard matters as much as the decode: text that merely *looks* like hex
(`"12345678"`) must not be mangled, so a candidate is only accepted when ≥90% of
decoded code units fall in Latin or Arabic ranges. Tested both ways.

**Note.** The phone reply `test2` arrived as **plain text**, so ordinary
phone-to-modem messages are GSM-7. It is the operator's own messages that are
UCS2. A TRB141 will most likely be plain text too — but we no longer depend on
that being true.

---

### F4 — the SIM does not carry its own number *(open, client action)*

**Evidence.** `AT+CNUM` returned a bare `OK` with no `+CNUM:` line.

**Impact.** We cannot learn the modem's own MSISDN from the modem. If the
client's TRB141 SMS rules restrict which sender they accept, that number is
exactly what has to be whitelisted — and we do not have it.

**Action.** Get it from the client or from Vodafone. The number
`0097470911946` (= `+97470911946`) appeared during testing but **it has not been
confirmed whether that is the modem's SIM or the engineer's test phone.**

---

### F5 — storage is on the SIM, 20 slots *(handled, worth watching)*

**Evidence.** `+CPMS: "SM",7,20,"SM",7,20,"SM",7,20`

**Impact.** A SIM holds ~20 messages against the module's 100+. **Once full, the
network silently stops delivering** — the system looks healthy and simply never
receives another reply.

Our init attempts `AT+CPMS="ME","ME","ME"` to prefer module memory; whether this
module accepts it is **unverified**. Startup now logs the storage actually in
use and warns when it is the SIM.

Six of the seven messages present were `REC READ`. Our sweep reads only
`REC UNREAD`, so **those six would have occupied slots permanently.** Storage was
cleared manually with `AT+CMGD=1,4` before deployment. Long term, the
supervisor's 80%-full warning is the safety net, and that warning is now sticky
rather than visible for one tick in twenty.

---

### F6 — concatenated SMS arrive as separate records *(open, not yet fixed)*

**Evidence.** Indices 0 and 2 are two halves of one operator message; 4, 5 and 3
are three parts of another. Each is its own `+CMGL` record with its own index.

**Impact.** `readAndDelete()` reads one index and treats it as a complete
message. A reply longer than 160 characters would be delivered to the dashboard
in fragments.

**Assessment.** Low risk for this deployment — a TRB141 relay status reply is
far shorter than one SMS. Recorded because it is real, observed, and will matter
if a client ever configures a verbose message template.

---

### F7 — alphanumeric senders *(noted, no action)*

Operator messages came from sender `8611110097102111110101` — an encoded
alphanumeric originator, not a phone number. `numbersMatch()` compares the last
8 digits and requires ≥6, so this yields tail `11110101`. A gateway whose number
ended in those exact eight digits would false-match. Vanishingly unlikely; not
worth code.

---

## 6. Proven

- Windows driver bound, four COM ports enumerated, AT port identified
- SIM readable, unlocked, registered on LTE home network at full signal
- SMS centre provisioned on the SIM
- **Outbound SMS delivered** — `+CMGS: 3`, and the recipient at `+97470911946`
  confirmed the message arrived on their handset. Worth stating separately from
  network acceptance: this module has no delivery reports (F2), so a person
  looking at the phone was the only available proof.
- **Inbound SMS received and stored** — `test2` from `+97430373901`
- Push notifications available via `AT+CNMI=2,1,0,0,0`

The transport is therefore proven in **both directions against real handsets**.
Nothing further can be learned about this modem without running our own code
against it.

## 7. Still unproven

1. **Our code has never run against this modem.** Every test in this document
   was PowerShell talking to the modem directly. `npm run diagnose`, the
   supervisor, `detect.ts` and the init sequence have not touched this hardware.
2. **The F2 and F3 fixes have never executed against hardware.** They are
   unit-tested against strings captured here, which is real evidence, but a unit
   test is not a modem.
3. **The TRB141 round trip is completely untested.** Unknown: whether the rules
   accept the modem's number, whether they reply to the sender or a fixed
   number, the actual keywords, the actual reply wording, which `{output}` maps
   to which relay.
4. **`AT+CPMS="ME"`** — unverified whether this module accepts module storage.
5. Long-running behaviour: unplug/recover, storage filling, multi-hour session.

---

## 8. Open questions for the client

1. **TRB141 → Services → SMS Utilities screenshot.** Asked for repeatedly, still
   outstanding. Needed to answer: *No authorization* vs *router admin password*;
   sender-number restriction; reply-to-sender vs reply-to-fixed-number.
2. **The modem's own SIM number** — see F4.
3. **TRB141 SIM numbers**, and whether they are on the same operator.
4. **Exact SMS keywords** configured on the client's devices. `valveon` /
   `valveoff` / `iostatus` are from *our* bench, not theirs.
5. **Exact reply wording.** Our patterns are `open` / `clos`, also from our
   bench. Both are settings (`REPLY_OPEN_PATTERN`, `REPLY_CLOSED_PATTERN`), so
   this is a config change, not a code change.

> **If the TRB rules restrict the sender to the old phone's number, every command
> fails silently and no software change can fix it.** That is why item 1 matters
> more than anything else in this list.

---

## 9. Code changed in response to this session

| File | Change |
|---|---|
| `transports/serialModem.ts` | `AT+CMEE=1` in init (F1) |
| `transports/serialModem.ts` | `AT+CNMI` fallback ladder + adaptive sweep (F2) |
| `transports/serialModem.ts` | `decodeUcs2()` applied on read (F3) |
| `transports/serialModem.ts` | `CMS_ERRORS` table + `describeAtError()` — `500` now reads *"the network refused… almost always means SMS is not enabled on the SIM, or the account has no credit"* |
| `transports/serialModem.ts` | Startup logs which storage is in use, warns on SIM (F5) |
| `selftest.ts` | 10 new assertions built from the bodies captured here |

`npm run selftest` → **31 passed, 0 failed.**

---

## 9a. Design change: one message per command

**Decided after this session, because of what it showed.** The SIM is prepaid —
we watched it fail with `+CMS ERROR: 500` and recover on a QR 10 recharge. At two
SMS per valve command, cost and airtime are worth halving.

`Settings.confirmAfterCommand` now defaults to **false**. Open/Close send one
message. `iostatus` becomes an explicit action — the per-valve **Refresh**
button — rather than something automatically appended to every command.

The mechanism already existed and was fully wired (`unconfirmed` status, the
activity log, the trend chart, the Settings toggle, both locales). Only the
default changed.

**What did need building.** The TRB141's actuation rule never replies, so with
one message there is no way to know the valve moved. The `valves` table stored
only `last_status` — nothing separated *"a reply confirmed this"* from *"we sent
a command and assumed it"*. With confirmation off by default, the assumed case
becomes the normal one, so the dashboard would have shown a confident
open/closed that nothing ever verified.

That is the same defect class as the green "Router connected" chip over a
machine with no modem, one level down, so it was fixed the same way:

- `valves.status_verified` column, plus an `addMissingColumns()` migration
  (SQLite has no `ADD COLUMN IF NOT EXISTS`, and `CREATE TABLE IF NOT EXISTS`
  silently skips existing databases — including the office PC's after its first
  deployment)
- `Valve.statusVerified` on the type; `setValveStatus(..., verified)` in the repo
- Assumed states written with `verified = false`; only a parsed TRB reply writes
  `true`
- Valve rows show an **`assumed`** marker, and the timestamp label reads
  *"Last sent"* rather than *"Last confirmed"* — which would otherwise be a lie
- Refresh verifies and clears the marker

## 10. Deployment order

```powershell
npm run selftest              # 31 passed — proves the code arrived intact
npm run diagnose -- COM8      # FIRST time our code touches this modem
npm run worker                # expect "Ready on COM8"
npm run test-command -- <TRB-sim> status    # the moment of truth
```

Minimum `.env` — every other value already defaults correctly for this site:

```ini
KEYWORD_OPEN=valveon
KEYWORD_CLOSE=valveoff
KEYWORD_STATUS=iostatus
DEFAULT_COUNTRY_CODE=+974
```

Leave `COM_PORT` unset (auto-detect should find COM8; if it does not, that is a
finding). Leave `SMSC` unset — the SIM carries `+97477922222`.

**Collect afterwards:** the console output of first start, and
`sms-worker/data/at-log.txt` — which now records which `AT+CNMI` variant was
accepted.

---

## Raw captures

### `modemcheck.ps1`

```
ATE0             => OK
AT+CMEE=1        => OK
AT+CPIN?         => +CPIN: READY OK
AT+CFUN?         => +CFUN: 1 OK
AT+CSQ           => +CSQ: 31,99 OK
AT+CREG?         => +CREG: 0,1 OK
AT+CGREG?        => +CGREG: 0,1 OK
AT+CEREG?        => +CEREG: 0,1 OK
AT+COPS?         => +COPS: 0,0,"Vodafone Vodafone",7 OK
AT+CPSI?         => +CPSI: LTE,Online,427-02,0x0078,256526,150,EUTRAN-BAND1,425,4,4,-101,-789,-520,16 OK
AT+CSMP?         => +CSMP: 17,169,0,0 OK
AT+CPMS?         => +CPMS: "SM",0,20,"SM",0,20,"SM",0,20 OK
```

### Failed send, before the recharge

```
AT+CSCA?         => +CSCA: "+97477922222",145 OK
Sending to +97430373901 ...
prompt           => >
RESULT           => +CMS ERROR: 500
```

### Successful send, after the recharge

```
AT+CNMI=2,1,0,1,0 => +CMS ERROR: 303
AT+CNUM           => OK
AT+CPMS?          => +CPMS: "SM",7,20,"SM",7,20,"SM",7,20
Sending to +97470911946 ...
prompt            => >
RESULT            => +CMGS: 3 OK
```

### `AT+CMGL="ALL"` — storage contents

```
+CMGL: 0,"REC READ","8611110097102111110101","","26/09/13,15:28:39+12"
0044006500610072...   "Dear Customer, you have used 50% of the internet included in your "
+CMGL: 1,"REC READ","8611110097102111110101","","26/09/13,15:28:39+12"
0044006500610072...   "Dear Customer, you have used all the 50 MB included in your SIM Pack."
+CMGL: 2,"REC READ","8611110097102111110101","","26/09/13,15:28:39+12"
00530049004D0020...   "SIM Pack. You have 50% left."
+CMGL: 3,"REC READ","8611110097102111110101","","26/09/13,15:33:24+12"
0061006C0061006E...   "alance.\n"
+CMGL: 4,"REC READ","8611110097102111110101","","26/09/13,15:33:24+12"
0059006F0075...       "You have successfully recharged with credit QR 10. Track your usag"
+CMGL: 5,"REC READ","8611110097102111110101","","26/09/13,15:33:24+12"
0065002000660072...   "e from https://mva.qa/deeplink/USAGE or dial *129# to check your b"
+CMGL: 6,"REC UNREAD","+97430373901","","26/09/13,15:36:08+12"
test2
```

Indices 0+2 are one concatenated message; 4+5+3 are another (see F6). Index 6 is
plain text — the proof that receive works.

---

## Appendix — reusable PowerShell probes

These need nothing installed and are the fastest way to check a modem before any
of our code is on the machine. **Only one program can hold a COM port**: stop the
worker before running these, and vice versa. Never open the Diagnostics port.

### Full state check

```powershell
function Ask($port, $cmd, $ms = 800) {
  $port.DiscardInBuffer()
  $port.Write("$cmd`r`n")
  Start-Sleep -Milliseconds $ms
  "{0,-20} => {1}" -f $cmd, (($port.ReadExisting() -replace "[`r`n]+", " ").Trim())
}

$p = New-Object System.IO.Ports.SerialPort("COM8", 115200, "None", 8, "One")
$p.ReadTimeout = 3000
try {
  $p.Open(); Start-Sleep -Milliseconds 300
  Ask $p 'ATE0'
  Ask $p 'AT+CMEE=1'      # numeric error codes — without this, "Unknown error"
  Ask $p 'AT+CPIN?'
  Ask $p 'AT+CFUN?'
  Ask $p 'AT+CSQ'
  Ask $p 'AT+CREG?'
  Ask $p 'AT+COPS?' 3000
  Ask $p 'AT+CPSI?' 2000
  Ask $p 'AT+CSCA?'
  Ask $p 'AT+CPMS?'
  Ask $p 'AT+CNUM' 3000
}
finally { if ($p.IsOpen) { $p.Close(); "port closed." } }
```

### Send one SMS by hand

```powershell
$to = "+974XXXXXXXX"      # full international format, with the +

$p = New-Object System.IO.Ports.SerialPort("COM8", 115200, "None", 8, "One")
$p.ReadTimeout = 3000
try {
  $p.Open(); Start-Sleep -Milliseconds 300
  foreach ($c in @('ATE0','AT+CMEE=1','AT+CMGF=1','AT+CSCS="IRA"')) {
    $p.Write("$c`r`n"); Start-Sleep -Milliseconds 600; $p.ReadExisting() | Out-Null
  }
  $p.DiscardInBuffer()
  $p.Write("AT+CMGS=`"$to`"`r")
  Start-Sleep -Milliseconds 2000
  $prompt = $p.ReadExisting()
  if ($prompt -match '>') {
    $p.Write("test"); $p.Write([char]26)
    Start-Sleep -Seconds 20
    "RESULT => " + (($p.ReadExisting() -replace "[`r`n]+", " ").Trim())
  } else {
    $p.Write([char]27)   # ESC cancels message entry
    "NO PROMPT => $prompt"
  }
}
finally { if ($p.IsOpen) { $p.Close() } }
```

### Unwedge a modem stuck at the `>` prompt

If a send was interrupted, the modem may still be waiting for message text and
will swallow every later command:

```powershell
$p = New-Object System.IO.Ports.SerialPort("COM8", 115200, "None", 8, "One")
$p.Open(); $p.Write([char]27); Start-Sleep -Milliseconds 500; $p.ReadExisting(); $p.Close()
```

### Clear message storage

Destructive — capture `AT+CMGL="ALL"` first:

```powershell
$p = New-Object System.IO.Ports.SerialPort("COM8", 115200, "None", 8, "One")
try { $p.Open(); $p.Write("AT+CMGF=1`r`n"); Start-Sleep -Milliseconds 500
      $p.Write("AT+CMGD=1,4`r`n"); Start-Sleep -Seconds 3; $p.ReadExisting() }
finally { if ($p.IsOpen) { $p.Close() } }
```

### CMS error codes seen or expected here

| Code | Meaning |
|---|---|
| 50 | SMS not enabled on the SIM — operator must fix |
| 303 | Operation not supported — **seen on `AT+CNMI` ds=1** |
| 330 | SMS centre not set |
| 331 | No network service |
| **500** | Network refused without a reason — **seen; was no credit** |

The full table lives in `CMS_ERRORS` in `sms-worker/src/transports/serialModem.ts`.
