# Client Message — Deployment Plan

*Draft for sending to i2i. Adjust names, dates and sign-off before sending.*

---

**Subject: Control office deployment — plan and access arrangements**

Dear [Name],

Below is our plan for installing the Control Management System on the control office laptop. The work
is carried out remotely, in stages, so that each step is confirmed working before we move on to the
next.

We have set it out in full so you can see exactly what will happen, what we need from your side, and
at which points someone needs to be available.

---

## How we will access the laptop

The installation is performed remotely, over a secure remote desktop connection.

**Our recommendation is Chrome Remote Desktop** (provided by Google, free of charge), configured for
**unattended access**. Setup takes around five minutes, and we are happy to guide your IT team
through it on a short call. **AnyDesk** with an unattended access password is equally suitable if
your team prefers it.

**Why unattended access specifically:** installing the modem driver requires restarting the laptop
several times. With a standard remote session, the connection drops at every restart and someone must
be physically present to re-approve it each time. Configured once as unattended, the machine
reconnects automatically and the work continues without interruption.

We would suggest avoiding the free version of TeamViewer, as it interprets long sessions as commercial
use and can disconnect mid-task.

**What we will need:**

- Remote access configured as above
- An account on the laptop with **local administrator rights** — required to install the driver,
  register the system to start automatically, and permit it through the Windows firewall
- An internet connection on the laptop, for the remote session itself

Please let us know if your IT policy requires approval for remote access software, as this can take
several days to arrange.

*One clarification, as it often causes confusion: the valve control system itself does not use the
internet. It communicates with the valves over the mobile network and keeps working during an
internet outage. The internet connection is needed only so that we can reach the machine to carry out
the installation.*

---

## Stage 1 — Preparing the laptop

**Approximately one hour.**

We install the supporting software the system runs on:

- **Node.js** — the runtime environment the control software requires. A standard, freely available
  installation from the official source
- **The SIM7600G-H modem driver** — the manufacturer's Windows driver, required before Windows can
  communicate with the modem at all
- A restart of the laptop, which the driver installation requires

We then confirm Windows has correctly recognised the modem and assigned it a communications port.

**We need from you:** administrator rights, and the modem connected with its antenna fitted and SIM
card inserted.

---

## Stage 2 — Testing the modem

**Approximately thirty minutes.**

Before installing anything further, we run a series of checks directly against the modem to confirm it
is genuinely ready for service. We do this with a purpose-written diagnostic script that reports on
each point in turn:

| Check | What it confirms |
|---|---|
| Modem detected and responding | Windows and the software can communicate with it |
| Module identity | The correct device is connected and reporting properly |
| SIM card present and unlocked | The card is seated correctly and not PIN-locked |
| **Network registration** | The modem is registered with the mobile operator |
| **Signal strength** | The antenna is fitted correctly and reception is adequate |
| Message centre configured | The SIM can actually send messages — a common cause of silent failures |
| Text messaging supported | The modem is ready to send and receive |

This produces a clear pass or fail against each item. If anything is missing — an inactive SIM, a
loose antenna, a driver problem — we identify it here, precisely, rather than discovering it later
when it would be far harder to diagnose.

**We need from you:** nothing during this stage, though it helps if someone is contactable in case the
antenna or SIM needs reseating.

---

## Stage 3 — Testing reach to a valve gateway

**Approximately thirty minutes.**

With the modem confirmed working, we test the connection to the field.

We send a live status request to one of your installed TRB141 gateways and confirm its reply arrives
and is correctly understood by the system. We also measure how long the round trip takes, which tells
us how the system should be tuned for your network.

This is the step that proves the complete chain end to end: control office, mobile network, valve
gateway, and back again.

**We need from you:**

- At least one gateway **powered on and installed**
- Its **phone number**, and confirmation of whether its SMS rules use a password

---

## Stage 4 — Installing the system

**Approximately two to three hours.**

Once the hardware is proven, we install and configure the control software itself:

- The application and its database
- Configuration of the message keywords and passwords, matched to how your gateways are set up
- Registration as a **Windows service that starts automatically**, so the system comes back by itself
  after a power cut or restart, with no manual steps
- A firewall rule permitting other office computers to reach the dashboard over your network
- Creation of the administrator account

We then **restart the laptop deliberately** and confirm everything returns automatically — the system
running, the modem reconnected, the dashboard reachable. This is an important test: it demonstrates
that the system recovers on its own from a power failure.

**We need from you:** administrator rights.

---

## Stage 5 — Live test and handover

**Approximately one hour, with your team present.**

Finally, with your team watching:

- We add your buildings, units and valves to the system, or demonstrate how your administrator does so
- We **open and close a real valve** from the dashboard and confirm it on screen
- We show the dashboard being opened from another computer on your office network
- We hand over administrator credentials, documentation, and guidance on backups
- We walk your administrator through day-to-day operation

**We need from you:** your administrator, and any operators who will use the system.

---

## A short check beforehand — recommended

We would strongly suggest running **Stages 1 and 2 in a separate short session** of around thirty
minutes, a few days before the main installation.

These are the stages that depend on hardware and network conditions outside our control. Confirming
them in advance means that if something needs attention — an inactive SIM, a missing antenna, an IT
permission — there is time to resolve it, rather than losing part of the installation day to it.

All that is needed for this short session is remote access and the modem connected.

---

## Summary

| Stage | Duration | Your involvement |
|---|---|---|
| Remote access setup | 30 min | IT team, one-off |
| **1. Preparing the laptop** | 1 hour | Administrator rights |
| **2. Testing the modem** | 30 min | Contactable |
| **3. Testing reach to a gateway** | 30 min | One gateway powered on |
| **4. Installing the system** | 2–3 hours | Administrator rights |
| **5. Live test and handover** | 1 hour | Administrator and operators |

## What to have ready before the installation day

- The **SIM7600G-H modem** and its USB cable
- **The antenna fitted.** Easily overlooked, and without it the modem will not register on the network
  properly — it is not optional
- **A SIM card inserted**, with SMS enabled on the plan
- The laptop **connected to mains power** and to the office network
- At least one **valve gateway powered on**, with its phone number confirmed
- Remote access and administrator rights arranged

---

Could you confirm the dates that suit you for the short pre-check and for the installation day? We are
glad to join a brief call with your IT team to help arrange the remote access.

Kind regards,

[Name]
