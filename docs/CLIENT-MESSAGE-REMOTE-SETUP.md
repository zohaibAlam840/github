# Client Message — Remote Setup Session

*Draft for sending to i2i. Adjust names, dates and sign-off before sending.*

---

**Subject: Scheduling the control office installation — remote access and preparation**

Dear [Name],

We're ready to install and configure the Control Management System on the control office laptop. The
work is done remotely, and we'd like to arrange a date along with a few preparations that need to be
in place beforehand.

Please allow **one full working day** for the installation. Most of it is unattended configuration on
our side, but the beginning and the end need someone available at the office.

## 1. Remote access

We'll need remote access to the control office laptop for the duration of the day.

**Our recommendation is Chrome Remote Desktop** (free, from Google), configured for **unattended
access**. Setup takes about five minutes and we can talk your IT person through it.

The reason unattended access matters: installing the modem driver requires **restarting the laptop
several times**. With a standard remote session, the connection drops at every restart and someone
has to be physically present to re-approve it each time. With unattended access configured once at
the start, the machine reconnects by itself and the work proceeds without interruption.

**AnyDesk** with an unattended access password works equally well if your IT team prefers it.

One note: we'd suggest avoiding the free version of **TeamViewer** for this. It detects extended
sessions as commercial use and can cut the connection mid-task, which would cost us significant time.

Please also confirm whether your IT policy requires any approval for remote access software, as that
can take a few days to arrange.

## 2. Administrator access

We'll need an account on the laptop with **local administrator rights**. This is required to install
the modem driver, register the system to start automatically, and allow it through the Windows
firewall so other office computers can reach the dashboard.

If your IT team prefers to keep administrator credentials private, an alternative is to have someone
from IT available on a call for the few moments those permissions are needed.

## 3. Hardware to have ready before we start

Please make sure the following are in place at the control office:

- **The SIM7600G-H modem**, with its USB cable
- **The antenna fitted to the modem.** This is easy to overlook, and without it the modem will not
  register on the network properly — it is not optional
- **A SIM card inserted in the modem**, with SMS enabled on the plan
- **The laptop connected to mains power** and to the office network
- **At least one valve gateway (TRB141) powered on and installed**, so we can run a genuine test at
  the end of the day
- Please confirm the **phone number of that gateway**, and whether its SMS rules use a password

## 4. Someone available at the office

We'll need a person on site for roughly **thirty minutes at the start** to connect the modem, insert
the SIM card and confirm the antenna is attached — none of which can be done remotely.

After that we can work independently, but it helps if that person stays **reachable by phone** during
the day in case anything needs physically checking or reconnecting.

We'd also like them present for the **final thirty minutes**, when we run a live test: opening and
closing a real valve from the dashboard, so you can see the system working before we hand over.

## 5. Internet on the laptop

The laptop will need an internet connection for the remote session itself.

Worth clarifying, since it can cause confusion: **the valve control system does not use the internet.**
It communicates with the valves over the mobile network, and continues working during an internet
outage. The internet connection is only required so that we can reach the machine to perform the
installation.

## 6. A short check beforehand — recommended

Before committing to the full day, we'd suggest a **brief session of around thirty minutes**, a few
days in advance.

In that session we would simply confirm the laptop can see the modem and that the SIM card is active
and registered on the network. It's a small step, but if something is missing — a driver problem, an
inactive SIM, a missing antenna — it's far better to discover it in advance than to lose a day of the
installation to it.

All that's needed for this short session is remote access and the modem connected.

## Proposed schedule

| | |
|---|---|
| **Pre-check session** | [date], approx. 30 minutes |
| **Installation day** | [date], full working day |
| **Live valve test** | Final 30 minutes of the installation day, with your team present |

Could you confirm the dates that suit you, and let us know once the remote access has been arranged?
We're happy to join a short call with your IT team to help set it up.

Kind regards,

[Name]
