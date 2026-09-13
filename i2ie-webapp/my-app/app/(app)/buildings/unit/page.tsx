"use client";

/*
 * Unit detail — one apartment/unit's valves, with live control (open/close/
 * refresh -> progress modal) and a short command trend. Addressed via
 * ?building=&unit= — see buildings/page.tsx for why query params instead
 * of dynamic path segments (static export, client-generated ids).
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import { useAuth } from "@/lib/auth";
import type {
  BuildingStats,
  Command,
  CommandAction,
  CommandLog,
  Gateway,
  Unit,
  Valve,
} from "@/lib/types";
import { Card } from "@/components/ui";
import { ValveRow } from "@/components/valve/ValveRow";
import { AddValveForm } from "@/components/valve/AddValveForm";
import { CommandTrendChart } from "@/components/charts/CommandTrendChart";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconX } from "@/components/icons";

export default function UnitDetailPage() {
  return (
    <Suspense fallback={null}>
      <UnitDetailScreen />
    </Suspense>
  );
}

function UnitDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, canOperate, isAdmin } = useAuth();
  const params = useSearchParams();
  const buildingId = Number(params.get("building"));
  const unitId = Number(params.get("unit"));

  const [building, setBuilding] = useState<BuildingStats | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [valves, setValves] = useState<Valve[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [commands, setCommands] = useState<CommandLog[]>([]);
  const [inFlight, setInFlight] = useState<Map<number, CommandLog>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [stats, units, v, g, c] = await Promise.all([
      api.dashboard.buildingStats(),
      api.units.listByBuilding(buildingId),
      api.valves.listByBuilding(buildingId),
      api.gateways.list(),
      api.commands.list(500),
    ]);
    setBuilding(stats.find((b) => b.id === buildingId) ?? null);
    setUnit(units.find((u) => u.id === unitId) ?? null);
    setValves(v.filter((x) => x.unitId === unitId));
    setGateways(g);
    setCommands(c);

    const map = new Map<number, CommandLog>();
    for (const cmd of c) {
      if (cmd.status === "pending" || cmd.status === "sent") map.set(cmd.id, cmd);
    }
    setInFlight(map);
  }, [buildingId, unitId]);

  useEffect(() => {
    if (!Number.isNaN(buildingId) && !Number.isNaN(unitId)) void load();
  }, [buildingId, unitId, load]);

  useEffect(() => {
    // Debounced — see queue/page.tsx's comment: a bulk send can fire
    // thousands of events in a burst.
    const reload = debounce(() => void load(), 250);
    const offs = [onAppEvent("valve:update", reload), onAppEvent("command:update", reload)];
    return () => {
      reload.cancel();
      offs.forEach((off) => off());
    };
  }, [load]);

  async function sendCommand(valve: Valve, action: CommandAction) {
    if (!user) return undefined;
    try {
      const command = await api.valves.queueCommand(valve.id, action);
      setNotice(t("buildings.commandQueued"));
      setTimeout(() => setNotice(null), 3500);
      return command;
    } catch (err) {
      // The server refuses a second command on a busy valve. Saying so is
      // the whole point — an unhandled rejection told the operator nothing
      // and left them clicking.
      setNotice(err instanceof Error ? err.message : String(err));
      setTimeout(() => setNotice(null), 6000);
      return undefined;
    }
  }

  if (!building || !unit) return null;

  const valveIds = new Set(valves.map((v) => v.id));
  const unitCommands = commands.filter((c) => valveIds.has(c.valveId));

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: t("nav.buildings"), href: "/buildings" },
          { label: building.name, href: `/buildings/detail?id=${building.id}` },
          { label: unit.name },
        ]}
      />

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">{unit.name}</h1>
        {isAdmin && (
          <button
            onClick={async () => {
              if (confirm(t("buildings.confirmDeleteUnit"))) {
                await api.units.remove(unit.id);
                router.push(`/buildings/detail?id=${building.id}`);
              }
            }}
            className="rounded p-1.5 text-ink-3 hover:text-critical"
            title={t("buildings.delete")}
          >
            <IconX size={16} />
          </button>
        )}
      </div>

      {notice && (
        <div className="rounded-lg border border-brand/30 bg-brand/10 px-4 py-2.5 text-sm text-brand">
          {notice}
        </div>
      )}

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
            {valves.map((valve) => (
              <ValveRow
                key={valve.id}
                valve={valve}
                gateway={gateways.find((g) => g.id === valve.gatewayId)}
                command={valve.pendingCommandId ? inFlight.get(valve.pendingCommandId) : undefined}
                canOperate={canOperate}
                isAdmin={isAdmin}
                onSend={sendCommand}
                onChanged={load}
                buildingId={building.id}
              />
            ))}
          </ul>
        )}
        {isAdmin && (
          <AddValveForm unitId={unit.id} gateways={gateways} onAdded={load} />
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">
          {t("buildings.recentActivity")}
        </h2>
        <CommandTrendChart commands={unitCommands} />
      </Card>
    </div>
  );
}
