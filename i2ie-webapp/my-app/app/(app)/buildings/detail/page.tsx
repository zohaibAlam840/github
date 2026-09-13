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
import type { BuildingStats, CommandAction, CommandLog, Unit, Valve } from "@/lib/types";
import { Button, Card, StatTile } from "@/components/ui";
import { ValveStatusBar } from "@/components/charts/ValveStatusBar";
import { CommandTrendChart } from "@/components/charts/CommandTrendChart";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconAlert, IconBuilding, IconDrop, IconSend, IconSpinner, IconValve, IconX } from "@/components/icons";

/** How many units the summary shows before sending you to the full list. */
const UNITS_PREVIEW = 6;

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
  const { isAdmin, canOperate } = useAuth();
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
          label={t("status.on")}
          value={building.open}
          icon={<IconDrop size={14} />}
          accent="text-good"
        />
        <StatTile
          label={t("status.off")}
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

      {canOperate && building.valveCount > 0 && (
        <SendToBuildingCard buildingId={building.id} valves={valves} onSent={load} />
      )}

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
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{t("buildings.units")}</h2>
          <span className="text-xs text-ink-3">
            {t("dashboard.unitCount", { count: units.length })}
          </span>
          {units.length > UNITS_PREVIEW && (
            <Link
              href={`/buildings/units?building=${building.id}`}
              className="ms-auto text-xs font-medium text-brand hover:underline"
            >
              {t("buildings.viewAllUnits", { count: units.length })} →
            </Link>
          )}
        </div>

        {/* Adding comes FIRST. On a fresh building the list is empty, and
            burying the only useful control under an empty state made the
            page look like a dead end. */}
        {isAdmin && <AddUnitForm buildingId={building.id} onAdded={load} />}

        {units.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-ink-3">
            {t("buildings.noUnits")}
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {/* Only the first few — the rest live on their own paginated
                page, so a building with 200 units does not render 200 rows
                nobody scrolled to. */}
            {units.slice(0, UNITS_PREVIEW).map((unit) => {
              const unitValves = valves.filter((v) => v.unitId === unit.id);
              const open = unitValves.filter((v) => v.lastStatus === "on").length;
              const closed = unitValves.filter((v) => v.lastStatus === "off").length;
              const unknown = unitValves.length - open - closed;
              return (
                <li key={unit.id}>
                  <Link
                    href={`/buildings/unit?building=${building.id}&unit=${unit.id}`}
                    className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-brand/5 focus-visible:bg-brand/5 focus-visible:outline-none"
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
        {units.length > UNITS_PREVIEW && (
          <div className="border-t border-hairline px-5 py-3 text-center">
            <Link
              href={`/buildings/units?building=${building.id}`}
              className="text-xs font-medium text-brand hover:underline"
            >
              {t("buildings.viewAllUnits", { count: units.length })} →
            </Link>
          </div>
        )}
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

/**
 * Send one command to every valve in this building.
 *
 * The Queue screen already has a bulk panel, but reaching it means leaving
 * the building you are looking at, finding it in a checkbox list, and
 * coming back. This is the same server call — one lane, one SMS at a time,
 * identical pacing — placed where the decision is actually made.
 *
 * While it runs, Stop cancels what has not been sent yet. It cannot recall
 * an SMS already handed to the network, and says so rather than implying
 * otherwise.
 */
function SendToBuildingCard({
  buildingId,
  valves,
  onSent,
}: {
  buildingId: number;
  valves: Valve[];
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [action, setAction] = useState<CommandAction>("on");
  const [sending, setSending] = useState(false);
  const [queued, setQueued] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // Live progress: how many of the commands we queued are still in flight.
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (queued.length === 0) return;
    const ids = new Set(queued);
    const settled = new Set<number>();
    return onAppEvent("command:update", ({ command }) => {
      if (!ids.has(command.id)) return;
      if (command.status === "pending" || command.status === "sent") return;
      settled.add(command.id);
      setDone(settled.size);
      if (settled.size === ids.size) {
        setQueued([]);
        onSent();
      }
    });
  }, [queued, onSent]);

  const valveIds = valves.map((v) => v.id);
  const inFlight = queued.length > 0;

  async function send() {
    setSending(true);
    setNotice(null);
    setDone(0);
    try {
      const commands = await api.valves.queueBulkCommand(valveIds, action);
      setQueued(commands.map((c) => c.id));
      setNotice(t("queue.bulkQueued", { count: commands.length }));
      onSent();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function stopAll() {
    // Cancel newest-first: the ones still queued go without an SMS at all.
    for (const id of [...queued].reverse()) {
      await api.commands.cancel(id).catch(() => {});
    }
    setQueued([]);
    setNotice(t("buildings.sendAllStopped"));
    onSent();
  }

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <IconSend size={16} className="text-brand" />
        <h2 className="text-sm font-semibold text-ink">{t("buildings.sendAllTitle")}</h2>
      </div>
      <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">
        {t("buildings.sendAllHint", { count: valveIds.length })}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {(["on", "off", "status"] as const).map((a) => (
          <Button
            key={a}
            variant={action === a ? "primary" : "ghost"}
            className="!px-3 !py-1.5 !text-xs"
            disabled={inFlight}
            onClick={() => setAction(a)}
          >
            {t(a === "status" ? "action.checkStatus" : `action.${a}`)}
          </Button>
        ))}
        <Button className="!px-3 !py-1.5 !text-xs" disabled={sending || inFlight} onClick={send}>
          {sending ? <IconSpinner size={13} /> : null}
          {t("buildings.sendAll", { count: valveIds.length })}
        </Button>
        {inFlight && (
          <Button variant="ghost" className="!px-3 !py-1.5 !text-xs" onClick={stopAll}>
            <IconX size={13} />
            {t("action.stopAll")}
          </Button>
        )}
      </div>

      {inFlight && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-ink-3">
            <span>{t("buildings.sendAllProgress", { done, total: queued.length })}</span>
            <span className="tabular-nums">
              {Math.round((done / Math.max(1, queued.length)) * 100)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-hairline">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${(done / Math.max(1, queued.length)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {notice && <p className="mt-2 text-xs text-ink-3">{notice}</p>}
    </Card>
  );
}
