# Client Message — Office SMS Solution Recommendation

*Draft for sending to i2i. Adjust the greeting and sign-off as needed.*

---

**Subject: Control office SMS setup — our recommendation**

Dear [Name],

Following our work on the Control Management System, we'd like to set out our recommendation for how
the control office sends and receives messages to the valve gateways, and why we've arrived at it.

## The recommendation

We recommend a **dedicated mobile SMS gateway** at the control office: a mobile handset, kept purely
for this purpose, connected to your office network and holding a standard Qatari SIM card.

The control software communicates with it directly over your local network. When an operator opens or
closes a valve, the system sends the instruction to this device, which transmits it over the mobile
network to the gateway at the valve. When that gateway confirms the valve has switched, its reply
comes straight back and updates the dashboard automatically.

## Why we recommend it

**1. It is already proven, end to end.**

This is the most important point. We have tested this configuration against your real Teltonika
TRB141 hardware — real messages sent, the relay physically switching, and the confirmation reply
received and correctly interpreted by the dashboard. It is not a design proposal; it is a working
system we have already run.

It also gives us **delivery tracking**: we can see whether each message was accepted, sent, and
delivered by the network, which is valuable when diagnosing a gateway that isn't responding.

**2. It works completely offline, as required.**

No internet connection is needed at any point. The control software and the gateway device
communicate over your own office network only, and messages travel over the mobile network exactly as
a text message does. Valve control continues to work during an internet outage — which is precisely
when it may be needed most.

**3. It sends and receives — which the system depends on.**

This deserves emphasis, because it rules out most of the low-cost commercial SMS services available.

Those services are designed for marketing: sending announcements to large numbers of customers. They
transmit from a registered brand name rather than a phone number, and **nothing can send a message
back to a brand name**. If the system were built on one of those, commands would still reach the
valves — but the confirmation replies would never arrive. The dashboard could only ever report "the
instruction was sent," never "the valve is confirmed open."

The solution we recommend is a genuine two-way mobile connection, so every valve state shown on the
dashboard is confirmed by the valve itself.

**4. No specialist hardware or software on the office PC.**

The gateway device is reached over the network, so there is nothing to install on the control PC, no
drivers to maintain, and no cabling between the two. If the office PC is ever replaced or upgraded,
the SMS setup is unaffected.

**5. It keeps costs down.**

The device is inexpensive and the running cost is a single standard SIM. There are no per-message
service fees and no subscription to a third-party platform.

## What is required

- A dedicated handset, used only for this purpose and kept permanently connected to power and to the
  office network
- One standard Qatari SIM card with an SMS allowance
- A fixed address on the office network, so the control software always knows where to find it
- Automatic updates and battery-saving features disabled, so the service is never interrupted

We will configure all of this and document it as part of handover.

## Growing later

A single SIM card sends messages one at a time, at roughly five to ten per minute. For day-to-day
operation — opening and closing valves as needed — this is more than sufficient, and a burst of
thirty commands clears within a few minutes.

It becomes relevant only if you need to act on a very large number of valves simultaneously. Should
that be required in future, additional capacity can be added — either further gateway devices, or a
multi-SIM unit that sends across several cards at once. **The system has been built so this can be
added without redesigning anything.**

## An option worth considering: virtual SIM

Ooredoo now offers a **virtual SIM (eSIM)** for business and IoT use. Rather than inserting a
physical card, the mobile subscription is loaded onto the device remotely by QR code and managed from
an Ooredoo business portal.

This would work identically to a physical SIM, with some practical advantages: no card to insert or
lose, plans that can be changed remotely without anyone attending the control room, and central
visibility of message usage and costs across all sites as the deployment grows.

It is entirely optional, and the decision can be made separately at any time. We would simply need
Ooredoo to confirm the plan includes SMS, as some of their IoT plans carry data only.

## Next steps

1. Your confirmation of this approach.
2. A SIM card for the control office — we can advise on the type once you've had a figure from
   Ooredoo.
3. We complete the office setup and run a live test against one of your installed gateways, so you
   can see a real valve open and confirm on the dashboard before wider rollout.

We're happy to walk through any of this in person, or to look at alternative options if you'd prefer
to compare.

Kind regards,

[Name]
