"use client";

/*
 * ValveRow — one valve's control row, used on the Unit detail page.
 * Open / Close / Refresh (role-gated), a live status chip, and a
 * "last confirmed" time. Clicking an action opens a live-progress modal
 * (see ProgressCircle) fed by the command:update event stream — nothing
 * here blocks, and the modal survives worker polling ticks in place.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { onAppEvent } from "@/lib/socket";
import type { Command, CommandAction, CommandLog, Gateway, Valve } from "@/lib/types";
import { Button, Modal, StatusChip, TimeAgo } from "@/components/ui";
import {
  IconCheck,
  IconClock,
  IconDrop,
  IconSend,
  IconSpinner,
  IconX,
} from "@/components/icons";

/**
 * Spins while the command is in flight; the moment it resolves, swaps to a
 * check/X/clock that pops in — a keyed remount (status as key) so the
 * animation retriggers on every transition, not just first paint.
 */
function ProgressCircle({ status }: { status: CommandLog["status"] }) {
  if (status === "pending" || status === "sent") {
    return (
      <div className="flex justify-center py-2">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-hairline border-t-brand" />
      </div>
    );
  }

  const parts: Record<string, { border: string; bg: string; icon: ReactNode }> = {
    success: {
      border: "border-good",
      bg: "bg-good/10",
      icon: <IconCheck size={28} className="text-good" />,
    },
    failed: {
      border: "border-critical",
      bg: "bg-critical/10",
      icon: <IconX size={28} className="text-critical" />,
    },
    no_response: {
      border: "border-serious",
      bg: "bg-serious/10",
      icon: <IconClock size={28} className="text-serious" />,
    },
    unconfirmed: {
      border: "border-brand",
      bg: "bg-brand/10",
      icon: <IconCheck size={28} className="text-brand" />,
    },
  };
  const part = parts[status];
  if (!part) return null;

  return (
    <div className="flex justify-center py-2">
      <div
        key={status}
        className={`flex h-16 w-16 animate-pop-in items-center justify-center rounded-full border-2 ${part.border} ${part.bg}`}
      >
        {part.icon}
      </div>
    </div>
  );
}

export function ValveRow({
  valve,
  gateway,
  command,
  canOperate,
  isAdmin,
  onSend,
  onChanged,
  buildingId,
}: {
  valve: Valve;
  gateway: Gateway | undefined;
  command: CommandLog | undefined;
  canOperate: boolean;
  isAdmin: boolean;
  onSend: (valve: Valve, action: CommandAction) => Promise<Command | undefined>;
  onChanged: () => void;
  /** When known, the valve code links to its own detail page. */
  buildingId?: number;
}) {
  const { t } = useTranslation();
  const pending = valve.pendingCommandId !== null;
  const [busy, setBusy] = useState(false);
  const [modalCommand, setModalCommand] = useState<Command | null>(null);
  const [stopping, setStopping] = useState(false);

  // Keep the modal's command live while it's open — command:update fires on
  // every step (send accepted, each worker poll tick, final reply/timeout).
  useEffect(() => {
    if (!modalCommand) return;
    return onAppEvent("command:update", ({ command: updated }) => {
      if (updated.id === modalCommand.id) setModalCommand(updated);
    });
  }, [modalCommand?.id]);

  /*
   * Shared by the inline Stop on the row and the one inside the modal, so
   * the two cannot drift apart.
   */
  async function stopCommand(id: number) {
    setStopping(true);
    try {
      const stopped = await api.commands.cancel(id);
      // Only touch the modal if it is the command being shown.
      setModalCommand((cur) => (cur && cur.id === id ? stopped : cur));
      onChanged();
    } finally {
      setStopping(false);
    }
  }

  async function act(action: CommandAction) {
    setBusy(true);
    try {
      const command = await onSend(valve, action);
      if (command) setModalCommand(command);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <div className="min-w-32">
        {buildingId ? (
          <Link
            href={`/buildings/valve?building=${buildingId}&unit=${valve.unitId}&valve=${valve.id}`}
            className="text-sm font-medium text-ink hover:text-brand hover:underline"
          >
            {valve.valveCode}
          </Link>
        ) : (
          <div className="text-sm font-medium text-ink">{valve.valveCode}</div>
        )}
        <div className="text-xs text-ink-3">
          {/* The output suffix only means something when a gateway has two.
              With one relay per TRB it is noise on every single row. */}
          {gateway
            ? gateway.numOutputs > 1
              ? `${gateway.label} · V${valve.outputIndex}`
              : gateway.label
            : "—"}
        </div>
      </div>

      {/* Status: pending overrides last-known, chip = icon + label */}
      {pending ? (
        /*
          Clickable, because closing the progress modal used to be a one-way
          door: the row fell back to a plain "Pending" chip with no way back
          to the trail and — worse — no way to Stop, even though the command
          was still live and still had a Stop to offer. The only escape was
          to wait out the timeout. Re-opening it is the same modal with the
          same live command, so Stop comes back with it.

          Falls back to a plain chip if the parent has not supplied the
          command yet, rather than offering a button that opens nothing.
        */
        command ? (
          /*
            Stop sits directly beside Pending, not only inside the modal.
            Giving up on a reply is the one thing an operator wants while a
            command hangs, and making them open a dialog to reach it put a
            click between them and the only control that still does
            anything on this row.
          */
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => setModalCommand(command)}
              title={t("valve.reopenProgress")}
              className="inline-flex flex-col gap-0.5 text-start"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-3 transition-colors hover:border-brand hover:text-brand">
                <IconSpinner size={13} />
                <span className="text-ink-2">{t("status.pending")}</span>
              </span>
              {command.events && command.events.length > 0 && (
                <span className="max-w-56 truncate text-xs text-ink-3">
                  {command.events.at(-1)!.message}
                </span>
              )}
            </button>
            {canOperate && (
              <Button
                variant="ghost"
                className="!px-2 !py-1 !text-xs"
                disabled={stopping}
                title={t("action.stopHint")}
                onClick={() => void stopCommand(command.id)}
              >
                {stopping ? <IconSpinner size={12} /> : <IconX size={12} />}
                {t("action.stop")}
              </Button>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-3">
            <IconSpinner size={13} />
            <span className="text-ink-2">{t("status.pending")}</span>
          </span>
        )
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <StatusChip status={valve.lastStatus} />
          {/*
            One-message dispatch means most states are what we COMMANDED, not
            what the valve reported — the TRB's actuation rule never replies.
            Saying so is the whole point: an unmarked chip would claim
            certainty we do not have. Refresh sends a status query and clears
            this.
          */}
          {!valve.statusVerified && valve.lastStatus !== "unknown" && (
            <span
              className="rounded-full border border-edge px-1.5 py-0.5 text-[10px] font-medium text-warn"
              title={t("valve.assumedHint")}
            >
              {t("valve.assumed")}
            </span>
          )}
        </span>
      )}

      <span className="text-xs text-ink-3">
        {/* "Last confirmed" would be a lie for a state nothing confirmed. */}
        {t(valve.statusVerified ? "common.lastConfirmed" : "common.lastSent")}:{" "}
        <TimeAgo iso={valve.lastSeenAt} />
      </span>

      {/*
        On a phone these four controls do not fit beside the valve code, and
        without wrapping they simply ran off the edge. Below sm they take
        their own full-width line; from sm they sit right-aligned as before.
      */}
      <span className="flex w-full flex-wrap items-center gap-2 sm:ms-auto sm:w-auto">
        {canOperate && (
          <>
            <Button
              variant="ghost"
              className="!px-3 !py-1.5 !text-xs"
              disabled={pending || busy}
              onClick={() => act("on")}
            >
              <IconDrop size={13} className="text-good" />
              {t("action.on")}
            </Button>
            <Button
              variant="ghost"
              className="!px-3 !py-1.5 !text-xs"
              disabled={pending || busy}
              onClick={() => act("off")}
            >
              <IconX size={13} />
              {t("action.off")}
            </Button>
            <Button
              variant="ghost"
              className="!px-3 !py-1.5 !text-xs"
              disabled={pending || busy}
              onClick={() => act("status")}
            >
              <IconSend size={13} className="text-brand" />
              {t("action.checkStatus")}
            </Button>
          </>
        )}
        {isAdmin && (
          <button
            onClick={async () => {
              if (confirm(t("buildings.confirmDeleteValve"))) {
                await api.valves.remove(valve.id);
                onChanged();
              }
            }}
            className="rounded p-1 text-ink-3 hover:text-critical"
            title={t("buildings.delete")}
          >
            <IconX size={14} />
          </button>
        )}
      </span>

      {modalCommand && (
        <Modal
          open
          onClose={() => setModalCommand(null)}
          title={`${valve.valveCode} — ${t(`action.${modalCommand.action}`)}`}
        >
          <div className="space-y-4">
            <ProgressCircle status={modalCommand.status} />

            {/*
              Closing this modal already leaves the command running in the
              background — the queue is server-side. Stop is the different
              thing: it gives up on the reply. Only offered while there is
              something to stop.
            */}
            {(modalCommand.status === "pending" || modalCommand.status === "sent") && (
              <div className="flex flex-col items-center gap-1">
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 !text-xs"
                  disabled={stopping}
                  onClick={() => void stopCommand(modalCommand.id)}
                >
                  {stopping ? <IconSpinner size={13} /> : <IconX size={13} />}
                  {t("action.stop")}
                </Button>
                <span className="text-center text-[11px] leading-relaxed text-ink-3">
                  {t("action.stopHint")}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-3">
                {/* The output suffix only means something when a gateway has two.
              With one relay per TRB it is noise on every single row. */}
          {gateway
            ? gateway.numOutputs > 1
              ? `${gateway.label} · V${valve.outputIndex}`
              : gateway.label
            : "—"}
              </span>
              <StatusChip status={modalCommand.status} />
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-2">
                {t("queue.sms")}
              </div>
              <div className="rounded-lg border border-edge bg-hairline/20 px-3 py-2 font-mono text-xs text-ink-2">
                {modalCommand.commandText}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-2">
                {t("buildings.progress")}
              </div>
              {modalCommand.events && modalCommand.events.length > 0 ? (
                <ol className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-edge p-3">
                  {modalCommand.events.map((evt, i) => (
                    <li key={i} className="flex gap-3 text-xs">
                      <span className="shrink-0 tabular-nums text-ink-3">
                        {new Date(evt.ts).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <span className="text-ink-2">{evt.message}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="flex items-center gap-2 text-xs text-ink-3">
                  <IconSpinner size={13} />
                  {t("buildings.progressStarting")}
                </div>
              )}
            </div>

            {modalCommand.replyText && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-ink-2">
                  {t("queue.reply")}
                </div>
                <div className="rounded-lg border border-edge bg-hairline/20 px-3 py-2 font-mono text-xs text-ink-2">
                  {modalCommand.replyText}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </li>
  );
}
