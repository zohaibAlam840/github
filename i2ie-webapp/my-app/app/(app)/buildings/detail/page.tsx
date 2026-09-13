"use client";

/*
 * Building detail — one building's overview: KPI tiles, valve-status bar,
 * a 7-day command trend, and its units (each linking to its own detail
 * page). Addressed via ?id= (see buildings/page.tsx for why: static export
 * can't pre-enumerate client-generated ids for a dynamic path segment).
 */

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import { useAuth } from "@/lib/auth";
import type { BuildingStats, CommandLog, Unit, Valve } from "@/lib/types";
import { Button, Card, StatTile } from "@/components/ui";
import { ValveStatusBar } from "@/components/charts/ValveStatusBar";
import { CommandTrendChart } from "@/components/charts/CommandTrendChart";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconAlert, IconBuilding, IconDrop, IconValve, IconX } from "@/components/icons";

export default function BuildingDetailPage() {
  return (
    <Suspense fallback={null}>
      <BuildingDetailScreen />
    </Suspense>
  );
}

function BuildingDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const buildingId = Number(useSearchParams().get("id"));

  const [building, setBuilding] = useState<BuildingStats | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [valves, setValves] = useState<Valve[]>([]);
  const [commands, setCommands] = useState<CommandLog[]>([]);

  const load = useCallback(async () => {
    const [stats, u, v, c] = await Promise.all([
      api.dashboard.buildingStats(),
      api.units.listByBuilding(buildingId),
      api.valves.listByBuilding(buildingId),
      api.commands.list(500),
    ]);
    setBuilding(stats.find((b) => b.id === buildingId) ?? null);
    setUnits(u);
    setValves(v);
    setCommands(c);
  }, [buildingId]);

  useEffect(() => {
    if (!Number.isNaN(buildingId)) void load();
  }, [buildingId, load]);

  useEffect(() => {
    // Debounced — see queue/page.tsx's comment: a bulk send can fire
    // thousands of events in a burst; load() fetches 4 full lists each time.
    const reload = debounce(() => void load(), 250);
    const offs = [onAppEvent("valve:update", reload), onAppEvent("command:update", reload)];
    return () => {
      reload.cancel();
      offs.forEach((off) => off());
    };
  }, [load]);

  if (!building) return null;

  const valveIds = new Set(valves.map((v) => v.id));
  const buildingCommands = commands.filter((c) => valveIds.has(c.valveId));

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: t("nav.buildings"), href: "/buildings" },
          { label: building.name },
        ]}
      />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">{building.name}</h1>
          {building.address && (
            <p className="text-sm text-ink-3">{building.address}</p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={async () => {
              if (confirm(t("buildings.confirmDeleteBuilding"))) {
                await api.buildings.remove(building.id);
                router.push("/buildings");
              }
            }}
            className="rounded p-1.5 text-ink-3 hover:text-critical"
            title={t("buildings.delete")}
          >
            <IconX size={16} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatTile
          label={t("buildings.units")}
          value={building.unitCount}
          icon={<IconBuilding size={14} />}
        />
        <StatTile
          label={t("buildings.valves")}
          value={building.valveCount}
          icon={<IconValve size={14} />}
        />
        <StatTile
          label={t("status.open")}
          value={building.open}
          icon={<IconDrop size={14} />}
          accent="text-good"
        />
        <StatTile
          label={t("status.closed")}
          value={building.closed}
          icon={<IconX size={14} />}
          accent="text-ink-2"
        />
        <StatTile
          label={t("status.unknown")}
          value={building.unknown}
          icon={<IconAlert size={14} />}
          accent="text-warn"
        />
      </div>

      {building.valveCount > 0 && (
        <Card className="p-5">
          <ValveStatusBar
            open={building.open}
            closed={building.closed}
            unknown={building.unknown}
          />
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">
          {t("buildings.recentActivity")}
        </h2>
        <CommandTrendChart commands={buildingCommands} />
      </Card>

      <Card>
        <h2 className="border-b border-hairline px-5 py-3.5 text-sm font-semibold text-ink">
          {t("buildings.units")}
        </h2>
        {units.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-ink-3">
            {t("buildings.noUnits")}
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {units.map((unit) => {
              const unitValves = valves.filter((v) => v.unitId === unit.id);
              const open = unitValves.filter((v) => v.lastStatus === "open").length;
              const closed = unitValves.filter((v) => v.lastStatus === "closed").length;
              const unknown = unitValves.length - open - closed;
              return (
                <li key={unit.id}>
                  <Link
                    href={`/buildings/unit?building=${building.id}&unit=${unit.id}`}
                    className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hairline/30"
                  >
                    <div className="min-w-32 flex-1">
                      <div className="font-medium text-ink">{unit.name}</div>
                      <div className="text-xs text-ink-3">
                        {t("dashboard.valveCount", { count: unitValves.length })}
                      </div>
                    </div>
                    <div className="w-40 shrink-0">
                      <ValveStatusBar open={open} closed={closed} unknown={unknown} size="sm" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {isAdmin && <AddUnitForm buildingId={building.id} onAdded={load} />}
      </Card>
    </div>
  );
}

function AddUnitForm({
  buildingId,
  onAdded,
}: {
  buildingId: number;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.units.create(buildingId, name.trim());
    setName("");
    onAdded();
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 border-t border-hairline p-4">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("buildings.unitName")}
        className="min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand"
        required
      />
      <Button type="submit" className="!px-3 !py-1.5 !text-xs">
        {t("buildings.addUnit")}
      </Button>
    </form>
  );
}
