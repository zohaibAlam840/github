"use client";

/*
 * ValveStatusBar — part-to-whole valve status, as a single segmented
 * horizontal bar (dataviz skill: part-to-whole -> stacked bar, not a pie).
 * Segments use the app's reserved status colors, 2px surface gaps between
 * them, counts always labeled beside an icon — never color alone.
 */

import { useTranslation } from "react-i18next";
import { IconAlert, IconDrop, IconX } from "@/components/icons";

export function ValveStatusBar({
  open,
  closed,
  unknown,
  size = "md",
}: {
  open: number;
  closed: number;
  unknown: number;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const total = open + closed + unknown;
  const barHeight = size === "sm" ? "h-1.5" : "h-2";

  // Zero-valve context is already communicated by the caller (a count, or
  // "no valves yet" copy specific to what's being shown) — nothing to draw.
  if (total === 0) return null;

  return (
    <div>
      <div className={`flex ${barHeight} gap-0.5 overflow-hidden rounded-full`}>
        {open > 0 && <span className="rounded-sm bg-good" style={{ flex: open }} />}
        {closed > 0 && (
          <span className="rounded-sm bg-ink-3/50" style={{ flex: closed }} />
        )}
        {unknown > 0 && <span className="rounded-sm bg-warn" style={{ flex: unknown }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1">
          <IconDrop size={12} className="text-good" />
          {t("status.on")} {open}
        </span>
        <span className="inline-flex items-center gap-1">
          <IconX size={12} className="text-ink-3" />
          {t("status.off")} {closed}
        </span>
        <span className="inline-flex items-center gap-1">
          <IconAlert size={12} className="text-warn" />
          {t("status.unknown")} {unknown}
        </span>
      </div>
    </div>
  );
}
