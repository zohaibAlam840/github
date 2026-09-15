"use client";

/*
 * Dashboard — the portfolio at a glance.
 *
 * Live by design: subscribes to the events layer, so valve replies,
 * device pushes and queue movement update the numbers with no refresh.
 * Status is always icon/label + number — color never carries meaning alone.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import type {
  ActivityEvent,
  BuildingStats,
  DashboardSummary,
} from "@/lib/types";
import { Card } from "@/components/ui";
import { ValveStatusBar } from "@/components/charts/ValveStatusBar";
import {
  IconAlert,
  IconBuilding,
  IconCheck,
  IconClock,
  IconDrop,
  IconQueue,
  IconRadio,
  IconSend,
  IconValve,
  IconX,
  IconSkip,
} from "@/components/icons";

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [buildings, setBuildings] = useState<BuildingStats[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);

  const refresh = useCallback(async () => {
    const [s, b] = await Promise.all([
      api.dashboard.summary(),
      api.dashboard.buildingStats(),
    ]);
    setSummary(s);
    setBuildings(b);
  }, []);

  // Initial load + live updates.
  useEffect(() => {
    void refresh();
    void api.dashboard.activity().then(setFeed);
    // Debounced — see queue/page.tsx's comment: a bulk send can fire
    // thousands of valve:update/command:update events in a burst.
    const debouncedRefresh = debounce(() => void refresh(), 250);
    const offs = [
      onAppEvent("valve:update", debouncedRefresh),
      onAppEvent("command:update", debouncedRefresh),
      onAppEvent("activity", ({ event }) =>
        setFeed((prev) => [event, ...prev].slice(0, 30))
      ),
    ];
    return () => {
      debouncedRefresh.cancel();
      offs.forEach((off) => off());
    };
  }, [refresh]);

  const tiles = summary
    ? [
        { key: "buildings", value: summary.buildings, icon: <IconBuilding size={16} />, cls: "text-ink-3" },
        { key: "valves", value: summary.valves, icon: <IconValve size={16} />, cls: "text-ink-3" },
        { key: "openValves", value: summary.open, icon: <IconDrop size={16} />, cls: "text-good" },
        { key: "closedValves", value: summary.closed, icon: <IconX size={16} />, cls: "text-ink-2" },
        { key: "unknownValves", value: summary.unknown, icon: <IconAlert size={16} />, cls: "text-warn" },
        { key: "pendingCommands", value: summary.pendingCommands, icon: <IconQueue size={16} />, cls: "text-brand" },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <Card key={tile.key} className="p-4">
            <div className={`mb-2 flex items-center gap-1.5 text-xs font-medium ${tile.cls}`}>
              {tile.icon}
              <span className="text-ink-3">{t(`dashboard.${tile.key}`)}</span>
            </div>
            <div className="text-3xl font-semibold text-ink">{tile.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Portfolio by building */}
        <Card className="lg:col-span-3">
          <h2 className="border-b border-hairline px-5 py-3.5 text-sm font-semibold text-ink">
            {t("dashboard.byBuilding")}
          </h2>
          <ul className="divide-y divide-hairline">
            {buildings.map((b) => (
              <li key={b.id} className="px-5 py-4">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{b.name}</div>
                    <div className="text-xs text-ink-3">
                      {t("dashboard.unitCount", { count: b.unitCount })} ·{" "}
                      {t("dashboard.valveCount", { count: b.valveCount })}
                    </div>
                  </div>
                  <Link
                    href={`/buildings/detail?id=${b.id}`}
                    className="shrink-0 text-sm font-medium text-brand hover:underline"
                  >
                    {t("dashboard.view")}
                  </Link>
                </div>

                {b.valveCount > 0 && (
                  <ValveStatusBar open={b.open} closed={b.closed} unknown={b.unknown} />
                )}
              </li>
            ))}
          </ul>
        </Card>

        {/* Live activity feed */}
        <Card className="lg:col-span-2">
          <h2 className="border-b border-hairline px-5 py-3.5 text-sm font-semibold text-ink">
            {t("dashboard.liveActivity")}
          </h2>
          {feed.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-3">
              {t("dashboard.noActivity")}
            </p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-hairline overflow-y-auto">
              {feed.map((event) => (
                <FeedRow key={event.id} event={event} locale={i18n.language} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------- one activity row ---------- */

function FeedRow({ event, locale }: { event: ActivityEvent; locale: string }) {
  const { t } = useTranslation();

  const iconByKind = {
    queued: <IconQueue size={14} className="text-ink-3" />,
    sent: <IconSend size={14} className="text-brand" />,
    reply: <IconCheck size={14} className="text-good" />,
    unconfirmed: <IconCheck size={14} className="text-brand" />,
    push: <IconRadio size={14} className="text-brand" />,
    timeout: <IconClock size={14} className="text-serious" />,
    failed: <IconX size={14} className="text-critical" />,
    cancelled: <IconX size={14} className="text-ink-3" />,
    skipped: <IconSkip size={14} className="text-ink-3" />,
    gatewayDown: <IconRadio size={14} className="text-critical" />,
    ping: <IconRadio size={14} className="text-ink-3" />,
  } as const;

  const text = t(`activity.${event.kind}`, {
    user: event.userName ?? "",
    valve: event.valveCode ?? "",
    building: event.buildingName ?? "",
    action: event.action ? t(`action.${event.action}`) : "",
    status: event.valveStatus ? t(`status.${event.valveStatus}`) : "",
  });

  const time = new Date(event.ts).toLocaleTimeString(
    locale === "ar" ? "ar-QA" : "en-GB",
    { hour: "2-digit", minute: "2-digit", second: "2-digit" }
  );

  return (
    <li className="flex items-start gap-2.5 px-5 py-2.5">
      <span className="mt-0.5 shrink-0">{iconByKind[event.kind]}</span>
      <span className="min-w-0 flex-1 text-sm leading-snug text-ink-2">
        {text}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-ink-3">{time}</span>
    </li>
  );
}
