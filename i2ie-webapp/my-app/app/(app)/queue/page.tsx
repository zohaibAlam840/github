"use client";

/*
 * Command Queue — watch the single-modem lane work in real time.
 * Every row is one SMS command moving through its lifecycle:
 * pending -> sent -> success | failed | no_response.
 *
 * This screen is the living proof of the system's core guarantee:
 * many commands accepted at once, sent ONE at a time, none lost. The
 * bulk-send panel on the side is the same guarantee under load — queueing
 * a command for hundreds of valves across many buildings doesn't send them
 * in parallel, it just fills this same single lane faster.
 */

import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import { useAuth } from "@/lib/auth";
import type { BuildingStats, CommandAction, CommandLog, Settings } from "@/lib/types";
import { Button, Card, StatusChip } from "@/components/ui";
import { IconChevronDown, IconDrop, IconQueue, IconSend, IconSpinner, IconX } from "@/components/icons";

export default function QueuePage() {
  const { t, i18n } = useTranslation();
  const { canOperate } = useAuth();
  const [rows, setRows] = useState<CommandLog[]>([]);
  const [queued, setQueued] = useState(0);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    void api.commands.list(50).then(setRows);
    // Debounced: a bulk send can fire thousands of command:update events in
    // a burst (one per lifecycle step, per queued valve). Refetching once
    // per event would fire the same number of real HTTP+SQLite round trips
    // — confirmed via stress-testing to exhaust the browser's connection
    // pool (ERR_INSUFFICIENT_RESOURCES) well before 2,000 valves. Collapse
    // any burst into one trailing refetch instead.
    const reload = debounce(() => void api.commands.list(50).then(setRows), 250);
    const offs = [
      onAppEvent("command:update", reload),
      onAppEvent("queue:update", (p) => {
        setQueued(p.queued);
        setProcessingId(p.processingId);
      }),
    ];
    return () => {
      reload.cancel();
      offs.forEach((off) => off());
    };
  }, []);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(
      i18n.language === "ar" ? "ar-QA" : "en-GB",
      { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    );

  return (
    <div className="grid gap-4 xl:grid-cols-4">
      <div className="space-y-4 xl:col-span-3">
        {/* Live lane state */}
        <div className="flex flex-wrap items-center gap-3">
          <Card className="flex items-center gap-2.5 px-4 py-2.5">
            {processingId !== null ? (
              <>
                <IconSpinner size={15} className="text-brand" />
                <span className="text-sm text-ink-2">
                  {t("queue.inFlight")}:{" "}
                  <span className="font-semibold text-ink">#{processingId}</span>
                </span>
              </>
            ) : (
              <>
                <IconQueue size={15} className="text-ink-3" />
                <span className="text-sm text-ink-3">{t("queue.idle")}</span>
              </>
            )}
          </Card>
          <Card className="flex items-center gap-2.5 px-4 py-2.5">
            <span className="text-sm text-ink-2">
              {t("queue.waiting")}:{" "}
              <span className="font-semibold text-ink">{queued}</span>
            </span>
          </Card>
        </div>

        {/* Lifecycle table */}
        <Card>
          {rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-3">
              {t("queue.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-start text-xs text-ink-3">
                    <th className="px-4 py-2.5 text-start font-medium" />
                    <th className="px-4 py-2.5 text-start font-medium">#</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("queue.time")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("queue.valve")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("queue.building")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("queue.action")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("queue.sms")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("queue.statusCol")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("queue.retries")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("queue.reply")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {rows.map((row) => {
                    const hasEvents = (row.events?.length ?? 0) > 0;
                    const inFlight = row.status === "sent";
                    // In-flight commands auto-expand — you shouldn't have to
                    // discover a click target to see what's happening right now.
                    const expanded = inFlight || expandedId === row.id;
                    const latestEvent = row.events?.at(-1);
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className={`${row.id === processingId ? "bg-brand/5" : ""} ${
                            hasEvents ? "cursor-pointer" : ""
                          }`}
                          onClick={() =>
                            hasEvents && setExpandedId(expanded ? null : row.id)
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
                          <td className="px-4 py-2.5 tabular-nums text-ink-3">{row.id}</td>
                          <td className="px-4 py-2.5 tabular-nums text-ink-2">
                            {fmtTime(row.createdAt)}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-ink">
                            {row.valveCode}
                            <span className="block text-xs font-normal text-ink-3">
                              {row.unitName}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-ink-2">{row.buildingName}</td>
                          <td className="px-4 py-2.5 text-ink-2">
                            {t(`action.${row.action}`)}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-ink-3">
                            {row.commandText}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip status={row.status} />
                            {row.status === "sent" && latestEvent && (
                              <span className="mt-0.5 block max-w-56 truncate text-xs text-ink-3">
                                {latestEvent.message}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-ink-2">
                            {row.retries}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-ink-3">
                            {row.replyText ?? "—"}
                          </td>
                        </tr>
                        {expanded && hasEvents && (
                          <tr className="bg-hairline/20">
                            <td />
                            <td colSpan={9} className="px-4 py-3">
                              <ol className="space-y-1">
                                {row.events!.map((evt, i) => (
                                  <li
                                    key={i}
                                    className="flex gap-3 text-xs text-ink-2"
                                  >
                                    <span className="shrink-0 tabular-nums text-ink-3">
                                      {fmtTime(evt.ts)}
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

      {/* Bulk send — same single lane, just filled faster */}
      {canOperate && (
        <div className="xl:col-span-1">
          <BulkSendPanel />
        </div>
      )}
    </div>
  );
}

/* ================= bulk send panel ================= */

function BulkSendPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [buildings, setBuildings] = useState<BuildingStats[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [action, setAction] = useState<CommandAction>("off");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    // Only buildings with at least one valve are worth offering here — an
    // empty building can't receive a command, it would just clutter the list.
    void api.dashboard.buildingStats().then((b) => setBuildings(b.filter((x) => x.valveCount > 0)));
    void api.settings.get().then(setSettings);
  }, []);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const selectedBuildings = buildings.filter((b) => selected.has(b.id));
  const valveCount = selectedBuildings.reduce((sum, b) => sum + b.valveCount, 0);
  const estimateMs = settings ? valveCount * settings.sendGapMs : 0;
  const estimateLabel = formatDuration(estimateMs);

  async function send() {
    if (!user || valveCount === 0) return;
    const confirmed = confirm(
      t("queue.bulkConfirm", {
        count: valveCount,
        action: t(`action.${action}`),
        buildings: selectedBuildings.length,
        time: estimateLabel,
      })
    );
    if (!confirmed) return;

    setSending(true);
    setResult(null);
    try {
      // Gather every valve id across the selected buildings, then one bulk
      // call — still lands in the same single-lane queue, paced the same.
      const valveLists = await Promise.all(
        selectedBuildings.map((b) => api.valves.listByBuilding(b.id))
      );
      const valveIds = valveLists.flat().map((v) => v.id);
      const queuedCommands = await api.valves.queueBulkCommand(valveIds, action);
      setResult(t("queue.bulkQueued", { count: queuedCommands.length }));
      setSelected(new Set());
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="sticky top-4 p-4">
      <h2 className="mb-1 text-sm font-semibold text-ink">{t("queue.bulkSend")}</h2>
      <p className="mb-3 text-xs leading-relaxed text-ink-3">{t("queue.bulkHint")}</p>

      <div className="mb-3 space-y-1">
        {buildings.length === 0 ? (
          <p className="text-xs text-ink-3">{t("queue.bulkNoBuildings")}</p>
        ) : (
          buildings.map((b) => (
            <label
              key={b.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-hairline/30"
            >
              <input
                type="checkbox"
                checked={selected.has(b.id)}
                onChange={() => toggle(b.id)}
                className="accent-brand"
              />
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              <span className="shrink-0 text-xs text-ink-3">
                {t("dashboard.valveCount", { count: b.valveCount })}
              </span>
            </label>
          ))
        )}
      </div>

      <div className="mb-3 flex gap-1.5">
        <Button
          variant={action === "on" ? "primary" : "ghost"}
          className="!flex-1 !px-2 !py-1.5 !text-xs"
          onClick={() => setAction("on")}
        >
          <IconDrop size={13} />
          {t("action.on")}
        </Button>
        <Button
          variant={action === "off" ? "primary" : "ghost"}
          className="!flex-1 !px-2 !py-1.5 !text-xs"
          onClick={() => setAction("off")}
        >
          <IconX size={13} />
          {t("action.off")}
        </Button>
        <Button
          variant={action === "status" ? "primary" : "ghost"}
          className="!flex-1 !px-2 !py-1.5 !text-xs"
          onClick={() => setAction("status")}
        >
          <IconSend size={13} />
          {t("buildings.refresh")}
        </Button>
      </div>

      {valveCount > 0 && (
        <p className="mb-3 text-xs text-ink-3">
          {t("queue.bulkEstimate", { count: valveCount, time: estimateLabel })}
        </p>
      )}

      {result && (
        <p className="mb-3 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-xs text-good-text">
          {result}
        </p>
      )}

      <Button
        className="w-full"
        disabled={valveCount === 0 || sending}
        onClick={send}
      >
        {sending ? <IconSpinner size={14} /> : null}
        {t("queue.bulkSendButton")}
      </Button>
    </Card>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}
