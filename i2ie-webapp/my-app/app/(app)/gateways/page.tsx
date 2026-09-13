"use client";

/*
 * Gateways — the TRB141 registry (admin only).
 *
 * The star of this screen is PING: it sends the device's BUILT-IN status
 * command (admin-password auth), which works before any custom rules are
 * provisioned. It's the first step of onboarding every new gateway:
 * prove the SIM/device is reachable, THEN configure the valve rules.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { fetchWorkerInbox } from "@/lib/workerStatus";
import { normalizePhone, numbersMatch, phoneProblem } from "@/lib/phone";
import type { Gateway, PingResult } from "@/lib/types";
import { AdminOnly } from "@/components/AdminOnly";
import { Button, Card, StatusChip, TimeAgo } from "@/components/ui";
import { IconLock, IconMail, IconRadio, IconSend, IconSpinner, IconX } from "@/components/icons";

interface InboxRow {
  id: number | string;
  direction: "sent" | "received";
  gatewayLabel: string;
  text: string;
  ts: string;
}

export default function GatewaysPage() {
  return (
    <AdminOnly>
      <GatewaysScreen />
    </AdminOnly>
  );
}

function GatewaysScreen() {
  const { t, i18n } = useTranslation();
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [valveCounts, setValveCounts] = useState<Map<number, number>>(new Map());
  const [pingingId, setPingingId] = useState<number | null>(null);
  const [lastPing, setLastPing] = useState<PingResult | null>(null);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [inboxLive, setInboxLive] = useState(false);

  const load = useCallback(async () => {
    const [list, counts, settings] = await Promise.all([
      api.gateways.list(),
      api.gateways.valveCounts(),
      api.settings.get(),
    ]);
    setGateways(list);
    setValveCounts(counts);

    // Same idea as the per-gateway Inbox card on the detail page, just
    // across every gateway at once so nothing needs a click-through to see.
    const workerInbox = settings.workerUrl ? await fetchWorkerInbox(settings.workerUrl) : null;
    if (workerInbox) {
      const rows: InboxRow[] = [];
      for (const m of workerInbox) {
        const gw = list.find((g) => numbersMatch(m.simNumber, g.simNumber));
        if (!gw) continue;
        rows.push({ id: m.id, direction: m.direction, gatewayLabel: gw.label, text: m.text, ts: m.ts });
      }
      setInbox(rows);
      setInboxLive(true);
    } else {
      const commands = await api.commands.list(500);
      const rows: InboxRow[] = [];
      for (const cmd of commands) {
        const gw = list.find((g) => g.simNumber === cmd.simNumber);
        if (!gw) continue;
        rows.push({
          id: `${cmd.id}-sent`,
          direction: "sent",
          gatewayLabel: gw.label,
          text: cmd.commandText,
          ts: cmd.sentAt ?? cmd.createdAt,
        });
        if (cmd.replyText) {
          rows.push({
            id: `${cmd.id}-reply`,
            direction: "received",
            gatewayLabel: gw.label,
            text: cmd.replyText,
            ts: cmd.replyAt ?? cmd.createdAt,
          });
        }
      }
      rows.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setInbox(rows);
      setInboxLive(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function ping(gateway: Gateway) {
    setPingingId(gateway.id);
    setLastPing(null);
    try {
      const result = await api.gateways.ping(gateway.id);
      setLastPing(result);
    } finally {
      setPingingId(null);
      void load(); // reachability/lastSeen changed
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href="/gateways/new">
          <Button className="!px-3 !py-1.5 !text-xs">{t("wizard.startButton")}</Button>
        </Link>
      </div>

      {/* Why ping exists — the onboarding story, visible to the admin */}
      <Card className="flex items-start gap-3 border-brand/30 bg-brand/5 px-4 py-3">
        <IconRadio size={16} className="mt-0.5 shrink-0 text-brand" />
        <p className="text-sm leading-relaxed text-ink-2">
          {t("gateways.pingHint")}
        </p>
      </Card>

      {/* Ping result banner */}
      {lastPing && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-sm ${
            lastPing.ok
              ? "border-good/40 bg-good/10 text-good-text"
              : "border-critical/40 bg-critical/10 text-critical"
          }`}
        >
          {lastPing.ok
            ? t("gateways.pingOk", {
                ms: lastPing.roundTripMs,
                reply: lastPing.replyText,
              })
            : t("gateways.pingFail")}
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-ink-3">
                <th className="px-4 py-2.5 text-start font-medium">{t("buildings.gateway")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("gateways.sim")}</th>
                <th className="px-4 py-2.5 text-center font-medium">{t("gateways.auth")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("gateways.outputs")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("gateways.valvesWired")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("gateways.reachability")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("gateways.lastSeen")}</th>
                <th className="px-4 py-2.5 text-start font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {gateways.map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/gateways/detail?id=${g.id}`}
                      className="text-ink hover:text-brand hover:underline"
                    >
                      {g.label}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-2" dir="ltr">
                    {g.simNumber}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {g.authPassword ? (
                      <span title={t("gateways.authPasswordSet")}>
                        <IconLock size={13} className="inline text-ink-3" />
                      </span>
                    ) : (
                      <span className="text-xs text-ink-3">{t("gateways.authNone")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{g.numOutputs}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">
                    {valveCounts.get(g.id) ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    {g.reachability === "unknown" ? (
                      <StatusChip status="unknown" />
                    ) : (
                      <StatusChip status={g.reachability} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <TimeAgo iso={g.lastSeenAt} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        className="!px-3 !py-1.5 !text-xs"
                        disabled={pingingId !== null}
                        onClick={() => ping(g)}
                      >
                        {pingingId === g.id ? (
                          <>
                            <IconSpinner size={13} />
                            {t("gateways.pinging")}
                          </>
                        ) : (
                          <>
                            <IconRadio size={13} className="text-brand" />
                            {t("gateways.ping")}
                          </>
                        )}
                      </Button>
                      <button
                        onClick={async () => {
                          if (confirm(t("gateways.confirmDelete"))) {
                            await api.gateways.remove(g.id);
                            void load();
                          }
                        }}
                        className="rounded p-1 text-ink-3 hover:text-critical"
                        title={t("buildings.delete")}
                      >
                        <IconX size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddGatewayForm onAdded={load} />
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
          <div className="flex items-center gap-2">
            <IconMail size={15} className="text-ink-3" />
            <h2 className="text-sm font-semibold text-ink">{t("gateways.inbox")}</h2>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              inboxLive ? "bg-good/10 text-good-text" : "bg-hairline text-ink-3"
            }`}
          >
            {t(inboxLive ? "gateways.inboxLive" : "gateways.inboxDemo")}
          </span>
        </div>
        {inbox.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-ink-3">
            {t("gateways.inboxEmpty")}
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-hairline overflow-y-auto">
            {inbox.map((msg) => {
              const sent = msg.direction === "sent";
              return (
                <li key={msg.id} className="px-5 py-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        sent ? "bg-brand/10 text-brand" : "bg-good/10 text-good-text"
                      }`}
                    >
                      {sent ? <IconSend size={10} /> : <IconMail size={10} />}
                      {t(sent ? "gateways.inboxSent" : "gateways.inboxReceived")}
                    </span>
                    <span className="text-xs font-medium text-ink-2">{msg.gatewayLabel}</span>
                    <span className="text-xs tabular-nums text-ink-3">
                      {new Date(msg.ts).toLocaleString(
                        i18n.language === "ar" ? "ar-QA" : "en-GB",
                        { dateStyle: "short", timeStyle: "medium" }
                      )}
                    </span>
                  </div>
                  <div className="font-mono text-sm text-ink-2" dir="ltr">
                    {msg.text}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AddGatewayForm({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [sim, setSim] = useState("");
  /*
   * One output, always.
   *
   * This deployment drives the TRB141's LATCHING relay (11,12,13) and only
   * that one — see the TRB141 Guide for why the plain relay is unsuitable
   * for a supply cutoff. So there is nothing for a second output to control,
   * and offering the choice only ever produced a V2 valve with nothing
   * behind it. The database still supports two, so a future two-relay
   * deployment needs no migration; the UI simply does not offer it.
   */
  const outputs = 1 as const;
  const [authPassword, setAuthPassword] = useState("");
  // Warn, never block: we cannot know every country's numbering plan.
  const simProblem = sim.trim() ? phoneProblem(normalizePhone(sim)) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !sim.trim()) return;
    // Normalise here too, not just on blur: a paste followed by Enter never
    // fires a blur, and the stored number must be the one we can actually send to.
    await api.gateways.create(
      label.trim(),
      normalizePhone(sim),
      outputs,
      authPassword.trim() || null
    );
    setLabel("");
    setSim("");
    setAuthPassword("");
    onAdded();
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 border-t border-hairline p-4"
    >
      <span className="text-xs font-semibold text-ink-2">
        {t("gateways.addGateway")}
      </span>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("gateways.label")}
        className="min-w-44 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand"
        required
      />
      <input
        value={sim}
        onChange={(e) => setSim(e.target.value)}
        onBlur={() => setSim((v) => normalizePhone(v))}
        placeholder="+9745xxxxxxx"
        dir="ltr"
        title={t("gateways.simHint")}
        aria-invalid={simProblem !== null}
        className="min-w-40 rounded-lg border border-edge bg-surface px-3 py-1.5 font-mono text-sm text-ink outline-none focus:border-brand"
        required
      />
      <input
        value={authPassword}
        onChange={(e) => setAuthPassword(e.target.value)}
        placeholder={t("gateways.authPasswordPlaceholder")}
        type="password"
        autoComplete="off"
        dir="ltr"
        title={t("gateways.authPasswordHint")}
        className="min-w-36 rounded-lg border border-edge bg-surface px-3 py-1.5 font-mono text-sm text-ink outline-none focus:border-brand"
      />
      <Button type="submit" className="!px-3 !py-1.5 !text-xs">
        {t("buildings.add")}
      </Button>
      {/* Full-width so it drops onto its own line under the wrapped row.
          A warning, not a block — see phoneProblem(). */}
      {simProblem && (
        <p className="w-full text-xs leading-relaxed text-warn">
          {t(`gateways.sim_${simProblem}`, { number: normalizePhone(sim) })}
        </p>
      )}
    </form>
  );
}
