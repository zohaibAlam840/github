/**
 * Sees USB devices that Windows has no driver for.
 *
 * This exists because of one specific, very confusing failure: a modem with
 * no driver installed creates NO COM port at all. It is therefore completely
 * invisible to SerialPort.list(), so the software would report "no modem
 * detected" while the thing is plainly plugged into the machine.
 *
 * Asking Windows directly is the only way to tell those two situations apart,
 * and it turns the least helpful message in the system into an actionable
 * one. This is the state the client's laptop will be in on day one.
 *
 * Non-Windows platforms return nothing; there is no equivalent problem there.
 */

import { execFile } from "node:child_process";

export interface UndrivenDevice {
  instanceId: string;
  /** Ready to show to whoever is standing at the machine. */
  message: string;
}

/** USB vendor IDs of cellular modules, and the driver each one needs. */
const VENDOR_DRIVERS: Record<string, string> = {
  VID_1E0E: "SIMCom (SIM7600 family) — install the SIMCom SIM7500/SIM7600 Windows USB driver, then reboot",
  VID_2C7C: "Quectel — install the Quectel Windows USB driver, then reboot",
  VID_1BC7: "Telit — install the Telit Windows USB driver, then reboot",
  VID_12D1: "Huawei — install the Huawei Mobile Broadband driver, then reboot",
  VID_1546: "u-blox — install the u-blox Windows USB driver, then reboot",
};

/**
 * USB-serial bridge chips. Worth naming separately: the chip IS the cable,
 * not the modem. Its driver only gets you a COM port — what is on the far end
 * stays unknown until something answers AT.
 */
const BRIDGE_DRIVERS: Record<string, string> = {
  VID_10C4: "Silicon Labs CP210x USB-serial adapter — install the CP210x VCP driver",
  VID_1A86: "CH340/CH341 USB-serial adapter — install the WCH CH341SER driver",
  VID_0403: "FTDI USB-serial adapter — install the FTDI VCP driver",
  VID_067B: "Prolific PL2303 USB-serial adapter — install the Prolific driver (clone chips often fail on Windows 11)",
};

export function findUndrivenModems(timeoutMs = 15_000): Promise<UndrivenDevice[]> {
  if (process.platform !== "win32") return Promise.resolve([]);

  // PresentOnly = physically attached right now. Status <> OK covers devices
  // with no driver bound, or one that failed to start.
  const script =
    "Get-PnpDevice -PresentOnly | " +
    "Where-Object { $_.InstanceId -match 'USB' -and $_.Status -ne 'OK' } | " +
    "Select-Object -ExpandProperty InstanceId";

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        const found: UndrivenDevice[] = [];
        for (const raw of stdout.split(/\r?\n/)) {
          const instanceId = raw.trim();
          if (!instanceId) continue;
          const upper = instanceId.toUpperCase();

          const vendor = Object.keys(VENDOR_DRIVERS).find((v) => upper.includes(v));
          if (vendor) {
            found.push({
              instanceId,
              message: `A modem is plugged in but Windows has no driver for it: ${VENDOR_DRIVERS[vendor]}.`,
            });
            continue;
          }

          const bridge = Object.keys(BRIDGE_DRIVERS).find((v) => upper.includes(v));
          if (bridge) {
            found.push({
              instanceId,
              message: `${BRIDGE_DRIVERS[bridge]}. Note this is the adapter, not the modem — what is connected to it is unknown until it answers.`,
            });
          }
        }
        resolve(found);
      }
    );
  });
}
