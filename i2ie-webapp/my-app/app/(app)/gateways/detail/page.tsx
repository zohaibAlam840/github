"use client";

/*
 * Gateway detail — one TRB141's own page: SIM/auth info, ping, the valves
 * wired to its outputs (linking back into their building/unit), and a
 * short command trend. Addressed via ?id= — see buildings/page.tsx for why
 * query params instead of dynamic path segments (static export).
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fetchWorkerInbox } from "@/lib/workerStatus";
import { numbersMatch } from "@/lib/phone";
import type { Building, CommandLog, Gateway, PingResult, Unit, Valve } from "@/lib/types";
import { Button, Card, StatTile, StatusChip, TimeAgo } from "@/components/ui";
import { CommandTrendChart } from "@/components/charts/CommandTrendChart";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconLock, IconMail, IconRadio, IconSend, IconSpinner, IconValve, IconX } from "@/components/icons";

interface InboxRow {
  id: number | string;
  direction: "sent" | "received";
  text: string;
  ts: string;
}

export default function GatewayDetailPage() {
  return (
    <Suspense fallback={null}>
      <GatewayDetailScreen />
    </Suspense>
  );
}

function GatewayDetailScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const gatewayId = Number(useSearchParams().get("id"));

  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [valves, setValves] = useState<Valve[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [commands, setCommands] = useState<CommandLog[]>([]);
  const [pinging, setPinging] = useState(false);
  const [lastPing, setLastPing] = useState<PingResult | null>(null);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [inboxLive, setInboxLive] = useState(false);

  const load = useCallback(async () => {
    const [gateways, allValves, allUnits, allBuildings, c, settings] = await Promise.all([
      api.gateways.list(),
      api.valves.list(),
      api.units.list(),
      api.buildings.list(),
      api.commands.list(500),
      api.settings.get(),
    ]);
    const gw = gateways.find((g) => g.id === gatewayId) ?? null;
    setGateway(gw);
    setValves(allValves.filter((v) => v.gatewayId === gatewayId));
    setUnits(allUnits);
    setBuildings(allBuildings);
    setCommands(c);

    if (!gw) return;

    // Live path: every message the worker actually sent to or received from
    // this SIM — the full exchange, never lost even if no pending command
    // was waiting on a given reply. Demo fallback: derive both directions
    // from command history (commandText = sent, replyText = received) so
    // the card isn't blank before a worker is connected.
    const workerInbox = settings.workerUrl ? await fetchWorkerInbox(settings.workerUrl) : null;
    if (workerInbox) {
      setInbox(
        workerInbox
          .filter((m) => numbersMatch(m.simNumber, gw.simNumber))
          .map((m) => ({ id: m.id, direction: m.direction, text: m.text, ts: m.ts }))
      );
      setInboxLive(true);
    } else {
      const rows: InboxRow[] = [];
      for (const cmd of c) {
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
      rows.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setInbox(rows);
      setInboxLive(false);
    }
  }, [gatewayId]);

  useEffect(() => {
    if (!Number.isNaN(gatewayId)) void load();
  }, [gatewayId, load]);

  async function ping() {
    if (!gateway) return;
    setPinging(true);
    setLastPing(null);
    try {
      setLastPing(await api.gateways.ping(gateway.id));
    } finally {
      setPinging(false);
      void load();
    }
  }

  if (!gateway) return null;

  const valveIds = new Set(valves.map((v) => v.id));
  const gatewayCommands = commands.filter((c) => valveIds.has(c.valveId));

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: t("nav.gateways"), href: "/gateways" },
          { label: gateway.label },
        ]}
      />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">{gateway.label}</h1>
          <p className="font-mono text-sm text-ink-3" dir="ltr">
            {gateway.simNumber}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={async () => {
              if (confirm(t("gateways.confirmDelete"))) {
                await api.gateways.remove(gateway.id);
                router.push("/gateways");
              }
            }}
            className="rounded p-1.5 text-ink-3 hover:text-critical"
            title={t("buildings.delete")}
          >
            <IconX size={16} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile
          label={t("gateways.outputs")}
          value={gateway.numOutputs}
          icon={<IconRadio size={14} />}
        />
        <StatTile
          label={t("gateways.valvesWired")}
          value={valves.length}
          icon={<IconValve size={14} />}
        />
        <StatTile
          label={t("gateways.auth")}
          value={gateway.authPassword ? t("gateways.authPasswordSet") : t("gateways.authNone")}
          icon={gateway.authPassword ? <IconLock size={14} /> : undefined}
        />
      </div>

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span className="text-sm text-ink-2">{t("gateways.reachability")}</span>
        <StatusChip status={gateway.reachability} />
        <span className="text-xs text-ink-3">
          {t("gateways.lastSeen")}: <TimeAgo iso={gateway.lastSeenAt} />
        </span>
        <Button
          variant="ghost"
          className="ms-auto !px-3 !py-1.5 !text-xs"
          disabled={pinging}
          onClick={ping}
        >
          {pinging ? <IconSpinner size={13} /> : <IconRadio size={13} className="text-brand" />}
          {pinging ? t("gateways.pinging") : t("gateways.ping")}
        </Button>
      </Card>

      {lastPing && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-sm ${
            lastPing.ok
              ? "border-good/40 bg-good/10 text-good-text"
              : "border-critical/40 bg-critical/10 text-critical"
          }`}
        >
          {lastPing.ok
            ? t("gateways.pingOk", { ms: lastPing.roundTripMs, reply: lastPing.replyText })
            : t("gateways.pingFail")}
        </div>
      )}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">
          {t("buildings.recentActivity")}
        </h2>
        <CommandTrendChart commands={gatewayCommands} />
      </Card>

      <Card>
        <h2 className="border-b border-hairline px-5 py-3.5 text-sm font-semibold text-ink">
          {t("buildings.valves")}
        </h2>
        {valves.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-ink-3">
            {t("buildings.noValves")}
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {valves.map((valve) => {
              const unit = units.find((u) => u.id === valve.unitId);
              const building = unit
                ? buildings.find((b) => b.id === unit.buildingId)
                : undefined;
              return (
                <li key={valve.id}>
                  <Link
                    href={
                      unit && building
                        ? `/buildings/unit?building=${building.id}&unit=${unit.id}`
                        : "#"
                    }
                    className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hairline/30"
                  >
                    <div className="min-w-32 flex-1">
                      <div className="font-medium text-ink">{valve.valveCode}</div>
                      <div className="text-xs text-ink-3">
                        V{valve.outputIndex}
                        {building && unit ? ` · ${building.name} · ${unit.name}` : ""}
                      </div>
                    </div>
                    <StatusChip status={valve.lastStatus} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <IconMail size={15} className="text-ink-3" />
            <h2 className="text-sm font-semibold text-ink">{t("gateways.inbox")}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                inboxLive ? "bg-good/10 text-good-text" : "bg-hairline text-ink-3"
              }`}
            >
              {t(inboxLive ? "gateways.inboxLive" : "gateways.inboxDemo")}
            </span>
          </div>
          <Link href={`/gateways/inbox?id=${gateway.id}`}>
            <Button variant="ghost" className="!px-3 !py-1.5 !text-xs">
              {t("gateways.viewInbox")}
            </Button>
          </Link>
        </div>
        {inbox.length === 0 ? (
          <p className="px-5 pb-5 text-center text-sm text-ink-3">
            {t("gateways.inboxEmpty")}
          </p>
        ) : (
          <div className="px-5 pb-5">
            <p className="mb-2 text-xs text-ink-3">
              {t("gateways.inboxCount", { count: inbox.length })}
            </p>
            <div className="rounded-lg border border-edge bg-hairline/20 px-3 py-2">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    inbox[0].direction === "sent"
                      ? "bg-brand/10 text-brand"
                      : "bg-good/10 text-good-text"
                  }`}
                >
                  {inbox[0].direction === "sent" ? <IconSend size={10} /> : <IconMail size={10} />}
                  {t(inbox[0].direction === "sent" ? "gateways.inboxSent" : "gateways.inboxReceived")}
                </span>
                <span className="text-xs tabular-nums text-ink-3">
                  {new Date(inbox[0].ts).toLocaleString(
                    i18n.language === "ar" ? "ar-QA" : "en-GB",
                    { dateStyle: "short", timeStyle: "medium" }
                  )}
                </span>
              </div>
              <div className="truncate font-mono text-sm text-ink-2" dir="ltr">
                {inbox[0].text}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
