# SIM7600G-H — Development Reference

Working notes for implementing the serial modem transport. Sources: Waveshare SIM7600X 4G DONGLE
wiki, and SIMCom `SIM7500_SIM7600_SIM7800 Series SMS Application Note V2.00`.

**Everything here is from documentation, not from a device we have run.** Treat it as the target to
build against, and verify each item on real hardware before trusting it.

---

## 1. Device identity

| | |
|---|---|
| Variant needed | **SIM7600G-H** — global bands + GNSS. (SIM7600CE is China-only — wrong device) |
| SIM format | **Nano SIM**, 1.8V / 3V |
| Power | 5V over USB, 50–300 mA, **~150 mA average** — a laptop USB port is fine |
| Default baud | **115200** (range 300 bps–4 Mbps; auto-negotiates 9600–115200) |
| Antenna | **MAIN antenna is required.** AUX is diversity for downlink speed — irrelevant for SMS. GNSS antenna is separate and not needed |
| LEDs | PWR steady = powered. NET blinking = network OK. **Useful remote diagnostic — we can ask someone to look at the lights** |

### USB product IDs change with mode

`AT+CUSBPIDSWITCH=9001,1,1` (NDIS) and `=9011,1,1` (RNDIS) **change the USB PID**. So the device may
enumerate as either:

- `VID_1E0E&PID_9001`
- `VID_1E0E&PID_9011`

Our device registry must recognise **both**. Switching modes reboots the module automatically.

---

## 2. Windows driver

- Driver name: **SIM7600X driver** (Waveshare bundle of the SIMCom USB driver). Windows / Linux / Android
- Install: unzip → run the `.exe` → choose path → Next → **restart the computer**
- An **older driver** exists for Windows 7 compatibility issues — not expected to matter for Win 10/11
- After install, multiple ports appear. **Only the AT port accepts AT commands**

Manual testing tool Waveshare recommends: **SSCOM**. If used, enable "Append CR+LF".

---

## 3. The initialisation sequence we must send

This is the most important section. Order matters.

```
ATE0                      Echo off — keeps our line parsing simple
AT+CMGF=1                 SMS text mode (not PDU)
AT+CSCS="IRA"             Character set. NOT optional — see below
AT+CSMP=17,167,0,0        SMS text mode parameters
AT+CPMS="ME","ME","ME"    Prefer module flash storage over the SIM — see §6
AT+CNMI=2,1               Push a notification when a message arrives
```

### Why `AT+CSCS="IRA"` matters

Waveshare's own FAQ for *"SIM7600X fails to send SMS, +CMS ERROR / CME ERROR"* gives the fix as
setting the SMS centre **and** running:

```
AT+CSCS="IRA"
AT+CSMP=17,167,0,0
```

Separately, SIMCom's SMS note shows that with the character set at `UCS2`, a received message body
comes back as **hex**:

```
+CMGR: "REC READ","17601332658","17/05/02,14:42:05+00",,129,10
4F60597D003100320033        ← this is "你好123" as UCS2 hex
```

If we don't set the character set, a TRB141 reply could arrive as hex and `parseRelayState()` would
return `"unknown"` for every command — the valve would never confirm, with no obvious cause.

### The SMS centre must be set

```
AT+CSCA="+974xxxxxxxx"
```

Waveshare state explicitly that the SMS centre number **differs by region** and is a primary cause of
send failure. It is usually provisioned by the SIM, but must be verified — a blank or wrong SMSC
means sends fail silently.

> **Deployment action:** obtain the correct Ooredoo / Vodafone Qatar SMS centre number, and confirm
> with `AT+CSCA?` on site before going live.

### Network mode — leave it on automatic

```
AT+CNMP?      2 = automatic, 13 = GSM only, 38 = LTE only, 48 = any but LTE
```

**Leave this at 2 (automatic).** Waveshare recommend `AT+CNMP=38` (LTE only) for *data speed* — that
advice does not apply to us. SMS works over 2G/3G/4G alike, and forcing LTE would make the modem fail
wherever LTE coverage is weak. Automatic is strictly better for this use case.

---

## 4. Sending an SMS

```
AT+CMGS="+974xxxxxxxx"<CR>
>                            ← module returns the prompt
<message text>
<0x1A>                       ← Ctrl+Z terminates and sends. 0x1B (ESC) cancels
+CMGS: 15                    ← success, 15 is the message reference
OK
```

Notes for our implementation:

- The body is terminated by **0x1A**, not a newline
- `+CMGS: <mr>` returns a **message reference number** — keep it; it's what matches a later delivery
  status report (see §7)
- Number format: use full international (`+974...`)

---

## 5. Receiving an SMS

Receiving is **push-based**. With `AT+CNMI=2,1` the module emits an unsolicited notification the
moment a message arrives — no polling required.

```
+CMTI: "SM",20               ← unsolicited. 20 = storage index
AT+CMGR=20
+CMGR: "REC UNREAD","+974xxxxxxxx",,"08/01/30,20:40:31+00"
<message body>
OK
AT+CMGD=20                   ← delete after reading
```

`AT+CMGL="ALL"` lists everything — keep as a startup sweep and a safety net, not the primary path.

### `+CMTI` vs `+CMT` — use `+CMTI`

`AT+CNMI=2,2` routes the message body **directly** to us as `+CMT:` without storing it. Simpler, but
the message is **lost** if our software is momentarily down or restarting.

`+CMTI` (mode 1) stores it first and tells us the index — so it waits for us. Given the worker may
restart, **`+CMTI` is the correct choice.** Then delete after a successful read.

---

## 6. Storage limits — the silent failure

Waveshare FAQ: *"If the short message is stored in the SIM card, usually **50 is the upper limit**."*
SIMCom's note shows a real query returning `+CPMS: 0,40,0,40,0,40` — **40 slots**.

Once storage fills, **the network stops delivering new messages.** The system would appear entirely
healthy and simply never receive another reply.

Mitigations, both required:

1. `AT+CPMS="ME","ME","ME"` — prefer module flash over the SIM card (larger)
2. `AT+CMGD=<index>` after every successful read
3. Query `AT+CPMS?` periodically and **raise an alert as it approaches capacity**

---

## 7. Delivery status reports

`AT+CNMI`'s `<ds>` parameter set to `1` routes SMS status reports to us as `+CDS:`, matched against
the `+CMGS: <mr>` reference from the send.

This recovers the "Sent / Delivered" progress detail, so the modem path need not be less informative
than an HTTP-based one.

---

## 8. Diagnostic command set

Waveshare's own network-troubleshooting FAQ is effectively a ready-made health check. This is the
basis of our pre-check script:

| Command | Confirms | Good response |
|---|---|---|
| `AT` | Module responding | `OK` |
| `AT+SIMCOMATI` | Module information | identity block |
| `AT+CGMI` / `AT+CGMM` | Manufacturer, model | `SIMCOM`, `SIM7600G-H` |
| `AT+CGSN` | IMEI — our stable device identity | 15 digits |
| `AT+CGMR` | Firmware version | version string |
| `AT+CPIN?` | **SIM present and unlocked** | `+CPIN: READY` |
| `AT+CFUN?` | **RF enabled — not in flight mode** | `+CFUN: 1` |
| `AT+CSQ` | **Signal quality** | `+CSQ: 17,99` — 99 means no signal |
| `AT+COPS?` | Operator attached | operator name |
| `AT+CREG?` / `AT+CGREG?` | **Registered on network** | `,1` (home) or `,5` (roaming) |
| `AT+CPSI?` | Full connection status | system info |
| `AT+CNMP?` | Network mode | `2` (automatic) |
| `AT+CSCA?` | **SMS centre set** | a real number, not blank |
| `AT+CPMS?` | Storage used vs capacity | `+CPMS: 0,40,...` |
| `AT+CMGF=1` | Text mode supported | `OK` |

---

## 9. Known failure modes

| Symptom | Cause and fix |
|---|---|
| `AT+CPIN?` returns `ERROR` | **Poor contact between SIM and socket.** Reseat the card |
| `+CMS ERROR` / `+CME ERROR` on send | Not registered; wrong/blank SMS centre; missing `AT+CSCS="IRA"` + `AT+CSMP=17,167,0,0` |
| NET LED not blinking, no network | MAIN antenna not connected; SIM not active; try the SIM in a phone first |
| Registered but nothing works | Check flight mode with `AT+CFUN?` |
| Replies stop arriving after weeks | **Storage full** — see §6 |
| Every reply parses as `unknown` | Character set wrong — body arriving as UCS2 hex. See §3 |
| Commands echo back / parsing confused | Echo left on. Send `ATE0` |

---

## 10. What this changes in our code

Against [sms-worker/src/transports/serialModem.ts](../sms-worker/src/transports/serialModem.ts) as it
stands today:

1. **`init()` is incomplete.** It sends only `ATE0` and `AT+CMGF=1`. It must also send `AT+CSCS="IRA"`,
   `AT+CSMP=17,167,0,0`, `AT+CPMS="ME","ME","ME"` and `AT+CNMI=2,1`. Without the character-set line,
   reply parsing can fail silently on every command.
2. **Replace 15-second polling with `+CMTI` handling.** Receiving is push-based; the current
   `pollMessages()` loop adds latency and collides with sends. Keep the sweep as a safety net.
3. **Delete after read.** `AT+CMGD` after each successful read, or the system stops receiving after
   ~40–50 messages.
4. **Recognise both PIDs** — `9001` and `9011` — in the device registry.
5. **Keep `+CMGS: <mr>`** so delivery status reports can be matched later.
6. **Do not force LTE.** Leave `AT+CNMP` on automatic.
7. **Verify `AT+CSCA?` at startup** and refuse to promote the modem if the SMS centre is blank.
