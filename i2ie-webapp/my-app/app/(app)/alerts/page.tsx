"use client";

/*
 * Alerts — everything that needs a human look, in one place, instead of
 * hunting across Dashboard/Gateways/Logs separately. Three sections:
 * unreachable gateways, valves stuck "unknown", and recent failed/
 * no-response commands. Matters more as the portfolio grows — at 500
 * valves you can't eyeball the Dashboard for the ones that need attention.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import type { Building, CommandLog, Gateway, Unit, Valve } from "@/lib/types";
import { Card, StatusChip, TimeAgo } from "@/components/ui";
import {
  IconAlert,
  IconCheck,
  IconRadio,
  IconValve,
} from "@/components/icons";

export default function AlertsPage() {
  const { t } = useTranslation();
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [valves, setValves] = useState<Valve[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [commands, setCommands] = useState<CommandLog[]>([]);

  const load = useCallback(async () => {
    const [g, v, u, b, c] = await Promise.all([
      api.gateways.list(),
      api.valves.list(),
      api.units.list(),
      api.buildings.list(),
      api.commands.list(200),
    ]);
    setGateways(g);
    setValves(v);
    setUnits(u);
    setBuildings(b);
    setCommands(c);
  }, []);

  useEffect(() => {
    void load();
    // Debounced — see queue/page.tsx's comment: a bulk send can fire
    // thousands of events; load() fetches 5 full lists (including every
    // valve and 200 commands) each time.
    const reload = debounce(() => void load(), 250);
    const offs = [onAppEvent("valve:update", reload), onAppEvent("command:update", reload)];
    return () => {
      reload.cancel();
      offs.forEach((off) => off());
    };
  }, [load]);

  const unreachableGateways = gateways.filter((g) => g.reachability === "unreachable");
  const unknownValves = valves.filter((v) => v.lastStatus === "unknown");
  const troubledCommands = commands
    .filter((c) => c.status === "failed" || c.status === "no_response")
    .slice(0, 30);

  const totalAlerts = unreachableGateways.length + unknownValves.length + troubledCommands.length;

  function valveLink(valve: Valve) {
    const unit = units.find((u) => u.id === valve.unitId);
    const building = unit ? buildings.find((b) => b.id === unit.buildingId) : undefined;
    if (!unit || !building) return null;
    return `/buildings/valve?building=${building.id}&unit=${unit.id}&valve=${valve.id}`;
  }

  return (
    <div className="space-y-4">
      {totalAlerts === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <IconCheck size={22} className="text-good" />
          <p className="text-sm font-medium text-ink">{t("alerts.allClear")}</p>
          <p className="text-xs text-ink-3">{t("alerts.allClearHint")}</p>
        </Card>
      ) : (
        <p className="text-sm text-ink-3">{t("alerts.count", { count: totalAlerts })}</p>
      )}

      {/* Unreachable gateways */}
      {unreachableGateways.length > 0 && (
        <Card>
          <h2 className="flex items-center gap-2 border-b border-hairline px-5 py-3.5 text-sm font-semibold text-ink">
            <IconRadio size={15} className="text-critical" />
            {t("alerts.unreachableGateways", { count: unreachableGateways.length })}
          </h2>
          <ul className="divide-y divide-hairline">
            {unreachableGateways.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/gateways/detail?id=${g.id}`}
                  className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-hairline/30"
                >
                  <span className="flex-1 font-medium text-ink">{g.label}</span>
                  <span className="font-mono text-xs text-ink-3" dir="ltr">
                    {g.simNumber}
                  </span>
                  <span className="text-xs text-ink-3">
                    <TimeAgo iso={g.lastSeenAt} />
                  </span>
                  <StatusChip status="unreachable" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Valves stuck unknown */}
      {unknownValves.length > 0 && (
        <Card>
          <h2 className="flex items-center gap-2 border-b border-hairline px-5 py-3.5 text-sm font-semibold text-ink">
            <IconValve size={15} className="text-warn" />
            {t("alerts.unknownValves", { count: unknownValves.length })}
          </h2>
          <ul className="divide-y divide-hairline">
            {unknownValves.map((v) => {
              const href = valveLink(v);
              const unit = units.find((u) => u.id === v.unitId);
              const building = unit ? buildings.find((b) => b.id === unit.buildingId) : undefined;
              const row = (
                <>
                  <span className="flex-1 font-medium text-ink">{v.valveCode}</span>
                  <span className="text-xs text-ink-3">
                    {building && unit ? `${building.name} · ${unit.name}` : "—"}
                  </span>
                  <span className="text-xs text-ink-3">
                    <TimeAgo iso={v.lastSeenAt} />
                  </span>
                  <StatusChip status="unknown" />
                </>
              );
              return (
                <li key={v.id}>
                  {href ? (
                    <Link
                      href={href}
                      className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-hairline/30"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-4 px-5 py-3">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Recent failed / no-response commands */}
      {troubledCommands.length > 0 && (
        <Card>
          <h2 className="flex items-center gap-2 border-b border-hairline px-5 py-3.5 text-sm font-semibold text-ink">
            <IconAlert size={15} className="text-serious" />
            {t("alerts.troubledCommands", { count: troubledCommands.length })}
          </h2>
          <ul className="divide-y divide-hairline">
            {troubledCommands.map((c) => (
              <li key={c.id} className="flex items-center gap-4 px-5 py-3">
                <span className="flex-1">
                  <span className="font-medium text-ink">{c.valveCode}</span>
                  <span className="ms-2 text-xs text-ink-3">
                    {c.buildingName} · {c.unitName}
                  </span>
                </span>
                <span className="text-xs text-ink-3">{t(`action.${c.action}`)}</span>
                <span className="text-xs text-ink-3">
                  <TimeAgo iso={c.createdAt} />
                </span>
                <StatusChip status={c.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
