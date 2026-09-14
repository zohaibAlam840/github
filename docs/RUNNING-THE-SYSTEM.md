# Running the i2i Control Management System

The system is two programs that must both be running:

| Part | What it does | Port |
|---|---|---|
| **Dashboard** | The screens — buildings, valves, queue, inbox, settings | **3000** |
| **SMS worker** | Owns the modem on its COM port; sends and receives the SMS | **3900** |

Nobody should have to start those by hand. There is one icon.

---

## First time on a new PC

1. Copy the whole project folder onto the PC (anywhere — the Desktop is fine).
2. Install **Node.js LTS** from <https://nodejs.org> if it is not already there.
3. Double-click **`Install Desktop Icon.cmd`** — once, ever.

That puts **i2i Control System** on the Desktop and in the Start menu.

## Every day

Double-click **i2i Control System**.

A window opens and walks through the startup:

```
  i2i Control Management System
  ---------------------------------------------

  [ok] Node.js v24.4.0
  [ok] Dashboard ready
  Starting the SMS worker...
  Starting the dashboard...
  [ok] SMS worker listening on port 3900
  [ok] Dashboard listening on port 3000

  ---------------------------------------------
   READY

   On this PC:        http://localhost:3000
   On the office LAN: http://192.168.1.24:3000
   SMS worker:        http://localhost:3900
  ---------------------------------------------

  Keep this window open. Closing it stops the system.
```

The browser opens by itself. Any other PC in the office uses the **LAN**
address — that is the one to bookmark and to give to staff.

**Leave the window open.** It is not a log you can dismiss; closing it shuts
both programs down. Minimise it instead.

## Stopping

Close the window, or double-click **`Stop i2i.cmd`**.

`Stop i2i.cmd` is the one to use if the PC was switched off badly, or the
window was killed with Task Manager, and the system then refuses to start
because the ports are still held.

---

## What the launcher handles for you

- **Missing components.** On a fresh copy it runs `npm install` for both
  halves before starting anything.
- **Missing build.** It builds the dashboard if there is no build yet. Use
  `Start i2i.cmd -Rebuild` after a code update to force a fresh one.
- **A previous run still going.** It stops it first, so double-clicking the
  icon twice does not leave two copies fighting over the same ports.
- **Ports already in use.** Both 3000 and 3900 belong to this system, so the
  launcher takes them back: it finds whatever is listening, names it on
  screen, stops it, and starts fresh. This is the common case after a crash
  or after someone ran `npm run worker` by hand — port 3900 in particular
  cannot be worked around, because the worker binds it or exits. Only if
  3000 genuinely will not come free does the dashboard move to 3001, and it
  says so and prints the address it actually used.
- **Waiting for readiness.** It does not open the browser until both servers
  actually answer, so you never land on a connection-error page.

## When something does not start

The launcher says which half failed and where to look.

**"SMS worker did not start."** The dashboard still comes up — deliberately,
because the valve history and the screens are still worth having. But no
SMS can be sent or received. Almost always the modem: check it is plugged
in, then read `.run\logs\worker.log`.

**"The dashboard did not start."** Nothing is started, and the reason is in
`.run\logs\dashboard.log`.

Both logs are rewritten on each run, so what you are reading is always the
current attempt.

---

## Notes for whoever maintains this

- The worker's port is **pinned** at 3900 in `sms-worker/src/config.ts`. It
  binds that port or exits — it never quietly moves — which is what lets the
  dashboard's saved worker URL stay correct forever. If you change it, change
  `$WorkerPort` in `start-i2i.ps1` to match.
- The dashboard is served with `-H 0.0.0.0` so the office LAN can reach it.
  On a locked-down PC, Windows Firewall will prompt on first run; allow it
  on the **private** network.
- `.run\` holds the PID file and the logs. It is
  disposable — deleting it costs nothing.
- The icon is drawn in code by `scripts/install-shortcut.ps1` from the same
  valve mark as `app/icon.svg`, so it survives a fresh checkout and stays in
  step with the app. It is written to `i2i.ico` beside the launcher — not
  into `.run\`, so emptying that folder cannot blank the shortcut.
- **If the Desktop icon ever shows blank**, it is Windows' icon cache, not a
  missing file. Re-run `Install Desktop Icon.cmd`: it deletes the old
  shortcut before writing a new one and rebuilds the cache, which is what
  makes the picture reappear. Signing out and back in also clears it.

## Starting automatically with Windows

If the office wants it up without anyone clicking, put a copy of the
shortcut in the startup folder:

1. Press <kbd>Win</kbd>+<kbd>R</kbd>, type `shell:startup`, press Enter.
2. Copy the **i2i Control System** shortcut from the Desktop into that folder.

It then starts at sign-in. Note it starts at **sign-in**, not at boot — the
PC must be logged in for the system to be running.
