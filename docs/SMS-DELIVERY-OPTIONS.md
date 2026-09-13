# How the Control Office Sends and Receives SMS — Options

**i2i Control Management Solution (CMS)** · Prepared for i2i · Qatar deployment

---

## Why this decision matters

The CMS controls valves that have no internet connection. Every command reaches a valve as an SMS,
and every confirmation comes back as an SMS. The office therefore needs a way to put messages onto
the mobile network — and this document sets out the realistic ways to do that, what each costs, and
what each requires.

This is an open decision. Several of these options work; they differ in cost, resilience, and how
much they can grow.

---

## The one requirement that rules out most of the cheap options

**The system must be able to receive replies, not just send messages.**

This is worth stating plainly because it is easy to miss. When the office tells a valve to open, the
gateway at the valve switches the relay and then **texts back** to report its new state. That reply
is the only proof the valve actually moved. Without it, the dashboard can only say "we sent the
instruction" — never "the valve is open."

Most low-cost commercial SMS services are built for **marketing**: one-way broadcasts to thousands of
customers. They send from a brand name ("i2i") or a shared shortcode, and **nothing can text those
back**. A service like that would appear to work — messages go out, valves switch — while the
confirmation half of the system silently stops functioning.

So every option below is judged first on a single question: **can a valve gateway reply to it?**

A second requirement follows from the project's design: the system is specified to work **without
internet access**. Options that route messages through a web service reintroduce exactly the
dependency the system was built to avoid.

---

## The options

### Option 1 — A cellular modem at the office, with a standard SIM

A small industrial modem connects to the control-room PC. It holds an ordinary Qatari SIM card and
behaves like a phone that only does text messages. The software drives it directly.

Suitable devices include the **SIMCom SIM7600G-H** (compact, global LTE bands, low cost) and the
**Robustel M1000 MP** (industrial-grade, designed for continuous unattended operation).

| | |
|---|---|
| **Can receive replies** | **Yes** — full two-way |
| **Needs internet** | **No** |
| **Cost shape** | One-off hardware (modest) + one normal SIM on a standard SMS plan |
| **Throughput** | ~5–10 messages per minute |
| **Setup** | Install a USB driver on the office PC, insert SIM, attach antenna |

**Strengths.** Purpose-built for exactly this job. Runs unattended for years, no screen to lock, no
battery to age, no operating-system updates to interfere. Fully offline. The cheapest option to run
once installed.

**Limits.** One modem sends one message at a time — see *Throughput and growth* below.

---

### Option 2 — The same modem, using an Ooredoo IoT eSIM ("virtual SIM")

Identical to Option 1, except no plastic SIM card. Ooredoo Qatar launched an **IoT eSIM** service in
January 2026: the carrier profile is downloaded onto the device by QR code and managed remotely from
a business portal.

| | |
|---|---|
| **Can receive replies** | **Yes** — it is a real mobile subscription |
| **Needs internet** | **No**, for day-to-day operation |
| **Cost shape** | Hardware + a managed IoT subscription (business rate, quote required) |
| **Setup** | Requires an eSIM-capable modem — confirm before purchase |

**Strengths.** No physical card to be removed, lost, or inserted incorrectly. Carrier plans can be
changed remotely without anyone visiting the control room. Central visibility of usage across the
estate, which matters as the deployment grows. Supports connectivity across many networks, useful if
i2i expands beyond Qatar.

**Limits.** Not every modem supports eSIM — this must be checked at purchase, as it cannot be added
later. Usually priced as a business contract rather than a consumer tariff, so it needs a quote.
Provisioning is a little more involved than pushing a card into a slot.

---

### Option 3 — The same modem, using an Ooredoo M2M SIM

A middle path: a physical SIM, but one issued on Ooredoo's machine-to-machine business service rather
than a consumer tariff.

| | |
|---|---|
| **Can receive replies** | **Yes** |
| **Needs internet** | **No** |
| **Cost shape** | Hardware + M2M business subscription |

**Strengths.** Intended for equipment rather than people — no unexpected marketing messages, no
mid-contract tariff changes, and business-grade support if the connection misbehaves. Simpler to
obtain than eSIM and works in any modem.

**Limits.** Still a physical card, so replacing it means visiting the control room.

---

### Option 4 — A mobile handset acting as the office SMS gateway

An ordinary Android phone on the office network, running software that lets the CMS send messages
through it and forwards incoming replies back to the system.

| | |
|---|---|
| **Can receive replies** | **Yes** |
| **Needs internet** | **No** — office network only |
| **Cost shape** | A spare handset + a normal SIM |
| **Setup** | Fast — no drivers, no wiring |

**Strengths.** The quickest option to stand up, and useful as a **backup**: if the primary modem
fails, a handset can keep the system running until it is replaced. Anyone can see at a glance that it
is working.

**Limits as a permanent primary.** A phone is designed to be used by a person, not to run untouched
for years. It must stay powered, awake, connected, and unlocked; operating-system updates can
interrupt it; battery health declines with permanent charging; and it is small enough to be borrowed.
For a system the client depends on daily, a modem is the more appropriate long-term choice.

---

### Option 5 — A multi-SIM SMS gateway appliance

A rack- or wall-mounted unit holding several SIM cards at once (commonly 4, 8, 16 or 32), sending
across all of them in parallel. Made by vendors such as Yeastar, Portech and GoIP.

| | |
|---|---|
| **Can receive replies** | **Yes** |
| **Needs internet** | **No** — connects over the office network |
| **Cost shape** | Higher one-off hardware + one SIM per channel |
| **Throughput** | Multiplies with channel count |

**Strengths.** The clean answer to volume. An 8-channel unit does roughly eight times the work of a
single modem, and all SIMs are managed in one place.

**Limits.** More expensive up front, and only worth it once message volume genuinely demands it.

---

### Option 6 — Ooredoo Aamali Bulk SMS (A2P)

Ooredoo's commercial bulk messaging service for businesses, sold in packs or pay-as-you-use, with
sender IDs registered with Qatar's Communications Regulatory Authority (CRA).

| | |
|---|---|
| **Can receive replies** | **Usually not** — see below |
| **Needs internet** | **Yes** |
| **Cost shape** | Lowest per message at volume |

**The problem.** This service is built for sending announcements to customers. Messages typically go
out under a registered **sender name** rather than a phone number, and a valve gateway cannot text a
name back. Adopting this without a **two-way, long-number** arrangement would break the confirmation
half of the system.

It also requires internet access at the office, and CRA registration of sender IDs adds
administrative lead time.

**Worth asking Ooredoo one specific question:** whether a *two-way A2P long number* is available on
the account. If it is, this becomes viable at high volume. If it is not, it is unsuitable regardless
of price.

---

### Option 7 — An internet SMS service (Twilio, Vonage, or a local aggregator)

A web service that sends and receives messages through an internet connection.

| | |
|---|---|
| **Can receive replies** | Sometimes — only on a dedicated two-way number |
| **Needs internet** | **Yes — continuously** |
| **Cost shape** | Per message, typically higher than a local SIM in-country |

**The problem.** The CMS was specified to run without internet precisely so that valve control keeps
working when connectivity does not. Routing every command through a web service means an office
internet outage stops all valve operations — including during exactly the kind of incident when the
valves most need to be closed. Messages would also originate from outside Qatar unless a local number
is provisioned, which raises both cost and delivery risk.

**Assessment:** not appropriate as the primary channel for this system.

---

## Side-by-side

| Option | Receives replies | Works offline | Running cost | Suits long-term unattended use |
|---|---|---|---|---|
| **1. Modem + standard SIM** | Yes | Yes | Low | **Yes** |
| **2. Modem + Ooredoo IoT eSIM** | Yes | Yes | Low–medium | **Yes** |
| **3. Modem + Ooredoo M2M SIM** | Yes | Yes | Low–medium | **Yes** |
| **4. Mobile handset gateway** | Yes | Yes | Low | Suitable as backup |
| **5. Multi-SIM appliance** | Yes | Yes | Medium | **Yes** — for volume |
| **6. Ooredoo Aamali Bulk SMS** | Usually **no** | No | Lowest per message | Only with a two-way number |
| **7. Internet SMS service** | Sometimes | **No** | Medium–high | Not recommended here |

---

## Throughput and growth — worth understanding before choosing

A single SIM sends messages **one at a time**, at roughly **5–10 per minute**. That is a property of
the mobile network, not of the software, and it applies to a modem, a handset, and each individual
channel of a multi-SIM appliance alike.

For everyday work this is ample. An operator opening or closing valves as needed will never notice
it, and a burst of thirty commands clears in a few minutes.

It matters in one scenario: **acting on a large number of valves at once.** Every confirmed command
is two messages — the instruction, and the status check that proves it worked. So a thousand valves
is roughly two thousand messages, which on a single SIM is measured in hours.

Three ways to address that, which can be combined:

1. **Add channels.** A multi-SIM appliance (Option 5) divides the time by the number of SIMs.
2. **Turn off confirmation for bulk operations.** The system can send the instruction without the
   verification message, halving the volume. Faster and cheaper, at the cost of the dashboard
   reporting the valve as *sent but not verified* rather than confirmed.
3. **Design around it.** Fleet-wide operations are rare in practice; day-to-day control is
   valve-by-valve, where throughput is a non-issue.

The system is built so that **channels can be added later without redesigning anything.** Starting
with one modem does not close the door on a multi-SIM appliance if volumes grow.

---

## Recommendation

**A dedicated cellular modem at the control office, with an Ooredoo M2M SIM or IoT eSIM (Options 1–3),
with a mobile handset kept as a standby (Option 4).**

The reasoning:

- **It satisfies the requirement most likely to be overlooked.** It receives replies, so valve states
  are genuinely confirmed rather than assumed. The bulk-SMS routes, despite being cheaper per
  message, cannot do this without a specific two-way arrangement.
- **It keeps the system offline, as designed.** Valve control continues through an internet outage.
- **It is built for the job.** An industrial modem is designed to run untouched for years, which is
  what a control-room system requires.
- **A business SIM (M2M or eSIM) rather than a consumer one** gives predictable billing, proper
  support, and — with eSIM — the ability to change carrier plans remotely as the estate grows.
- **Keeping a handset as standby costs almost nothing** and means a modem failure degrades the system
  rather than stopping it.

**Choosing between the SIM types:** the M2M SIM (Option 3) is the simpler starting point. The IoT
eSIM (Option 2) is the better fit if i2i expects to manage many sites centrally or to operate beyond
Qatar — but the modem must be specified as eSIM-capable **at purchase**, since it cannot be added
afterwards.

**If volumes grow**, move to a multi-SIM appliance (Option 5). No change to the rest of the system is
required.

---

## Questions to put to Ooredoo

1. M2M SIM and IoT eSIM business rates, including SMS allowances.
2. Whether the IoT eSIM supports **SMS** specifically — some IoT plans are data-only.
3. Whether a **two-way long number** is available on the Aamali account, which would determine
   whether Option 6 is viable at scale.
4. Whether any inbound or outbound SMS limits apply to business SIMs.

## Decisions needed from i2i

1. Which SIM type to proceed with (standard, M2M, or IoT eSIM).
2. Whether the modem should be specified as **eSIM-capable** at purchase — this is a
   point-of-purchase decision that cannot be reversed later.
3. Whether confirmation should be **on by default** for bulk operations (accurate, twice the
   messages) or **off** (faster and cheaper, reported as unverified).
4. Expected peak volume, so the number of channels can be sized correctly.
