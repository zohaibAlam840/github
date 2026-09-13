"use client";

/*
 * All units in one building — the page the detail screen's summary links to.
 *
 * The detail screen shows the first six and stops. This is where the rest
 * live: searchable, paginated, and rendered as cards rather than a table,
 * because the thing an operator actually scans for is a unit's valve
 * status, not a grid of text.
 *
 * Query params, not a dynamic segment — same reason as every other screen
 * here (see buildings/page.tsx).
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import type { Building, Unit, Valve } from "@/lib/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Button, Card } from "@/components/ui";
import { ValveStatusBar } from "@/components/charts/ValveStatusBar";
import { IconSearch } from "@/components/icons";

/** Cards per page. Three rows of four on a wide screen. */
const PAGE_SIZE = 12;

export default function AllUnitsPage() {
  return (
    <Suspense fallback={null}>
      <AllUnitsScreen />
    </Suspense>
  );
}

function AllUnitsScreen() {
  const { t } = useTranslation();
  const buildingId = Number(useSearchParams().get("building"));

  const [building, setBuilding] = useState<Building | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [valves, setValves] = useState<Valve[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const [buildings, u, v] = await Promise.all([
      api.buildings.list(),
      api.units.listByBuilding(buildingId),
      api.valves.listByBuilding(buildingId),
    ]);
    setBuilding(buildings.find((b) => b.id === buildingId) ?? null);
    setUnits(u);
    setValves(v);
  }, [buildingId]);

  useEffect(() => {
    if (!Number.isNaN(buildingId)) void load();
  }, [buildingId, load]);

  useEffect(() => {
    const reload = debounce(() => void load(), 250);
    const offs = [onAppEvent("valve:update", reload), onAppEvent("command:update", reload)];
    return () => {
      reload.cancel();
      offs.forEach((off) => off());
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? units.filter((u) => u.name.toLowerCase().includes(q)) : units;
  }, [units, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // A filter that shortens the list can strand you past the last page.
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  if (!building) return null;

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: t("nav.buildings"), href: "/buildings" },
          { label: building.name, href: `/buildings/detail?id=${building.id}` },
          { label: t("buildings.units") },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-ink">{building.name}</h1>
        <span className="text-sm text-ink-3">
          {t("dashboard.unitCount", { count: units.length })}
        </span>
        <div className="relative ms-auto min-w-56 flex-1 sm:max-w-xs">
          <IconSearch
            size={15}
            className="pointer-events-none absolute inset-y-0 start-3 my-auto text-ink-3"
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("buildings.searchUnits")}
            className="w-full rounded-lg border border-edge bg-surface py-2 pe-3 ps-9 text-sm text-ink outline-none focus:border-brand"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-3">
          {search ? t("buildings.noUnitsMatch") : t("buildings.noUnits")}
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((unit) => {
            const unitValves = valves.filter((v) => v.unitId === unit.id);
            const on = unitValves.filter((v) => v.lastStatus === "on").length;
            const off = unitValves.filter((v) => v.lastStatus === "off").length;
            const unknown = unitValves.length - on - off;
            return (
              <Link
                key={unit.id}
                href={`/buildings/unit?building=${building.id}&unit=${unit.id}`}
                /* Lift on hover so a card reads as something you can open. */
                className="group rounded-xl border border-edge bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md focus-visible:border-brand focus-visible:outline-none"
              >
                <div className="mb-1 font-medium text-ink group-hover:text-brand">
                  {unit.name}
                </div>
                <div className="mb-3 text-xs text-ink-3">
                  {t("dashboard.valveCount", { count: unitValves.length })}
                </div>
                <ValveStatusBar open={on} closed={off} unknown={unknown} size="sm" />
              </Link>
            );
          })}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            className="!px-3 !py-1.5 !text-xs"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            {t("common.previous")}
          </Button>
          <span className="text-xs tabular-nums text-ink-3">
            {t("common.pageOf", { page: current, total: pageCount })}
          </span>
          <Button
            variant="ghost"
            className="!px-3 !py-1.5 !text-xs"
            disabled={current === pageCount}
            onClick={() => setPage(current + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
