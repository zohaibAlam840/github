"use client";

/*
 * CommandTrendChart — daily command volume by outcome, last N days.
 * Job: "trend over time" + "tell distinct series apart" -> stacked column,
 * status colors (these ARE status values, not generic categories, so they
 * reuse the app's reserved status palette rather than a categorical one).
 * Per-bar hover/focus tooltip (mark is the hit target, no crosshair — bars
 * don't get one per the dataviz skill), legend always present for 3 series.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommandLog } from "@/lib/types";

interface DayBucket {
  date: string; // yyyy-mm-dd
  success: number;
  unconfirmed: number;
  failed: number;
  no_response: number;
}

function bucketByDay(commands: CommandLog[], days: number): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, success: 0, unconfirmed: 0, failed: 0, no_response: 0 });
  }
  for (const c of commands) {
    const key = c.createdAt.slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the window
    if (c.status === "success") bucket.success++;
    else if (c.status === "unconfirmed") bucket.unconfirmed++;
    else if (c.status === "failed") bucket.failed++;
    else if (c.status === "no_response") bucket.no_response++;
  }
  return [...buckets.values()];
}

export function CommandTrendChart({
  commands,
  days = 7,
}: {
  commands: CommandLog[];
  days?: number;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar-QA" : "en-GB";
  const buckets = useMemo(() => bucketByDay(commands, days), [commands, days]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const totalCommands = buckets.reduce(
    (sum, b) => sum + b.success + b.unconfirmed + b.failed + b.no_response,
    0
  );
  const max = Math.max(1, ...buckets.map((b) => b.success + b.unconfirmed + b.failed + b.no_response));

  if (totalCommands === 0) {
    return <p className="text-xs text-ink-3">{t("buildings.noCommandHistory")}</p>;
  }

  return (
    <div>
      {/* Legend — line keys, always present for 4 series */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-good" />
          {t("status.success")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand" />
          {t("status.unconfirmed")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-critical" />
          {t("status.failed")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-serious" />
          {t("status.no_response")}
        </span>
      </div>

      <div className="flex h-28 items-end gap-2">
        {buckets.map((b, i) => {
          const total = b.success + b.unconfirmed + b.failed + b.no_response;
          const heightPct = (total / max) * 100;
          const hovered = hoverIdx === i && total > 0;

          return (
            <div key={b.date} className="relative flex flex-1 flex-col items-center">
              {hovered && (
                <div className="absolute bottom-full z-10 mb-1.5 w-max rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs shadow-lg">
                  <div className="mb-1 font-medium text-ink">
                    {new Date(b.date).toLocaleDateString(locale, {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  {b.success > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-good" />
                      <span className="font-semibold text-ink">{b.success}</span>
                      <span className="text-ink-3">{t("status.success")}</span>
                    </div>
                  )}
                  {b.unconfirmed > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                      <span className="font-semibold text-ink">{b.unconfirmed}</span>
                      <span className="text-ink-3">{t("status.unconfirmed")}</span>
                    </div>
                  )}
                  {b.failed > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-critical" />
                      <span className="font-semibold text-ink">{b.failed}</span>
                      <span className="text-ink-3">{t("status.failed")}</span>
                    </div>
                  )}
                  {b.no_response > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-serious" />
                      <span className="font-semibold text-ink">{b.no_response}</span>
                      <span className="text-ink-3">{t("status.no_response")}</span>
                    </div>
                  )}
                </div>
              )}
              <div
                className={`flex w-full max-w-6 flex-col-reverse gap-0.5 overflow-hidden rounded-t transition-opacity ${
                  hoverIdx !== null && hoverIdx !== i ? "opacity-60" : ""
                }`}
                style={{ height: `${heightPct}%` }}
                onPointerEnter={() => total > 0 && setHoverIdx(i)}
                onPointerLeave={() => setHoverIdx(null)}
                onFocus={() => total > 0 && setHoverIdx(i)}
                onBlur={() => setHoverIdx(null)}
                tabIndex={total > 0 ? 0 : -1}
              >
                {b.success > 0 && <div className="w-full bg-good" style={{ flexGrow: b.success }} />}
                {b.unconfirmed > 0 && <div className="w-full bg-brand" style={{ flexGrow: b.unconfirmed }} />}
                {b.failed > 0 && <div className="w-full bg-critical" style={{ flexGrow: b.failed }} />}
                {b.no_response > 0 && (
                  <div className="w-full bg-serious" style={{ flexGrow: b.no_response }} />
                )}
              </div>
              <span className="mt-1.5 text-[10px] text-ink-3">
                {new Date(b.date).toLocaleDateString(locale, { weekday: "short" })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
