"use client";

/*
 * Modem — the office SMS hardware, on its own screen.
 *
 * This used to be one card buried at the bottom of Settings, which is the
 * wrong place for it: Settings is a form you fill in once, and the modem is
 * the thing you come back to at 2am when commands stop going out. It also
 * meant the first question anyone asks on site — "is the modem even
 * connected?" — could only be answered by an admin scrolling past eight
 * fields of keyword configuration.
 *
 * The page is deliberately self-sufficient. The worker address lives here as
 * well as in Settings, because "no modem shown" and "no worker address set"
 * look identical to someone standing at the PC, and the fix for the second
 * one should not be three screens away.
 *
 * Nothing here touches the serial line on its own — /health is a cached
 * snapshot and /ports is enumeration only — so the page is safe to leave
 * open on a wall display. Rescan and Test SMS are the only two that do real
 * work, and both are explicit button presses.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Settings } from "@/lib/types";
import { Button, Card, Field } from "@/components/ui";
import { SmsDeviceCard } from "@/components/settings/SmsDeviceCard";
import { DEFAULT_WORKER_URL, fetchWorkerHealth, type WorkerHealth } from "@/lib/workerStatus";
import { IconRadio } from "@/components/icons";

export default function ModemPage() {
  const { canOperate, isAdmin, ready } = useAuth();
  const router = useRouter();
  // Viewers have no business spending SMS credit or resetting the port —
  // canOperate is already exactly that rule (admin + operator, not viewer).

  useEffect(() => {
    if (ready && !canOperate) router.replace("/dashboard");
  }, [ready, canOperate, router]);

  if (!ready || !canOperate) return null;
  return <ModemScreen canEditWorkerUrl={isAdmin} />;
}

function ModemScreen({ canEditWorkerUrl }: { canEditWorkerUrl: boolean }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draftUrl, setDraftUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<WorkerHealth | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    void api.settings.get().then((s) => {
      setSettings(s);
      /*
       * Prefill rather than leave the box empty.
       *
       * An empty input showing a grey placeholder of the very address you
       * need is indistinguishable from a saved value — someone reads
       * "http://localhost:3900", concludes it is configured, and cannot work
       * out why every command still resolves in demo mode. Putting the real
       * default IN the field makes Save a single click and removes the
       * ambiguity entirely.
       */
      setDraftUrl(s.workerUrl ?? DEFAULT_WORKER_URL);
    });
  }, []);

  // Whether the saved address actually answers — the question the placeholder
  // could never answer. Null while unknown.
  useEffect(() => {
    if (!settings?.workerUrl) {
      setReachable(null);
      return;
    }
    let cancelled = false;
    const check = async () => {
      const h = await fetchWorkerHealth(settings.workerUrl!);
      if (cancelled) return;
      setHealth(h);
      setReachable(h !== null);
    };
    void check();
    const timer = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [settings?.workerUrl]);

  if (!settings) return null;

  async function saveWorkerUrl(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const url = draftUrl.trim() || null;
      const updated = await api.settings.update({ workerUrl: url });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <IconRadio size={16} className="text-ink-3" />
          <h2 className="text-sm font-semibold text-ink">{t("modem.workerSection")}</h2>
        </div>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">{t("modem.workerHint")}</p>

        {canEditWorkerUrl ? (
          <form onSubmit={saveWorkerUrl} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Field
                label={t("settings.workerUrl")}
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder={t("settings.workerUrlPlaceholder")}
                dir="ltr"
              />
            </div>
            <Button type="submit" disabled={saving}>
              {t("modem.workerSave")}
            </Button>
            {saved && <span className="pb-2 text-xs text-good">{t("settings.saved")}</span>}
          </form>
        ) : (
          <p className="text-xs font-medium text-ink-2" dir="ltr">
            {settings.workerUrl ?? t("modem.workerUnset")}
          </p>
        )}

        {/* The line that answers "why is it still saying demo". */}
        <p
          className={`mt-3 text-xs font-medium ${
            !settings.workerUrl
              ? "text-critical"
              : reachable === false
                ? "text-warn"
                : reachable
                  ? "text-good"
                  : "text-ink-3"
          }`}
        >
          {!settings.workerUrl
            ? t("modem.notSaved")
            : reachable === false
              ? t("modem.savedUnreachable", { url: settings.workerUrl })
              : reachable
                ? t("modem.connected", { url: settings.workerUrl })
                : t("modem.checking")}
        </p>
      </Card>

      {/*
        The exact text that will be sent.
        
        A stale settings row silently kept old keywords ("status" instead of
        "iostatus") and every command went out wrong — the TRB matched no
        rule and simply never replied, which looks identical to a dead
        gateway. Nothing in the UI showed the keyword until you opened a
        command modal after the fact. Now it is stated up front, next to the
        worker's own copy, so a disagreement is visible before it costs an SMS.
      */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">{t("modem.keywordsSection")}</h2>
        <p className="mb-3 mt-1 text-xs leading-relaxed text-ink-3">{t("modem.keywordsHint")}</p>
        <div className="space-y-1">
          {([
            ["action.on", settings.keywordOpen, health?.keywordOpen],
            ["action.off", settings.keywordClose, health?.keywordClose],
            ["action.checkStatus", settings.keywordStatus, health?.keywordStatus],
          ] as const).map(([labelKey, mine, theirs]) => (
            <div key={labelKey} className="border-b border-hairline py-1.5 last:border-0">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-xs text-ink-3">{t(labelKey)}</span>
                <span className="font-mono text-xs font-medium text-ink-2" dir="ltr">
                  {mine}
                </span>
              </div>
              {theirs && theirs !== mine && (
                <p className="mt-1 text-xs leading-relaxed text-warn">
                  {t("modem.keywordMismatch", { theirs })}
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">{t("modem.keywordsEdit")}</p>
      </Card>

      <SmsDeviceCard workerUrl={settings.workerUrl} />
    </div>
  );
}
