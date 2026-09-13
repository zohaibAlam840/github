"use client";

/*
 * Buildings — the portfolio list. Each card links out to its own detail
 * page (/buildings/detail?id=) rather than expanding inline — a real,
 * bookmarkable drill-down instead of a master-detail split. Static export
 * has no server-side dynamic routing for client-generated ids, so detail
 * pages address their subject via a query param, not a path segment.
 *
 * Search reaches one level deeper than the card grid shows: typing an
 * apartment/unit name surfaces a direct-link results list above the grid,
 * so finding "Apartment 402" doesn't require opening its building first.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import { useAuth } from "@/lib/auth";
import type { BuildingStats, Unit } from "@/lib/types";
import { Button, Card, Modal } from "@/components/ui";
import { ValveStatusBar } from "@/components/charts/ValveStatusBar";
import { IconBuilding, IconPlus, IconSearch, IconX } from "@/components/icons";

type StatusFilter = "all" | "open" | "closed" | "unknown";

export default function BuildingsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [buildings, setBuildings] = useState<BuildingStats[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    const [b, u] = await Promise.all([api.dashboard.buildingStats(), api.units.list()]);
    setBuildings(b);
    setUnits(u);
  }, []);

  useEffect(() => {
    void load();
    // Debounced — see queue/page.tsx's comment: a bulk send can fire
    // thousands of valve:update events in a burst.
    const reload = debounce(() => void load(), 250);
    const off = onAppEvent("valve:update", reload);
    return () => {
      reload.cancel();
      off();
    };
  }, [load]);

  const q = search.trim().toLowerCase();

  const matchingUnits = useMemo(() => {
    if (!q) return [];
    return units
      .filter((u) => u.name.toLowerCase().includes(q))
      .map((u) => ({ unit: u, building: buildings.find((b) => b.id === u.buildingId) }))
      .filter((x): x is { unit: Unit; building: BuildingStats } => !!x.building);
  }, [q, units, buildings]);

  const filteredBuildings = useMemo(() => {
    return buildings.filter((b) => {
      if (statusFilter === "open" && b.open === 0) return false;
      if (statusFilter === "closed" && b.closed === 0) return false;
      if (statusFilter === "unknown" && b.unknown === 0) return false;
      if (!q) return true;
      if (b.name.toLowerCase().includes(q)) return true;
      if (b.address?.toLowerCase().includes(q)) return true;
      return units.some((u) => u.buildingId === b.id && u.name.toLowerCase().includes(q));
    });
  }, [buildings, units, q, statusFilter]);

  const inputCls =
    "rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <IconSearch
            size={14}
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("buildings.search")}
            className={`${inputCls} w-full ps-9`}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={inputCls}
        >
          <option value="all">{t("buildings.allStatuses")}</option>
          <option value="open">{t("buildings.filterOpen")}</option>
          <option value="closed">{t("buildings.filterClosed")}</option>
          <option value="unknown">{t("buildings.filterUnknown")}</option>
        </select>
        <span className="text-xs text-ink-3">
          {t("buildings.count", { count: filteredBuildings.length })}
        </span>
        {isAdmin && (
          <Button className="ms-auto !px-3 !py-1.5 !text-xs" onClick={() => setAddOpen(true)}>
            <IconPlus size={14} />
            {t("buildings.addBuilding")}
          </Button>
        )}
      </div>

      {matchingUnits.length > 0 && (
        <Card>
          <h2 className="border-b border-hairline px-5 py-3 text-sm font-semibold text-ink">
            {t("buildings.matchingApartments", { count: matchingUnits.length })}
          </h2>
          <ul className="divide-y divide-hairline">
            {matchingUnits.map(({ unit, building }) => (
              <li key={unit.id}>
                <Link
                  href={`/buildings/unit?building=${building.id}&unit=${unit.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-hairline/30"
                >
                  <span className="font-medium text-ink">{unit.name}</span>
                  <span className="text-xs text-ink-3">{building.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {filteredBuildings.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">
          {t(buildings.length === 0 ? "buildings.noBuildingsYet" : "buildings.noResults")}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredBuildings.map((b) => (
            <Link key={b.id} href={`/buildings/detail?id=${b.id}`} className="group">
              <Card className="h-full p-5 transition-colors group-hover:border-brand/40">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconBuilding size={17} className="shrink-0 text-ink-3" />
                    <div>
                      <div className="font-medium text-ink">{b.name}</div>
                      {b.address && (
                        <div className="text-xs text-ink-3">{b.address}</div>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={async (e) => {
                        e.preventDefault();
                        if (confirm(t("buildings.confirmDeleteBuilding"))) {
                          await api.buildings.remove(b.id);
                          void load();
                        }
                      }}
                      className="shrink-0 rounded p-1 text-ink-3 hover:text-critical"
                      title={t("buildings.delete")}
                    >
                      <IconX size={14} />
                    </button>
                  )}
                </div>
                <div className="mb-3 text-xs text-ink-3">
                  {t("dashboard.unitCount", { count: b.unitCount })} ·{" "}
                  {t("dashboard.valveCount", { count: b.valveCount })}
                </div>
                <ValveStatusBar open={b.open} closed={b.closed} unknown={b.unknown} size="sm" />
              </Card>
            </Link>
          ))}
        </div>
      )}

      {isAdmin && (
        <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t("buildings.addBuilding")}>
          <AddBuildingForm
            onAdded={() => {
              void load();
              setAddOpen(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function AddBuildingForm({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.buildings.create(name.trim(), address.trim());
    setName("");
    setAddress("");
    onAdded();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("buildings.name")}
        className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand"
        autoFocus
        required
      />
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder={t("buildings.address")}
        className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand"
      />
      <Button type="submit" className="w-full">
        {t("buildings.add")}
      </Button>
    </form>
  );
}
