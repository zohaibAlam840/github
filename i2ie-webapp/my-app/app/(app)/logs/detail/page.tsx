"use client";

/*
 * One command, in full — and the place to send it again.
 *
 * The Logs table can show a failure and its reason, but it cannot show the
 * whole trail without turning every row into an essay, and it has nowhere
 * to put an action. So a failed command used to be a dead end: you could
 * read that it failed and then had to go and find the valve by hand to try
 * it again.
 *
 * Retry here is deliberately a NEW command, not a resurrection of the old
 * one. The original row keeps its own outcome forever — rewriting history
 * so a failure becomes a success would destroy the audit trail this whole
 * system exists to keep. The two are linked by being on the same valve, in
 * order, which is what an operator actually reads.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { onAppEvent } from "@/lib/socket";
import type { CommandLog } from "@/lib/types";
import { Button, Card, StatusChip } from "@/components/ui";
import {
  BuildingLink,
  GatewayLink,
  ValveLink,
} from "@/components/filters/RecordLinks";
import { IconAlert, IconSend, IconSpinner, IconX } from "@/components/icons";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-3">{label}</div>
      <div className="text-sm text-ink-2">{children}</div>
    </div>
  );
}

function CommandDetail() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const id = Number(params.get("id"));

  const [command, setCommand] = useState<CommandLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    try {
      setCommand(await api.commands.get(id));
    } catch {
      setCommand(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep this page live: a command opened while still pending should finish
  // in front of you rather than needing a refresh.
  useEffect(() => {
    return onAppEvent("command:update", ({ command: updated }) => {
      if (updated.id === id) void load();
    });
  }, [id, load]);

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(i18n.language === "ar" ? "ar-QA" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "medium",
        })
      : "—";

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-10 text-sm text-ink-3">
        <IconSpinner size={14} />
        {t("logs.loading")}
      </Card>
    );
  }

  if (!command) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm text-ink-2">{t("logs.notFound")}</p>
        <Link href="/logs" className="mt-2 inline-block text-xs text-brand hover:underline">
          {t("logs.backToLogs")}
        </Link>
      </Card>
    );
  }

  const settled = command.status !== "pending" && command.status !== "sent";
  /*
   * Retry needs a valve to send to. A command whose valve has since been
   * deleted is still readable history, but there is nothing left to
   * address, so the button is withheld rather than offered and then
   * failing.
   */
  const canRetry =
    settled && command.valveId !== null && user?.role !== "viewer";

  async function retry() {
    if (!command || command.valveId === null) return;
    setBusy(true);
    setNotice(null);
    try {
      const fresh = await api.valves.queueCommand(command.valveId, command.action);
      // Follow the new command, not the old one — otherwise pressing Retry
      // leaves you staring at the failure you were trying to get past.
      router.push(`/logs/detail?id=${fresh.id}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!command) return;
    setBusy(true);
    try {
      await api.commands.cancel(command.id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/logs" className="inline-block text-xs text-brand hover:underline">
        ← {t("logs.backToLogs")}
      </Link>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-ink">
              {t(`action.${command.action}`)} — {command.valveCode}
            </h1>
            <p className="mt-0.5 text-xs text-ink-3">{fmt(command.createdAt)}</p>
          </div>
          <StatusChip status={command.status} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("queue.building")}>
            <BuildingLink buildingId={command.buildingId} buildingName={command.buildingName} />
          </Field>
          <Field label={t("logs.unit")}>{command.unitName}</Field>
          <Field label={t("queue.valve")}>
            <ValveLink
              valveId={command.valveId}
              unitId={command.unitId}
              buildingId={command.buildingId}
              valveCode={command.valveCode}
            />
          </Field>
          <Field label={t("nav.gateways")}>
            <GatewayLink gatewayId={command.gatewayId} gatewayLabel={command.gatewayLabel} />
          </Field>
          <Field label={t("gateways.sim")}>
            <span className="font-mono text-xs" dir="ltr">
              {command.simNumber}
            </span>
          </Field>
          <Field label={t("logs.retries")}>{command.retries}</Field>
          <Field label={t("queue.sms")}>
            <span className="font-mono text-xs">{command.commandText}</span>
          </Field>
          <Field label={t("queue.reply")}>
            <span className="font-mono text-xs">{command.replyText ?? "—"}</span>
          </Field>
          <Field label={t("logs.user")}>{command.userName}</Field>
          <Field label={t("common.lastSent")}>{fmt(command.sentAt)}</Field>
        </div>
      </Card>

      {/* The trail, in full — this is the page that has room for it. */}
      {command.events && command.events.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("logs.trail")}</h2>
          <ol className="space-y-1.5">
            {command.events.map((evt, i) => (
              <li key={i} className="flex gap-3 text-xs text-ink-2">
                <span className="shrink-0 tabular-nums text-ink-3">
                  {new Date(evt.ts).toLocaleTimeString(
                    i18n.language === "ar" ? "ar-QA" : "en-GB",
                    { hour: "2-digit", minute: "2-digit", second: "2-digit" }
                  )}
                </span>
                <span>{evt.message}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink">{t("logs.retryTitle")}</h2>
        <p className="mb-3 text-xs leading-relaxed text-ink-3">{t("logs.retryHint")}</p>

        <div className="flex flex-wrap items-center gap-2">
          {canRetry && (
            <Button disabled={busy} onClick={retry}>
              {busy ? <IconSpinner size={14} /> : <IconSend size={14} />}
              {t("logs.retryAction", { action: t(`action.${command.action}`) })}
            </Button>
          )}
          {!settled && (
            <Button variant="ghost" disabled={busy} onClick={stop}>
              {busy ? <IconSpinner size={14} /> : <IconX size={14} />}
              {t("action.stop")}
            </Button>
          )}
          {command.valveId === null && (
            <span className="flex items-center gap-1.5 text-xs text-ink-3">
              <IconAlert size={13} className="text-warn" />
              {t("logs.valveGone")}
            </span>
          )}
        </div>

        {notice && <p className="mt-2 text-xs text-critical">{notice}</p>}
      </Card>
    </div>
  );
}

export default function CommandDetailPage() {
  return (
    <Suspense fallback={null}>
      <CommandDetail />
    </Suspense>
  );
}
