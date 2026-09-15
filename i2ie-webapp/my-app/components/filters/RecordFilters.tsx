"use client";

/*
 * The filter bar shared by Logs, the Command Queue and Alerts.
 *
 * These three screens answer the same question — "show me what happened,
 * narrowed down" — and were drifting apart: Logs had search, status and
 * building; the other two had nothing. Three separate implementations of
 * the same idea is three places for them to disagree, so this is one
 * component and one filtering function.
 *
 * Every control is optional. A screen shows only the axes that mean
 * something there, and an axis with nothing to choose from hides itself
 * rather than offering an empty dropdown.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CommandLog, CommandStatus } from "@/lib/types";
import { IconSearch, IconX } from "@/components/icons";

/** Which named window of time the date filter is on. */
export type DatePreset = "all" | "today" | "7d" | "30d" | "custom";

export interface FilterState {
  search: string;
  status: CommandStatus | "all";
  buildingId: number | "all";
  gatewayId: number | "all";
  datePreset: DatePreset;
  /** Only meaningful when datePreset is "custom". Plain YYYY-MM-DD. */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: FilterState = {
  search: "",
  status: "all",
  buildingId: "all",
  gatewayId: "all",
  datePreset: "all",
  from: "",
  to: "",
};

/** True when anything is actually narrowing the list — drives the Clear button. */
export function isFiltering(f: FilterState): boolean {
  return (
    f.search.trim() !== "" ||
    f.status !== "all" ||
    f.buildingId !== "all" ||
    f.gatewayId !== "all" ||
    f.datePreset !== "all"
  );
}

/**
 * Resolves the date filter to an inclusive [start, end) pair of timestamps.
 *
 * Built from the LOCAL day rather than UTC: an operator in Doha asking for
 * "today" means their today. Using UTC here would silently drop the first
 * three hours of every Qatari day.
 */
function dateWindow(f: FilterState): { start: number; end: number } | null {
  if (f.datePreset === "all") return null;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  if (f.datePreset === "today") {
    return { start: startOfToday.getTime(), end: startOfToday.getTime() + 86_400_000 };
  }
  if (f.datePreset === "7d" || f.datePreset === "30d") {
    const days = f.datePreset === "7d" ? 7 : 30;
    return {
      start: startOfToday.getTime() - (days - 1) * 86_400_000,
      end: startOfToday.getTime() + 86_400_000,
    };
  }

  // Custom. Either end may be blank, meaning "open".
  const start = f.from ? new Date(`${f.from}T00:00:00`).getTime() : -Infinity;
  const end = f.to ? new Date(`${f.to}T00:00:00`).getTime() + 86_400_000 : Infinity;
  return { start, end };
}

/**
 * Applies a filter set to command rows.
 *
 * Exported separately from the UI so the Queue, Logs and Alerts screens all
 * narrow their lists by exactly the same rules, and so it can be tested
 * without rendering anything.
 */
export function applyFilters(rows: CommandLog[], f: FilterState): CommandLog[] {
  const needle = f.search.trim().toLowerCase();
  const window = dateWindow(f);

  return rows.filter((r) => {
    if (f.status !== "all" && r.status !== f.status) return false;
    if (f.buildingId !== "all" && r.buildingId !== f.buildingId) return false;
    if (f.gatewayId !== "all" && r.gatewayId !== f.gatewayId) return false;

    if (window) {
      const ts = new Date(r.createdAt).getTime();
      if (Number.isNaN(ts) || ts < window.start || ts >= window.end) return false;
    }

    if (needle) {
      const haystack = [
        r.valveCode,
        r.unitName,
        r.buildingName,
        r.gatewayLabel,
        r.simNumber,
        r.userName,
        r.commandText,
        r.replyText ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}

const STATUSES: (CommandStatus | "all")[] = [
  "all",
  "pending",
  "sent",
  "success",
  "unconfirmed",
  "failed",
  "no_response",
  "cancelled",
];

const SELECT_CLASS =
  "rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand";

export function RecordFilters({
  value,
  onChange,
  rows,
  show = { search: true, status: true, building: true, gateway: true, date: true },
  resultCount,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  /** The unfiltered rows — the dropdowns are built from what is actually present. */
  rows: CommandLog[];
  show?: Partial<Record<"search" | "status" | "building" | "gateway" | "date", boolean>>;
  resultCount?: number;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });

  /*
   * Options come from the data, not from a full fetch of every building and
   * gateway. Offering a filter that can only ever return nothing is worse
   * than not offering it.
   */
  const buildings = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of rows) if (r.buildingId !== null) map.set(r.buildingId, r.buildingName);
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const gateways = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of rows) if (r.gatewayId !== null) map.set(r.gatewayId, r.gatewayLabel);
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {show.search && (
        <label className="relative min-w-48 flex-1">
          <IconSearch
            size={14}
            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={value.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder={t("filters.searchPlaceholder")}
            className="w-full rounded-lg border border-edge bg-surface py-1.5 pe-3 ps-8 text-xs text-ink outline-none focus:border-brand"
          />
        </label>
      )}

      {show.date && (
        <select
          value={value.datePreset}
          onChange={(e) => set({ datePreset: e.target.value as DatePreset })}
          className={SELECT_CLASS}
          aria-label={t("filters.date")}
        >
          {(["all", "today", "7d", "30d", "custom"] as DatePreset[]).map((d) => (
            <option key={d} value={d}>
              {t(`filters.date_${d}`)}
            </option>
          ))}
        </select>
      )}

      {/* The two date boxes appear only for "custom" - always-visible date
          inputs that do nothing under a preset read as broken. */}
      {show.date && value.datePreset === "custom" && (
        <>
          <input
            type="date"
            value={value.from}
            onChange={(e) => set({ from: e.target.value })}
            className={SELECT_CLASS}
            aria-label={t("filters.from")}
          />
          <input
            type="date"
            value={value.to}
            onChange={(e) => set({ to: e.target.value })}
            className={SELECT_CLASS}
            aria-label={t("filters.to")}
          />
        </>
      )}

      {show.building && buildings.length > 1 && (
        <select
          value={String(value.buildingId)}
          onChange={(e) =>
            set({ buildingId: e.target.value === "all" ? "all" : Number(e.target.value) })
          }
          className={SELECT_CLASS}
          aria-label={t("filters.building")}
        >
          <option value="all">{t("filters.allBuildings")}</option>
          {buildings.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      )}

      {show.gateway && gateways.length > 1 && (
        <select
          value={String(value.gatewayId)}
          onChange={(e) =>
            set({ gatewayId: e.target.value === "all" ? "all" : Number(e.target.value) })
          }
          className={SELECT_CLASS}
          aria-label={t("filters.gateway")}
        >
          <option value="all">{t("filters.allGateways")}</option>
          {gateways.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      )}

      {show.status && (
        <select
          value={value.status}
          onChange={(e) => set({ status: e.target.value as CommandStatus | "all" })}
          className={SELECT_CLASS}
          aria-label={t("filters.status")}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? t("filters.allStatuses") : t(`status.${s}`)}
            </option>
          ))}
        </select>
      )}

      {isFiltering(value) && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex items-center gap-1 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-ink-2 hover:text-critical"
        >
          <IconX size={12} />
          {t("filters.clear")}
        </button>
      )}

      {resultCount !== undefined && (
        <span className="ms-auto text-xs text-ink-3">
          {t("filters.showing", { count: resultCount })}
        </span>
      )}
    </div>
  );
}
