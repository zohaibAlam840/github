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

  useEffect(() => {
    void api.settings.get().then((s) => {
      setSettings(s);
      setDraftUrl(s.workerUrl ?? "");
    });
  }, []);

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
                placeholder="http://127.0.0.1:8080"
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
      </Card>

      <SmsDeviceCard workerUrl={settings.workerUrl} />
    </div>
  );
}
