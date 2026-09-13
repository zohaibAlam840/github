"use client";

/*
 * Valve detail — the third drill-down level (Building > Unit > Valve).
 * Reuses ValveRow directly for the live control row (same modal, same
 * behavior as everywhere else), then shows this one valve's full command
 * history with the same expandable event trail as Queue/Logs.
 */

import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import { useAuth } from "@/lib/auth";
import type {
  Building,
  Command,
  CommandAction,
  CommandLog,
  Gateway,
  Unit,
  Valve,
} from "@/lib/types";
import { Card, StatusChip } from "@/components/ui";
import { CommandTrendChart } from "@/components/charts/CommandTrendChart";
import { Breadcrumb } from "@/components/Breadcrumb";
import { ValveRow } from "@/components/valve/ValveRow";
import { IconChevronDown, IconX } from "@/components/icons";

export default function ValveDetailPage() {
  return (
    <Suspense fallback={null}>
      <ValveDetailScreen />
    </Suspense>
  );
}

function ValveDetailScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user, canOperate, isAdmin } = useAuth();
  const params = useSearchParams();
  const buildingId = Number(params.get("building"));
  const unitId = Number(params.get("unit"));
  const valveId = Number(params.get("valve"));

  const [building, setBuilding] = useState<Building | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [valve, setValve] = useState<Valve | null>(null);
  const [gateway, setGateway] = useState<Gateway | undefined>(undefined);
  const [commands, setCommands] = useState<CommandLog[]>([]);
  const [inFlight, setInFlight] = useState<CommandLog | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [buildings, units, valves, gateways, allCommands] = await Promise.all([
      api.buildings.list(),
      api.units.list(),
      api.valves.list(),
      api.gateways.list(),
      api.commands.list(500),
    ]);
    setBuilding(buildings.find((b) => b.id === buildingId) ?? null);
    setUnit(units.find((u) => u.id === unitId) ?? null);
    const v = valves.find((x) => x.id === valveId) ?? null;
    setValve(v);
    setGateway(v ? gateways.find((g) => g.id === v.gatewayId) : undefined);
    const scoped = allCommands.filter((c) => c.valveId === valveId);
    setCommands(scoped);
    setInFlight(v?.pendingCommandId ? scoped.find((c) => c.id === v.pendingCommandId) : undefined);
  }, [buildingId, unitId, valveId]);

  useEffect(() => {
    if (![buildingId, unitId, valveId].some(Number.isNaN)) void load();
  }, [buildingId, unitId, valveId, load]);

  useEffect(() => {
    // Debounced — see queue/page.tsx's comment: load() fetches 5 full lists
    // (including 500 commands), and a bulk send can fire thousands of events.
    const reload = debounce(() => void load(), 250);
    const offs = [onAppEvent("valve:update", reload), onAppEvent("command:update", reload)];
    return () => {
      reload.cancel();
      offs.forEach((off) => off());
    };
  }, [load]);

  async function sendCommand(v: Valve, action: CommandAction) {
    if (!user) return undefined;
    return api.valves.queueCommand(v.id, action);
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(i18n.language === "ar" ? "ar-QA" : "en-GB", {
          dateStyle: "short",
          timeStyle: "medium",
        })
      : "—";

  if (!building || !unit || !valve) return null;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: t("nav.buildings"), href: "/buildings" },
          { label: building.name, href: `/buildings/detail?id=${building.id}` },
          { label: unit.name, href: `/buildings/unit?building=${building.id}&unit=${unit.id}` },
          { label: valve.valveCode },
        ]}
      />

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">{valve.valveCode}</h1>
        {isAdmin && (
          <button
            onClick={async () => {
              if (confirm(t("buildings.confirmDeleteValve"))) {
                await api.valves.remove(valve.id);
                router.push(`/buildings/unit?building=${building.id}&unit=${unit.id}`);
              }
            }}
            className="rounded p-1.5 text-ink-3 hover:text-critical"
            title={t("buildings.delete")}
          >
            <IconX size={16} />
          </button>
        )}
      </div>

      <Card>
        <ul className="divide-y divide-hairline">
          <ValveRow
            valve={valve}
            gateway={gateway}
            command={inFlight}
            canOperate={canOperate}
            isAdmin={false}
            onSend={sendCommand}
            onChanged={load}
          />
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">
          {t("buildings.recentActivity")}
        </h2>
        <CommandTrendChart commands={commands} />
      </Card>

      <Card>
        <h2 className="border-b border-hairline px-5 py-3.5 text-sm font-semibold text-ink">
          {t("logs.count", { count: commands.length })}
        </h2>
        {commands.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-ink-3">
            {t("buildings.noCommandHistory")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-ink-3">
                  <th className="px-4 py-2.5 text-start font-medium" />
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.time")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.action")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.sms")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.statusCol")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.reply")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("logs.user")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {commands.map((c) => {
                  const hasEvents = (c.events?.length ?? 0) > 0;
                  const expanded = expandedId === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr
                        className={hasEvents ? "cursor-pointer" : undefined}
                        onClick={() => hasEvents && setExpandedId(expanded ? null : c.id)}
                      >
                        <td className="px-2 py-2.5 text-ink-3">
                          {hasEvents && (
                            <IconChevronDown
                              size={13}
                              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                            />
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-xs text-ink-2">
                          {fmt(c.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">{t(`action.${c.action}`)}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-3">{c.commandText}</td>
                        <td className="px-4 py-2.5">
                          <StatusChip status={c.status} />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-3">
                          {c.replyText ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">{c.userName}</td>
                      </tr>
                      {expanded && hasEvents && (
                        <tr className="bg-hairline/20">
                          <td />
                          <td colSpan={6} className="px-4 py-3">
                            <ol className="space-y-1">
                              {c.events!.map((evt, i) => (
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
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
