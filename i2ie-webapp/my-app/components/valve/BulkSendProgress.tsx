"use client";

/*
 * Per-valve progress for a bulk send.
 *
 * A single aggregate bar ("1 of 2 finished") tells an operator almost
 * nothing useful: not which valve is being sent to, not which ones already
 * failed, and not whether a whole gateway has been given up on. On a
 * building with twenty valves and one dead TRB that is the difference
 * between "something is wrong somewhere" and "TRB-MANSOURA-1 stopped
 * answering, these six were skipped".
 *
 * So this mirrors what the single-valve modal shows, once per valve, live:
 * the queue sends strictly one at a time (one modem, one lane), which is
 * exactly the order shown here.
 *
 * Everything is driven by the same command:update / queue:update events the
 * rest of the app uses — no polling, and no separate progress endpoint that
 * could disagree with the audit log.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { onAppEvent } from "@/lib/socket";
import type { Command, CommandStatus } from "@/lib/types";
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconSkip,
  IconSpinner,
  IconX,
} from "@/components/icons";

/** A command is finished when it is no longer waiting on the modem. */
function isSettled(status: CommandStatus): boolean {
  return status !== "pending" && status !== "sent";
}

function StatusMark({ status, active }: { status: CommandStatus; active: boolean }) {
  if (active || status === "sent") return <IconSpinner size={14} className="text-brand" />;
  switch (status) {
    case "success":
      return <IconCheck size={14} className="text-good" />;
    case "unconfirmed":
      // Sent, deliberately unverified. Not the same green as a confirmed
      // reply — see StatusChip for the same rule.
      return <IconCheck size={14} className="text-brand" />;
    case "failed":
      return <IconX size={14} className="text-critical" />;
    case "no_response":
      return <IconClock size={14} className="text-serious" />;
    case "skipped":
      return <IconSkip size={14} className="text-ink-3" />;
    case "cancelled":
      return <IconX size={14} className="text-ink-3" />;
    default:
      return <IconClock size={14} className="text-ink-3" />;
  }
}

export function BulkSendProgress({
  commands,
  labelFor,
  onAllSettled,
}: {
  /** The commands returned by the bulk queue call, in send order. */
  commands: Command[];
  labelFor: (valveId: number) => string;
  onAllSettled?: () => void;
}) {
  const { t } = useTranslation();

  // Keyed by command id so an update replaces rather than appends, and the
  // original send ORDER is preserved from the prop.
  const [live, setLive] = useState<Map<number, Command>>(
    () => new Map(commands.map((c) => [c.id, c]))
  );
  const [processingId, setProcessingId] = useState<number | null>(null);
  const settledNotified = useRef(false);
  const activeRow = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    setLive(new Map(commands.map((c) => [c.id, c])));
    settledNotified.current = false;
  }, [commands]);

  useEffect(() => {
    const ids = new Set(commands.map((c) => c.id));
    const offs = [
      onAppEvent("command:update", ({ command }) => {
        if (!ids.has(command.id)) return;
        setLive((prev) => new Map(prev).set(command.id, command));
      }),
      // Which command the single lane is actually working on right now.
      onAppEvent("queue:update", (p) => setProcessingId(p.processingId)),
    ];
    return () => offs.forEach((off) => off());
  }, [commands]);

  const rows = useMemo(
    () => commands.map((c) => live.get(c.id) ?? c),
    [commands, live]
  );

  const counts = useMemo(() => {
    const c = { done: 0, success: 0, unconfirmed: 0, failed: 0, skipped: 0, noReply: 0 };
    for (const r of rows) {
      if (!isSettled(r.status)) continue;
      c.done++;
      if (r.status === "success") c.success++;
      else if (r.status === "unconfirmed") c.unconfirmed++;
      else if (r.status === "skipped") c.skipped++;
      else if (r.status === "no_response") c.noReply++;
      else c.failed++;
    }
    return c;
  }, [rows]);

  const total = rows.length;
  const allDone = total > 0 && counts.done === total;

  useEffect(() => {
    if (allDone && !settledNotified.current) {
      settledNotified.current = true;
      onAllSettled?.();
    }
  }, [allDone, onAllSettled]);

  // Keep the valve being sent to in view without dragging the whole page.
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [processingId]);

  if (total === 0) return null;

  const current = rows.find((r) => r.id === processingId && !isSettled(r.status));
  const pct = Math.round((counts.done / total) * 100);

  return (
    <div className="mt-4 rounded-xl border border-edge">
      {/* Headline: the one line someone glances at. */}
      <div className="border-b border-hairline px-4 py-3">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <span className="font-medium text-ink-2">
            {allDone
              ? t("bulk.finished", { count: total })
              : current
                ? t("bulk.sendingTo", { valve: labelFor(current.valveId) })
                : t("bulk.waitingForLane")}
          </span>
          <span className="tabular-nums text-ink-3">
            {t("buildings.sendAllProgress", { done: counts.done, total })} · {pct}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-hairline">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              allDone && (counts.failed || counts.skipped) ? "bg-warn" : "bg-brand"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* One row per valve, in the order the modem will actually send them. */}
      <ul className="max-h-64 divide-y divide-hairline overflow-y-auto">
        {rows.map((r) => {
          const active = r.id === processingId && !isSettled(r.status);
          const lastEvent = r.events?.at(-1)?.message;
          return (
            <li
              key={r.id}
              ref={active ? activeRow : undefined}
              className={`flex items-start gap-2.5 px-4 py-2 text-xs ${
                active ? "bg-brand/5" : ""
              }`}
            >
              <span className="mt-0.5 shrink-0">
                <StatusMark status={r.status} active={active} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{labelFor(r.valveId)}</span>
                {/* The worker's own words. Far more use than a status word:
                    "SMS rejected (code 500)" tells you what to go and fix. */}
                {lastEvent && (
                  <span className="block truncate text-ink-3" title={lastEvent}>
                    {lastEvent}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-ink-3">{t(`status.${r.status}`)}</span>
            </li>
          );
        })}
      </ul>

      {/* Outcome summary — only once there is something to summarise. */}
      {allDone && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline px-4 py-2.5 text-xs">
          {counts.success > 0 && (
            <span className="text-good">{t("bulk.nConfirmed", { count: counts.success })}</span>
          )}
          {counts.unconfirmed > 0 && (
            <span className="text-brand">{t("bulk.nSent", { count: counts.unconfirmed })}</span>
          )}
          {counts.noReply > 0 && (
            <span className="text-serious">{t("bulk.nNoReply", { count: counts.noReply })}</span>
          )}
          {counts.failed > 0 && (
            <span className="text-critical">{t("bulk.nFailed", { count: counts.failed })}</span>
          )}
          {counts.skipped > 0 && (
            <span className="inline-flex items-center gap-1 text-ink-2">
              <IconAlert size={12} className="text-warn" />
              {t("bulk.nSkipped", { count: counts.skipped })}
              {/* Skipped means a gateway was given up on, and that is raised
                  on Alerts — so point straight at it rather than making
                  someone go looking. */}
              <Link href="/alerts" className="font-medium text-brand hover:underline">
                {t("bulk.viewAlerts")}
              </Link>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
