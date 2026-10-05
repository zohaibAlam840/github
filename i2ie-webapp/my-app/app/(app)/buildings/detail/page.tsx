"use client";

/*
 * Building detail — one building's overview: KPI tiles, valve-status bar,
 * a 7-day command trend, and its units (each linking to its own detail
 * page). Addressed via ?id= (see buildings/page.tsx for why: static export
 * can't pre-enumerate client-generated ids for a dynamic path segment).
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { BulkSendModal } from "@/components/valve/BulkSendProgress";
import { onAppEvent } from "@/lib/socket";
import { debounce } from "@/lib/debounce";
import { useAuth } from "@/lib/auth";
import type {
  BuildingStats,
  Command,
  CommandAction,
  CommandLog,
  Unit,
  Valve,
} from "@/lib/types";
import { Button, Card, Modal, StatTile } from "@/components/ui";
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
/**
 * How many valve rows the picker mounts at a time.
 *
 * Enough to fill the list without scrolling on a normal building, small
 * enough that a five-hundred-valve tower does not put five hundred
 * checkboxes into the DOM the instant the modal opens.
 */
const PICKER_PAGE = 50;

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
  /*
   * No action is pre-chosen.
   *
   * A default meant the modal opened with one of ON / OFF / Check status
   * already highlighted, so ticking some valves and hitting Send carried
   * out an action nobody had actually picked — it was just whichever one
   * happened to be the default. On a screen that cuts people's water the
   * action has to be a decision, not a leftover.
   */
  const [action, setAction] = useState<CommandAction | null>(null);
  const [sending, setSending] = useState(false);
  /*
   * The whole Command objects, in send order — BulkSendProgress needs the
   * per-valve status and event trail, not just a count of how many are left.
   */
  const [batch, setBatch] = useState<Command[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /*
   * Which valves this send is for. Empty on arrival, and emptied again
   * after every send — never pre-populated from the building's valves.
   */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [picking, setPicking] = useState(false);

  const valveIds = valves.map((v) => v.id);
  const inFlight = running;

  // Valve code by id, so the progress list can name each valve rather than
  // showing a command number nobody recognises.
  /*
   * Indexed, not scanned.
   *
   * labelFor and sublabelFor are called once per rendered row, and both
   * used to .find() through the whole valve list to do it — O(n) per
   * lookup, so O(n squared) per render. Invisible at three valves and
   * roughly 250,000 comparisons per render at the five hundred a real
   * tower will have.
   */
  const valveById = useMemo(
    () => new Map(valves.map((v) => [v.id, v])),
    [valves]
  );

  const labelFor = useCallback(
    (valveId: number) => valveById.get(valveId)?.valveCode ?? `#${valveId}`,
    [valveById]
  );

  /*
   * And the TRB behind each valve, shown under its code during a run.
   *
   * One building's valves are usually spread across several gateways, so
   * "which device is this going to" is not answerable from the valve code.
   * It matters most when a run starts failing: consecutive failures on one
   * gateway mean a dead TRB, not five dead valves.
   */
  const [gatewayLabels, setGatewayLabels] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    void api.gateways
      .list()
      .then((gs) => setGatewayLabels(new Map(gs.map((g) => [g.id, g.label]))))
      .catch(() => {
        /* Cosmetic — a missing label must never block a send. */
      });
  }, []);
  const sublabelFor = useCallback(
    (valveId: number) => {
      const valve = valveById.get(valveId);
      return valve ? gatewayLabels.get(valve.gatewayId) : undefined;
    },
    [valveById, gatewayLabels]
  );

  /*
   * The picker's own state: a search box, and how much of the result is
   * currently rendered.
   *
   * A building here is one unit with one valve, but the design target is
   * five hundred per tower — and five hundred checkbox rows is a slow
   * modal and an unusable list at the same time. So the list is searchable
   * and grows in pages as it is scrolled, rather than mounting everything
   * up front.
   */
  const [pickerSearch, setPickerSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PICKER_PAGE);

  const matches = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return valves;
    return valves.filter(
      (v) =>
        v.valveCode.toLowerCase().includes(q) ||
        (gatewayLabels.get(v.gatewayId) ?? "").toLowerCase().includes(q)
    );
  }, [valves, pickerSearch, gatewayLabels]);

  // A new search is a new list — start it at the top, not wherever the
  // previous one had been scrolled to.
  useEffect(() => setVisibleCount(PICKER_PAGE), [pickerSearch, picking]);

  const visibleValves = matches.slice(0, visibleCount);
  const hasMore = visibleCount < matches.length;

  /*
   * Grow the list when the sentinel at the bottom scrolls into view. The
   * modal's <ul> is the scroll container, so it has to be the observer's
   * root — against the viewport the sentinel never intersects and the list
   * silently stops growing.
   */
  const listRef = useRef<HTMLUListElement | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLLIElement | null) => {
      if (!node || !hasMore) return;
      const io = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setVisibleCount((n) => n + PICKER_PAGE);
          }
        },
        { root: listRef.current, rootMargin: "120px" }
      );
      io.observe(node);
      return () => io.disconnect();
    },
    [hasMore]
  );

  const handleAllSettled = useCallback(() => {
    setRunning(false);
    onSent();
  }, [onSent]);

  async function send() {
    const ids = [...selected];
    if (ids.length === 0 || action === null) return;
    setSending(true);
    setNotice(null);
    try {
      const commands = await api.valves.queueBulkCommand(ids, action);
      /*
       * Clear the ticks and close the picker the moment the batch is
       * queued. Leaving them ticked invites the same send twice — the
       * second one looking just as legitimate as the first — and on a
       * screen that shuts off people's water that is worth a line of
       * code.
       */
      setSelected(new Set());
      setAction(null);
      setPicking(false);
      setBatch(commands);
      setRunning(commands.length > 0);
      setNotice(
        commands.length === 0 ? t("bulk.noneQueued") : t("queue.bulkQueued", { count: commands.length })
      );
      onSent();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function stopAll() {
    // Newest-first: those still queued are cancelled before they ever reach
    // the modem, so stopping actually saves SMS rather than just hiding the
    // progress bar.
    for (const c of [...batch].reverse()) {
      await api.commands.cancel(c.id).catch(() => {});
    }
    setRunning(false);
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
        <Button
          className="!px-3 !py-1.5 !text-xs"
          disabled={inFlight || valveIds.length === 0}
          onClick={() => setPicking(true)}
        >
          <IconSend size={13} />
          {t("buildings.chooseValves")}
        </Button>
        {inFlight && (
          <Button variant="ghost" className="!px-3 !py-1.5 !text-xs" onClick={stopAll}>
            <IconX size={13} />
            {t("action.stopAll")}
          </Button>
        )}
      </div>

      {/*
        Choosing comes before sending.

        This card used to be a bare "Send to all 3" — the only possible
        bulk was the whole building, so cutting four of five floors meant
        five single sends. The valves are pickable now, and nothing is
        pre-ticked: a screen that arrives with every valve already selected
        is one stray click away from shutting off a building, and that is
        not a mistake this system should make easy.
      */}
      {picking && (
        <Modal open onClose={() => setPicking(false)} title={t("buildings.sendAllTitle")}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(["on", "off", "status"] as const).map((a) => (
                <Button
                  key={a}
                  variant={action === a ? "primary" : "ghost"}
                  className="!px-3 !py-1.5 !text-xs"
                  onClick={() => setAction(a)}
                >
                  {t(a === "status" ? "action.checkStatus" : `action.${a}`)}
                </Button>
              ))}
            </div>

            <input
              type="search"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder={t("buildings.searchValves")}
              className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand"
            />

            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-3">
                {t("buildings.selectedCount", { count: selected.size, total: valves.length })}
                {pickerSearch.trim() && (
                  <span className="ms-1.5">
                    · {t("buildings.matchCount", { count: matches.length })}
                  </span>
                )}
              </span>
              <span className="flex gap-2">
                {/*
                  Select all means all MATCHES, not all valves — with a
                  search active, selecting things the operator cannot see
                  is how a whole tower gets shut off by accident. Selections
                  outside the current search are preserved rather than
                  dropped.
                */}
                <button
                  type="button"
                  className="text-brand hover:underline"
                  onClick={() =>
                    setSelected((prev) => new Set([...prev, ...matches.map((v) => v.id)]))
                  }
                >
                  {pickerSearch.trim()
                    ? t("buildings.selectMatches", { count: matches.length })
                    : t("buildings.selectAll")}
                </button>
                <button
                  type="button"
                  className="text-ink-3 hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  {t("buildings.selectNone")}
                </button>
              </span>
            </div>

            <ul
              ref={listRef}
              className="max-h-64 divide-y divide-hairline overflow-y-auto rounded-lg border border-edge"
            >
              {visibleValves.map((v) => (
                <li key={v.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink-2 hover:bg-hairline/30">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={selected.has(v.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          next.has(v.id) ? next.delete(v.id) : next.add(v.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-ink">{v.valveCode}</span>
                      {sublabelFor(v.id) && (
                        <span className="ms-1.5 text-xs text-ink-3">· {sublabelFor(v.id)}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}

              {matches.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-ink-3">
                  {t("buildings.noValveMatches")}
                </li>
              )}

              {/* Scrolled into view -> the next page renders. */}
              {hasMore && (
                <li ref={sentinelRef} className="px-3 py-3 text-center text-xs text-ink-3">
                  {t("buildings.loadingMoreValves", {
                    count: matches.length - visibleValves.length,
                  })}
                </li>
              )}
            </ul>

            <Button
              className="w-full"
              disabled={selected.size === 0 || action === null || sending}
              onClick={send}
            >
              {sending ? <IconSpinner size={13} /> : null}
              {/* "Send to all 0" was nonsense — it is a count of what is
                  ticked, not of the building. */}
              {action === null
                ? t("buildings.pickAction")
                : t("buildings.sendSelected", { count: selected.size })}
            </Button>
          </div>
        </Modal>
      )}

      {batch.length > 0 && (
        <BulkSendModal
          commands={batch}
          labelFor={labelFor}
          sublabelFor={sublabelFor}
          onAllSettled={handleAllSettled}
          onStop={stopAll}
          title={t("buildings.sendAllTitle")}
        />
      )}

      {notice && <p className="mt-2 text-xs text-ink-3">{notice}</p>}
    </Card>
  );
}
