"use client";

/*
 * Logs — the audit trail (every command = one SMS = one row).
 * Client-side filters + CSV export. The export includes every field the
 * client requires: date/time, building, unit, valve, SIM, action, SMS
 * text, status, reply, user, retries.
 *
 * CSV note: prefixed with a UTF-8 BOM so Excel opens Arabic text
 * correctly. Archive-and-clear arrives with the real backend.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import {
  applyFilters,
  dateWindow,
  EMPTY_FILTERS,
  RecordFilters,
  type FilterState,
} from "@/components/filters/RecordFilters";
import {
  BuildingLink,
  GatewayLink,
  ValveLink,
} from "@/components/filters/RecordLinks";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import type { CommandLog, CommandStatus } from "@/lib/types";
import { Button, Card, StatusChip } from "@/components/ui";
import { IconAlert, IconChevronDown, IconLogs, IconSpinner } from "@/components/icons";

const STATUSES: CommandStatus[] = [
  "pending",
  "sent",
  "success",
  "failed",
  "no_response",
  "unconfirmed",
  "cancelled",
];

/**
 * How many rows one request fetches. Big enough that scrolling rarely
 * hits the bottom, small enough that the default view stays light on a
 * table with years of history in it.
 */
const PAGE_SIZE = 200;

/**
 * The one-line reason a command ended the way it did, or null when there
 * is nothing worth saying.
 *
 * Deliberately silent for commands that simply worked: a reason on every
 * row is noise, and noise is what buries the rows that matter. The text is
 * the worker's last event — its own words about what actually happened,
 * rather than a phrase this screen invents from a status code.
 */
function reasonFor(r: CommandLog): string | null {
  if (r.status === "success" || r.status === "pending" || r.status === "sent") return null;
  return r.events?.at(-1)?.message ?? null;
}

export default function LogsPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [rows, setRows] = useState<CommandLog[]>([]);
  /*
   * The log opens on the last 30 days, not on everything.
   *
   * This screen used to pull a flat 500 newest rows regardless of filter,
   * which had two faults at once: it grew heavier forever as the table
   * grew, and anything past row 500 could not be reached at all — setting
   * a date filter only discarded rows the browser had already been sent.
   *
   * Now the date window goes to SQL. The default keeps the common case
   * small, and older history is reached by widening the filter, which
   * fetches it rather than filtering a cap.
   */
  const [filters, setFilters] = useState<FilterState>({
    ...EMPTY_FILTERS,
    datePreset: "30d",
  });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  /** The filter's start, as the ISO timestamp the API filters on. */
  const since = useMemo(() => {
    const w = dateWindow(filters);
    return w && Number.isFinite(w.start) ? new Date(w.start).toISOString() : undefined;
  }, [filters.datePreset, filters.from, filters.to]);

  /*
   * How many rows are on screen, as a ref so the live-update handler can
   * refresh exactly that many without being re-created (and re-subscribed)
   * on every single row change.
   */
  const loadedCount = useRef(0);
  loadedCount.current = rows.length;

  const fetchPage = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const page = await api.commands.page({ limit: PAGE_SIZE, offset, since });
        setTotal(page.total);
        setRows((prev) => (offset === 0 ? page.rows : [...prev, ...page.rows]));
      } finally {
        setLoading(false);
      }
    },
    [since]
  );

  // First page, and again whenever the date window changes.
  useEffect(() => {
    void fetchPage(0);
  }, [fetchPage]);

  useEffect(() => {
    /*
     * Live updates refresh everything currently on screen in one query,
     * rather than page 0 only — otherwise a status landing on a row the
     * operator had scrolled down to load would never appear.
     */
    const reload = debounce(() => {
      void api.commands
        .page({ limit: Math.max(PAGE_SIZE, loadedCount.current), offset: 0, since })
        .then((page) => {
          setTotal(page.total);
          setRows(page.rows);
        });
    }, 250);
    const off = onAppEvent("command:update", reload);
    return () => {
      reload.cancel();
      off();
    };
  }, [since]);

  /*
   * "Show problems only".
   *
   * The log is dominated by commands that worked, which is exactly what
   * makes the handful that did not hard to find — and those are the only
   * rows anyone opens this screen to read. A row counts as a problem if it
   * ended badly OR needed a retry to get there: a command that succeeded on
   * its second attempt is still telling you something about that gateway.
   */
  const [problemsOnly, setProblemsOnly] = useState(false);
  const filtered = useMemo(() => {
    const base = applyFilters(rows, filters);
    if (!problemsOnly) return base;
    return base.filter(
      (r) =>
        r.retries > 0 ||
        r.status === "failed" ||
        r.status === "no_response" ||
        r.status === "skipped" ||
        r.status === "unconfirmed"
    );
  }, [rows, filters, problemsOnly]);

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(
          i18n.language === "ar" ? "ar-QA" : "en-GB",
          { dateStyle: "short", timeStyle: "medium" }
        )
      : "—";

  function exportCsv() {
    const headers = [
      "id", "created_at", "building", "unit", "valve", "gateway", "sim_number",
      "action", "sms_text", "status", "sent_at", "reply", "reply_at",
      "user", "retries", "reason",
    ];
    const escape = (v: string | number | null) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = filtered.map((r) =>
      [
        r.id, r.createdAt, r.buildingName, r.unitName, r.valveCode, r.gatewayLabel,
        r.simNumber, r.action, r.commandText, r.status, r.sentAt,
        r.replyText, r.replyAt, r.userName, r.retries, reasonFor(r),
      ]
        .map(escape)
        .join(",")
    );
    // ﻿ = UTF-8 BOM -> Excel renders Arabic correctly.
    const blob = new Blob(["﻿" + [headers.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `i2i-logs-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const inputCls =
    "rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand";

  return (
    <div className="space-y-4">
      {/* One filter bar, shared with the Queue and Alerts screens. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <RecordFilters
            value={filters}
            onChange={setFilters}
            rows={rows}
            resultCount={filtered.length}
          />
        </div>
        <Button
          variant={problemsOnly ? "primary" : "ghost"}
          className="!px-3 !py-1.5 !text-xs"
          onClick={() => setProblemsOnly((v) => !v)}
        >
          <IconAlert size={13} />
          {t("logs.problemsOnly")}
        </Button>
        <Button
          variant="ghost"
          className="!px-3 !py-1.5 !text-xs"
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          <IconLogs size={13} />
          {t("logs.exportCsv")}
        </Button>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-3">
            {t("logs.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-ink-3">
                  <th className="px-4 py-2.5 text-start font-medium" />
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.time")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.building")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("logs.unit")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.valve")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("gateways.sim")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.action")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.sms")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.statusCol")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("logs.retries")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.reply")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("logs.user")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filtered.map((r) => {
                  const hasEvents = (r.events?.length ?? 0) > 0;
                  const reason = reasonFor(r);
                  const expanded = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        /*
                          Two different intents on one row, so they get two
                          different targets: the chevron peeks at the trail
                          without leaving the table, the row itself opens
                          the command — where the full trail lives and where
                          it can be sent again.
                        */
                        className="cursor-pointer hover:bg-hairline/20"
                        onClick={() => router.push(`/logs/detail?id=${r.id}`)}
                      >
                        <td
                          className="px-2 py-2.5 text-ink-3"
                          onClick={(e) => {
                            // Expanding is not navigating.
                            e.stopPropagation();
                            if (hasEvents) setExpandedId(expanded ? null : r.id);
                          }}
                        >
                          {hasEvents && (
                            <IconChevronDown
                              size={13}
                              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                            />
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-xs text-ink-2">
                          {fmt(r.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">
                          <BuildingLink
                            buildingId={r.buildingId}
                            buildingName={r.buildingName}
                          />
                          <span className="block text-xs text-ink-3">
                            <GatewayLink
                              gatewayId={r.gatewayId}
                              gatewayLabel={r.gatewayLabel}
                              className="text-ink-3 hover:text-brand hover:underline"
                            />
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">{r.unitName}</td>
                        <td className="px-4 py-2.5 font-medium text-ink">
                          <ValveLink
                            valveId={r.valveId}
                            unitId={r.unitId}
                            buildingId={r.buildingId}
                            valveCode={r.valveCode}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-3" dir="ltr">
                          {r.simNumber}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">{t(`action.${r.action}`)}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-3">{r.commandText}</td>
                        <td className="px-4 py-2.5">
                          <StatusChip status={r.status} />
                          {/*
                            WHY it ended that way, under the chip.

                            "Failed" on its own is not error handling — it
                            tells an operator that something went wrong and
                            nothing about what to do next. The worker's own
                            words ("SMS rejected (code 500)", "No reply from
                            TRB within 7s", "Gateway unreachable — skipped")
                            were already recorded, but only inside the
                            expandable trail, so finding them meant opening
                            rows one at a time.

                            Under the chip rather than in a twelfth column:
                            this table already scrolls sideways, and the
                            reason belongs next to the verdict anyway.
                          */}
                          {reason && (
                            <span
                              className="mt-1 block max-w-56 truncate text-[11px] text-ink-3"
                              title={reason}
                            >
                              {reason}
                            </span>
                            )}
                        </td>
                        {/*
                          Retries were already being collected and already
                          went out in the CSV — they were simply never shown
                          on screen, so the one number that says "this
                          gateway is flaky rather than dead" was invisible
                          unless you exported the file. A plain dash for
                          zero keeps the column quiet until it matters.
                        */}
                        <td className="px-4 py-2.5 tabular-nums text-xs">
                          {r.retries > 0 ? (
                            <span
                              className="rounded-full bg-warn/15 px-2 py-0.5 font-medium text-ink-2"
                              title={t("logs.retriesHint")}
                            >
                              {r.retries}
                            </span>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-3">
                          {r.replyText ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">{r.userName}</td>
                      </tr>
                      {expanded && hasEvents && (
                        <tr className="bg-hairline/20">
                          <td />
                          <td colSpan={11} className="px-4 py-3">
                            <ol className="space-y-1">
                              {r.events!.map((evt, i) => (
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

        {/*
          Count first, button second.

          "Showing 200 of 4,312" is the part that matters: without it an
          operator reading a filtered log has no way to know whether they
          are looking at the whole answer or the first page of it, which is
          exactly the kind of quiet half-truth this project avoids
          elsewhere. The button only appears when there is genuinely more.
        */}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-3">
            <span className="text-xs text-ink-3">
              {t("logs.showingOf", { shown: rows.length, total })}
            </span>
            {rows.length < total && (
              <Button
                variant="ghost"
                className="!px-3 !py-1.5 !text-xs"
                disabled={loading}
                onClick={() => void fetchPage(rows.length)}
              >
                {loading ? <IconSpinner size={13} /> : null}
                {t("logs.loadMore", { count: Math.min(PAGE_SIZE, total - rows.length) })}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
