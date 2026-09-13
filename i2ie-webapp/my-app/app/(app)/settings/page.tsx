"use client";

/*
 * Settings — the ONE config surface (admin only).
 *
 * These values mirror the physical TRB141 configuration and the queue's
 * pacing rules. Changing a keyword here without changing the device rules
 * (or vice versa) breaks the contract — which is exactly why they live in
 * one visible place instead of scattered constants.
 *
 * The queue-tuning values are LIVE: the simulated engine reads them on
 * every send, so raising "gap between sends" visibly slows the queue.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { AdminOnly } from "@/components/AdminOnly";
import { Button, Card, Field } from "@/components/ui";
import { IconRadio, IconTrash } from "@/components/icons";

export default function SettingsPage() {
  return (
    <AdminOnly>
      <SettingsScreen />
    </AdminOnly>
  );
}

function SettingsScreen() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function resetPortfolio() {
    if (!confirm(t("settings.resetConfirm"))) return;
    setResetting(true);
    try {
      await api.system.resetPortfolio();
      window.location.reload();
    } finally {
      setResetting(false);
    }
  }

  useEffect(() => {
    void api.settings.get().then(setSettings);
  }, []);

  if (!settings) return null;

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    await api.settings.update(settings);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 3000);
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-4">
      {saved && (
        <div className="rounded-lg border border-good/40 bg-good/10 px-4 py-2.5 text-sm text-good-text">
          {t("settings.saved")}
        </div>
      )}

      {/* SMS keywords */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">{t("settings.smsSection")}</h2>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">
          {t("settings.smsHint")}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t("settings.keywordOpen")}
            value={settings.keywordOpen}
            onChange={(e) => patch("keywordOpen", e.target.value)}
            dir="ltr"
            required
          />
          <Field
            label={t("settings.keywordClose")}
            value={settings.keywordClose}
            onChange={(e) => patch("keywordClose", e.target.value)}
            dir="ltr"
            required
          />
          <Field
            label={t("settings.keywordStatus")}
            value={settings.keywordStatus}
            onChange={(e) => patch("keywordStatus", e.target.value)}
            dir="ltr"
            required
          />
        </div>
      </Card>

      {/* Reply parsing */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">{t("settings.replySection")}</h2>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">
          {t("settings.replyHint")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("settings.replyOn")}
            value={settings.replyOnToken}
            onChange={(e) => patch("replyOnToken", e.target.value)}
            dir="ltr"
            required
          />
          <Field
            label={t("settings.replyOff")}
            value={settings.replyOffToken}
            onChange={(e) => patch("replyOffToken", e.target.value)}
            dir="ltr"
            required
          />
        </div>
      </Card>

      {/* Queue tuning — live values the engine reads on every send */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">{t("settings.queueSection")}</h2>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">
          {t("settings.queueHint")}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t("settings.sendGap")}
            type="number"
            min={500}
            step={100}
            value={settings.sendGapMs}
            onChange={(e) => patch("sendGapMs", Number(e.target.value))}
            dir="ltr"
            required
          />
          <Field
            label={t("settings.maxRetries")}
            type="number"
            min={0}
            max={5}
            value={settings.maxRetries}
            onChange={(e) => patch("maxRetries", Number(e.target.value))}
            dir="ltr"
            required
          />
          <Field
            label={t("settings.replyTimeout")}
            type="number"
            min={1000}
            step={500}
            value={settings.replyTimeoutMs}
            onChange={(e) => patch("replyTimeoutMs", Number(e.target.value))}
            dir="ltr"
            required
          />
        </div>
      </Card>

      {/* Optional confirmation — client review item: halve SMS volume by
          trusting the actuation instead of always double-checking it. */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">{t("settings.confirmSection")}</h2>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">
          {t("settings.confirmHint")}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={settings.confirmAfterCommand}
            onChange={(e) => patch("confirmAfterCommand", e.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          {t("settings.confirmToggle")}
        </label>
      </Card>

      {/* Local worker bridge — bypasses Supabase for bench testing today */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">{t("settings.workerSection")}</h2>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">
          {t("settings.workerHint")}
        </p>
        <div className="max-w-sm">
          <Field
            label={t("settings.workerUrl")}
            value={settings.workerUrl ?? ""}
            onChange={(e) => patch("workerUrl", e.target.value || null)}
            placeholder={t("settings.workerUrlPlaceholder")}
            dir="ltr"
          />
        </div>
      </Card>

      {/* Office SMS modem. Auto-detected unless a port is pinned here. */}
      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <IconRadio size={16} className="text-brand" />
          <h2 className="text-sm font-semibold text-ink">{t("settings.transportSection")}</h2>
        </div>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">
          {t("settings.transportHint")}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("settings.comPort")}
            value={settings.comPort ?? ""}
            onChange={(e) => patch("comPort", e.target.value || null)}
            placeholder={t("settings.comPortPlaceholder")}
            dir="ltr"
          />
        </div>
      </Card>

      <Button type="submit">{t("settings.save")}</Button>

      {/* Danger zone — outside the save form on purpose, its own action */}
      <Card className="border-critical/30 p-5">
        <div className="mb-1 flex items-center gap-2">
          <IconTrash size={16} className="text-critical" />
          <h2 className="text-sm font-semibold text-ink">{t("settings.dangerZone")}</h2>
        </div>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">
          {t("settings.resetHint")}
        </p>
        <Button
          type="button"
          variant="danger"
          disabled={resetting}
          onClick={resetPortfolio}
        >
          <IconTrash size={14} />
          {resetting ? t("settings.resetting") : t("settings.resetAllData")}
        </Button>
      </Card>
    </form>
  );
}
