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

import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import {
  applyFilters,
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
import { IconChevronDown, IconLogs } from "@/components/icons";

const STATUSES: CommandStatus[] = [
  "pending",
  "sent",
  "success",
  "failed",
  "no_response",
  "unconfirmed",
  "cancelled",
];

export default function LogsPage() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<CommandLog[]>([]);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    const load = () => void api.commands.list(500).then(setRows);
    load();
    // Debounced — see queue/page.tsx's comment on why: a bulk send can fire
    // thousands of command:update events, and this fetches 500 rows each time.
    const reload = debounce(load, 250);
    const off = onAppEvent("command:update", reload);
    return () => {
      reload.cancel();
      off();
    };
  }, []);

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);

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
      "user", "retries",
    ];
    const escape = (v: string | number | null) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = filtered.map((r) =>
      [
        r.id, r.createdAt, r.buildingName, r.unitName, r.valveCode, r.gatewayLabel,
        r.simNumber, r.action, r.commandText, r.status, r.sentAt,
        r.replyText, r.replyAt, r.userName, r.retries,
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
                  <th className="px-4 py-2.5 text-start font-medium">{t("queue.reply")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("logs.user")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filtered.map((r) => {
                  const hasEvents = (r.events?.length ?? 0) > 0;
                  const expanded = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        className={hasEvents ? "cursor-pointer" : undefined}
                        onClick={() =>
                          hasEvents && setExpandedId(expanded ? null : r.id)
                        }
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
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-3">
                          {r.replyText ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">{r.userName}</td>
                      </tr>
                      {expanded && hasEvents && (
                        <tr className="bg-hairline/20">
                          <td />
                          <td colSpan={10} className="px-4 py-3">
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
      </Card>
    </div>
  );
}
