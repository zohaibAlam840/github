"use client";

/*
 * Gateway Inbox — the full sent/received exchange for one TRB141, plus a
 * "send a message" composer for testing a rule/keyword directly, and a
 * read-only reference of the keywords this gateway is expected to answer
 * to. Addressed via ?id= — see buildings/page.tsx for why query params
 * instead of dynamic path segments (static export).
 */

import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  fetchWorkerHealth,
  fetchWorkerInbox,
  sendGatewayAction,
  fetchRawSendStatus,
  type WorkerHealth,
} from "@/lib/workerStatus";
import { numbersMatch } from "@/lib/phone";
import type { Gateway, Settings } from "@/lib/types";
import { Button, Card } from "@/components/ui";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconLock, IconMail, IconRadio, IconSend, IconSpinner } from "@/components/icons";

interface InboxRow {
  id: number | string;
  direction: "sent" | "received";
  text: string;
  ts: string;
}

export default function GatewayInboxPage() {
  return (
    <Suspense fallback={null}>
      <GatewayInboxScreen />
    </Suspense>
  );
}

function GatewayInboxScreen() {
  const { t, i18n } = useTranslation();
  const { canOperate } = useAuth();
  const gatewayId = Number(useSearchParams().get("id"));

  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<WorkerHealth | null>(null);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [inboxLive, setInboxLive] = useState(false);

  const [sendingCommand, setSendingCommand] = useState<{
    action: "on" | "off" | "status";
    output?: 1 | 2;
    display: string;
  } | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const [gateways, s, commands] = await Promise.all([
      api.gateways.list(),
      api.settings.get(),
      api.commands.list(500),
    ]);
    const gw = gateways.find((g) => g.id === gatewayId) ?? null;
    setGateway(gw);
    setSettings(s);
    setHealth(s.workerUrl ? await fetchWorkerHealth(s.workerUrl) : null);
    if (!gw) return;

    const workerInbox = s.workerUrl ? await fetchWorkerInbox(s.workerUrl) : null;
    if (workerInbox) {
      setInbox(
        workerInbox
          .filter((m) => numbersMatch(m.simNumber, gw.simNumber))
          .map((m) => ({ id: m.id, direction: m.direction, text: m.text, ts: m.ts }))
          // getInbox() on the worker is newest-first; a chat reads top-to-
          // bottom chronologically, oldest first, newest at the bottom.
          .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      );
      setInboxLive(true);
    } else {
      const rows: InboxRow[] = [];
      for (const cmd of commands) {
        if (cmd.simNumber !== gw.simNumber) continue;
        rows.push({
          id: `${cmd.id}-sent`,
          direction: "sent",
          text: cmd.commandText,
          ts: cmd.sentAt ?? cmd.createdAt,
        });
        if (cmd.replyText) {
          rows.push({
            id: `${cmd.id}-reply`,
            direction: "received",
            text: cmd.replyText,
            ts: cmd.replyAt ?? cmd.createdAt,
          });
        }
      }
      rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      setInbox(rows);
      setInboxLive(false);
    }
  }, [gatewayId]);

  useEffect(() => {
    if (!Number.isNaN(gatewayId)) void load();
  }, [gatewayId, load]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [inbox, sendingCommand]);

  /**
   * Dispatches one of the three standard actions via /send — the exact same
   * path and worker-side keyword computation every valve row's Open/Close/
   * Refresh button already uses. Deliberately NOT /send-raw with a
   * client-guessed keyword string: the dashboard's Settings keywords and
   * the worker's own .env keywords are two separate, unsynced config
   * copies, and guessing from the wrong one sends the wrong SMS to real
   * hardware — this button set can only ever trigger what the worker
   * itself would send for a normal command, so it can't drift.
   */
  async function sendCommand(action: "on" | "off" | "status", output: 1 | 2, display: string) {
    if (!gateway || !settings?.workerUrl || sendingCommand) return;
    setSendingCommand({ action, output, display });
    setSendResult(null);
    setElapsedMs(0);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);

    const fill = (k: string) => k.replace("{output}", String(output ?? 1));
    const dispatch = await sendGatewayAction(
      settings.workerUrl,
      gateway.simNumber,
      gateway.authPassword,
      action,
      output,
      // Settings, not the worker's environment — see sendGatewayAction.
      {
        keyword: fill(
          action === "on"
            ? settings.keywordOpen
            : action === "off"
              ? settings.keywordClose
              : settings.keywordStatus
        ),
        statusKeyword: fill(settings.keywordStatus),
      }
    );
    if ("error" in dispatch) {
      if (timerRef.current) clearInterval(timerRef.current);
      setSendResult({ ok: false, text: dispatch.error });
      setSendingCommand(null);
      return;
    }

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const record = await fetchRawSendStatus(settings.workerUrl, dispatch.trackingId);
      if (record && record.status !== "sent") {
        // On failure, the specific reason (e.g. "Status query send failed:
        // fetch failed") lives in the event trail, not replyText (which is
        // only ever set from an actual SMS reply) — show that instead of a
        // bare status label with no explanation, same rule as everywhere
        // else real dispatch failures are surfaced in this app.
        // Success needs no lingering banner — the refreshed chat below
        // (load(), right after this) shows the real sent+reply bubbles.
        const lastEvent = record.events.at(-1)?.message;
        setSendResult(
          record.status === "success"
            ? null
            : { ok: false, text: lastEvent ?? t(`status.${record.status}`) }
        );
        break;
      }
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setSendingCommand(null);
    void load();
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === "ar" ? "ar-QA" : "en-GB", {
      dateStyle: "short",
      timeStyle: "medium",
    });

  if (!gateway || !settings) return null;

  const outputs = Array.from({ length: gateway.numOutputs }, (_, i) => i + 1) as (1 | 2)[];

  // The worker's own keywords are the ones actually used for every real
  // dispatch — prefer those for display whenever a worker is connected.
  // Settings' copy is only ever a fallback (demo mode, or worker offline),
  // and can legitimately be stale/different — see the health.keyword*
  // comment in lib/workerStatus.ts for why these two aren't the same thing.
  const rulesLive = health !== null;
  const kwOpen = health?.keywordOpen ?? settings.keywordOpen;
  const kwClose = health?.keywordClose ?? settings.keywordClose;
  const kwStatus = health?.keywordStatus ?? settings.keywordStatus;

  const quickCommands = [
    ...outputs.flatMap((n) => [
      {
        label: `${t("action.on")} V${n}`,
        action: "on" as const,
        output: n,
        display: kwOpen.replace("{output}", String(n)),
      },
      {
        label: `${t("action.off")} V${n}`,
        action: "off" as const,
        output: n,
        display: kwClose.replace("{output}", String(n)),
      },
    ]),
    { label: t("action.status"), action: "status" as const, output: outputs[0] ?? 1, display: kwStatus },
  ];

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: t("nav.gateways"), href: "/gateways" },
          { label: gateway.label, href: `/gateways/detail?id=${gateway.id}` },
          { label: t("gateways.inbox") },
        ]}
      />

      {/* Chat panel lives in its own right-hand column (same sticky-sidebar
          pattern as the Queue screen's Bulk send panel), not stacked below
          everything else in the main flow. */}
      <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">

      <div>
        <h1 className="text-lg font-semibold text-ink">{gateway.label}</h1>
        <p className="font-mono text-sm text-ink-3" dir="ltr">
          {gateway.simNumber}
        </p>
      </div>

      {/* Rules reference — read-only; the rules themselves live on the
          physical TRB141, not here. Shows the worker's real configured
          keywords whenever one's connected (what actually gets sent), the
          dashboard's Settings copy otherwise — see the rulesLive badge. */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconRadio size={16} className="text-brand" />
            <h2 className="text-sm font-semibold text-ink">{t("gateways.rulesTitle")}</h2>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              rulesLive ? "bg-good/10 text-good-text" : "bg-hairline text-ink-3"
            }`}
            title={rulesLive ? undefined : t("gateways.rulesFromSettingsHint")}
          >
            {t(rulesLive ? "gateways.rulesFromWorker" : "gateways.rulesFromSettings")}
          </span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          {outputs.map((n) => (
            <Fragment key={n}>
              <div>
                <dt className="text-xs text-ink-3">{t("gateways.rulesOpen", { output: n })}</dt>
                <dd className="font-mono text-sm text-ink" dir="ltr">
                  {kwOpen.replace("{output}", String(n))}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">{t("gateways.rulesClose", { output: n })}</dt>
                <dd className="font-mono text-sm text-ink" dir="ltr">
                  {kwClose.replace("{output}", String(n))}
                </dd>
              </div>
            </Fragment>
          ))}
          <div>
            <dt className="text-xs text-ink-3">{t("gateways.rulesStatus")}</dt>
            <dd className="font-mono text-sm text-ink" dir="ltr">
              {kwStatus}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">{t("gateways.auth")}</dt>
            <dd className="flex items-center gap-1.5 text-sm text-ink">
              {gateway.authPassword ? (
                <>
                  <IconLock size={13} className="text-ink-3" />
                  {t("gateways.authPasswordSet")}
                </>
              ) : (
                t("gateways.authNone")
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Send a message — only meaningful against real hardware. */}
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink">{t("gateways.sendTitle")}</h2>
        {!settings.workerUrl ? (
          <p className="text-sm text-ink-3">{t("gateways.sendNeedsWorker")}</p>
        ) : !canOperate ? (
          <p className="text-sm text-ink-3">{t("gateways.sendNeedsPermission")}</p>
        ) : (
          <>
            <p className="mb-3 text-xs leading-relaxed text-ink-3">{t("gateways.sendHint")}</p>
            <div className="flex flex-wrap gap-2">
              {quickCommands.map((cmd) => {
                const isThisOneSending =
                  sendingCommand?.action === cmd.action && sendingCommand?.output === cmd.output;
                return (
                  <Button
                    key={`${cmd.action}-${cmd.output}`}
                    type="button"
                    variant="ghost"
                    className="!px-3 !py-1.5 !text-xs"
                    disabled={sendingCommand !== null}
                    onClick={() => sendCommand(cmd.action, cmd.output, cmd.display)}
                  >
                    {isThisOneSending ? (
                      <IconSpinner size={13} />
                    ) : (
                      <IconSend size={13} className="text-brand" />
                    )}
                    {cmd.label}
                  </Button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-ink-3">{t("gateways.sendSeeChat")}</p>
          </>
        )}
      </Card>

      </div>

      <div className="xl:col-span-1">
      <Card className="sticky top-4 flex max-h-[calc(100vh-6rem)] flex-col">
        <div className="flex flex-col gap-1.5 border-b border-hairline px-5 py-3.5">
          <div className="flex items-center gap-2">
            <IconMail size={15} className="text-ink-3" />
            <h2 className="text-sm font-semibold text-ink">{t("gateways.inbox")}</h2>
          </div>
          <span
            className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
              inboxLive ? "bg-good/10 text-good-text" : "bg-hairline text-ink-3"
            }`}
          >
            {t(inboxLive ? "gateways.inboxLive" : "gateways.inboxDemo")}
          </span>
        </div>
        {inbox.length === 0 && !sendingCommand && !sendResult ? (
          <p className="px-5 py-6 text-center text-sm text-ink-3">
            {t("gateways.inboxEmpty")}
          </p>
        ) : (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
            {inbox.map((msg) => {
              const sent = msg.direction === "sent";
              return (
                <div key={msg.id} className={`flex ${sent ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                      sent
                        ? "rounded-br-sm bg-brand text-white"
                        : "rounded-bl-sm bg-hairline/60 text-ink"
                    }`}
                  >
                    <div className="font-mono text-sm" dir="ltr">
                      {msg.text}
                    </div>
                    <div
                      className={`mt-1 text-[11px] tabular-nums ${
                        sent ? "text-white/70" : "text-ink-3"
                      }`}
                    >
                      {fmt(msg.ts)}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Live outgoing bubble — pops in the moment a quick-command
                button is clicked, on the right where a sent message
                belongs, instead of a plain status line under the buttons. */}
            {sendingCommand && (
              <div className="flex animate-pop-in justify-end">
                <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-brand/60 px-4 py-2.5 text-white">
                  <div className="font-mono text-sm" dir="ltr">
                    {sendingCommand.display}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/80">
                    <IconSpinner size={11} />
                    {t("gateways.sendWaiting", { seconds: Math.floor(elapsedMs / 1000) })}
                  </div>
                </div>
              </div>
            )}

            {/* A failed send never produces a real inbox row (nothing was
                actually delivered), so this is the only place its reason
                is visible — kept until the next send attempt. */}
            {sendResult && !sendResult.ok && !sendingCommand && (
              <div className="flex animate-pop-in justify-end">
                <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-critical/40 bg-critical/10 px-4 py-2.5 text-sm text-critical">
                  {sendResult.text}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </Card>
      </div>

      </div>
    </div>
  );
}
