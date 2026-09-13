"use client";

/*
 * SMS device card — what the office modem is doing, and what to do about it.
 *
 * This exists for one situation: something is wrong on a machine nobody can
 * SSH into, and the person standing next to it is not an engineer. Every
 * failure state the worker can report has a sentence here and, where one
 * exists, a button. "No modem found" while the thing is plugged in is the
 * message this card was built to make impossible.
 *
 * It reads /health, /ports and /hardware, and can trigger /rescan and
 * /test-sms. None of those probe the serial line on their own — /health is a
 * cached snapshot and /ports is enumeration only — so leaving this page open
 * costs the modem nothing. Rescan and Test SMS are the two that do real
 * work, and both are explicit button presses.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card } from "@/components/ui";
import { IconRadio, IconSend, IconSpinner } from "@/components/icons";
import {
  fetchHardware,
  fetchPorts,
  fetchWorkerHealth,
  runTestSms,
  triggerRescan,
  type ModemSnapshot,
  type ModemState,
  type PortInfo,
  type UndrivenDevice,
} from "@/lib/workerStatus";

/** Colour per state. Only "ready" is good — see the Topbar chip for the same rule. */
const STATE_TONE: Record<ModemState, string> = {
  ready: "text-good",
  degraded: "text-warn",
  not_ready: "text-critical",
  port_only: "text-critical",
  undriven: "text-critical",
  absent: "text-critical",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-1.5 last:border-0">
      <span className="text-xs text-ink-3">{label}</span>
      <span className="text-xs font-medium text-ink-2" dir="ltr">
        {value}
      </span>
    </div>
  );
}

export function SmsDeviceCard({ workerUrl }: { workerUrl: string | null }) {
  const { t } = useTranslation();

  const [modem, setModem] = useState<ModemSnapshot | null>(null);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [undriven, setUndriven] = useState<UndrivenDevice[]>([]);
  const [reachable, setReachable] = useState(true);
  const [busy, setBusy] = useState<"rescan" | "test" | null>(null);
  const [testNumber, setTestNumber] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!workerUrl) return;
    const health = await fetchWorkerHealth(workerUrl);
    // Null means the WORKER is unreachable, which is a different problem from
    // the modem being absent, and needs a different sentence.
    setReachable(health !== null);
    const [p, h] = await Promise.all([fetchPorts(workerUrl), fetchHardware(workerUrl)]);
    setPorts(p?.ports ?? []);
    setUndriven(h?.undriven ?? []);
    setModem(h?.modem ?? null);
  }, [workerUrl]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!workerUrl) {
    return (
      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <IconRadio size={16} className="text-ink-3" />
          <h2 className="text-sm font-semibold text-ink">{t("device.section")}</h2>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">{t("device.noWorkerUrl")}</p>
      </Card>
    );
  }

  const onRescan = async () => {
    setBusy("rescan");
    setTestResult(null);
    const snapshot = await triggerRescan(workerUrl);
    if (snapshot) setModem(snapshot);
    await refresh();
    setBusy(null);
  };

  const onTest = async () => {
    if (!testNumber.trim()) return;
    setBusy("test");
    setTestResult(null);
    const result = await runTestSms(workerUrl, testNumber.trim());
    setTestResult({
      ok: result.ok,
      message: result.ok
        ? t("device.testSent", { ref: result.providerId ?? "?" })
        : result.error ?? t("device.testFailed"),
    });
    setBusy(null);
  };

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <IconRadio size={16} className={modem ? STATE_TONE[modem.state] : "text-ink-3"} />
        <h2 className="text-sm font-semibold text-ink">{t("device.section")}</h2>
      </div>

      {/* The headline: state and, always, why. */}
      {!reachable ? (
        <p className="mt-1 text-xs leading-relaxed text-critical">
          {t("device.workerOffline", { url: workerUrl })}
        </p>
      ) : modem ? (
        <p className={`mt-1 text-xs font-medium ${STATE_TONE[modem.state]}`}>
          {t(`device.state.${modem.state}`)}
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-3">{t("device.loading")}</p>
      )}
      {reachable && modem && (
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">{modem.reason}</p>
      )}

      {/* Plugged in, but Windows cannot use it. A modem with no driver creates
          no COM port at all, so it is invisible to the port list — this is the
          only place it can possibly be reported. */}
      {undriven.length > 0 && (
        <div className="mb-4 rounded-lg border border-critical/30 bg-critical/5 p-3">
          <p className="text-xs font-semibold text-critical">{t("device.driverMissing")}</p>
          <ul className="mt-1 space-y-1">
            {undriven.map((d) => (
              <li key={d.instanceId} className="text-xs leading-relaxed text-ink-2">
                {d.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {modem && modem.state !== "absent" && (
        <div className="mb-4">
          <Row label={t("device.model")} value={modem.model ?? "—"} />
          <Row label={t("device.comPort")} value={modem.comPort ?? "—"} />
          <Row label={t("device.imei")} value={modem.imei ?? "—"} />
          <Row label={t("device.sim")} value={modem.sim ? t(`device.sim_${modem.sim}`) : "—"} />
          <Row
            label={t("device.signal")}
            value={
              modem.signal === null
                ? t("device.noSignal")
                : `${modem.signal}/31 (${-113 + 2 * modem.signal} dBm)`
            }
          />
          <Row
            label={t("device.registration")}
            value={modem.registration ? t(`device.reg_${modem.registration}`) : "—"}
          />
          <Row label={t("device.smsc")} value={modem.smsc ?? "—"} />
          <Row
            label={t("device.storage")}
            value={
              modem.storage
                ? t("device.storageValue", {
                    used: modem.storage.used,
                    total: modem.storage.total,
                  })
                : "—"
            }
          />
        </div>
      )}

      {/* Every serial port, so "it found nothing" can be checked rather than
          taken on faith. */}
      {ports.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-semibold text-ink-2">{t("device.portsHeading")}</p>
          <ul className="space-y-1">
            {ports.map((p) => (
              <li key={p.comPort} className="text-xs leading-relaxed">
                <span className="font-medium text-ink-2" dir="ltr">
                  {p.comPort}
                </span>
                <span className="text-ink-3"> · {p.label}</span>
                {p.active && <span className="ms-1.5 font-medium text-good">{t("device.portActive")}</span>}
                {p.skipped && <span className="ms-1.5 text-ink-3">{t("device.portSkipped")}</span>}
                {p.reason && !p.active && <div className="text-ink-3">{p.reason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Button variant="ghost" onClick={onRescan} disabled={busy !== null}>
          {busy === "rescan" ? <IconSpinner size={14} /> : null}
          {t("device.rescan")}
        </Button>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-3">{t("device.testLabel")}</span>
            <input
              value={testNumber}
              onChange={(e) => setTestNumber(e.target.value)}
              placeholder="+974..."
              dir="ltr"
              className="w-40 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand"
            />
          </label>
          <Button
            variant="ghost"
            onClick={onTest}
            disabled={busy !== null || !testNumber.trim() || modem?.state === "absent"}
          >
            {busy === "test" ? <IconSpinner size={14} /> : <IconSend size={14} />}
            {t("device.testSend")}
          </Button>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink-3">{t("device.testHint")}</p>

      {testResult && (
        <p
          className={`mt-2 text-xs leading-relaxed ${testResult.ok ? "text-good" : "text-critical"}`}
        >
          {testResult.message}
        </p>
      )}

      {modem && (
        <p className="mt-3 text-[11px] text-ink-3">
          {t("device.checkedAt", { time: new Date(modem.checkedAt).toLocaleTimeString() })}
        </p>
      )}
    </Card>
  );
}
