"use client";

/*
 * Small UI primitives. One rule matters everywhere: status is ALWAYS
 * icon + label (translated), never color alone — and all spacing uses
 * logical utilities (ms-/me-/ps-/pe-) so Arabic RTL mirrors for free.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import type { CommandStatus, GatewayReachability, ValveStatus } from "@/lib/types";
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconDrop,
  IconSend,
  IconSpinner,
  IconX,
} from "./icons";

/* ---------- Card ---------- */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-edge bg-surface shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      "bg-brand text-white hover:bg-brand-strong disabled:opacity-50",
    ghost:
      "bg-transparent text-ink-2 border border-edge hover:bg-hairline/40 disabled:opacity-50",
    danger:
      "bg-critical text-white hover:opacity-90 disabled:opacity-50",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

/* ---------- Input ---------- */

export function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </span>
      <input
        className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand"
        {...props}
      />
    </label>
  );
}

/* ---------- Status chips (icon + label, never color alone) ---------- */

/** Everything a chip needs to render one status consistently. */
function chipParts(status: ValveStatus | CommandStatus | GatewayReachability | "pending_valve") {
  switch (status) {
    case "open":
      return { color: "text-good", icon: <IconDrop size={13} /> };
    case "closed":
      return { color: "text-ink-2", icon: <IconX size={13} /> };
    case "unknown":
      return { color: "text-warn", icon: <IconAlert size={13} /> };
    case "pending":
    case "pending_valve":
      return { color: "text-ink-3", icon: <IconSpinner size={13} /> };
    case "sent":
      return { color: "text-brand", icon: <IconSend size={13} /> };
    case "success":
    case "ok":
      return { color: "text-good", icon: <IconCheck size={13} /> };
    case "unconfirmed":
      // Deliberately NOT the same green as "success" — this is a real
      // command outcome that was never actually verified, on purpose
      // (Settings → confirmAfterCommand off). Blue matches "sent"'s family
      // ("we did something") without claiming the certainty "success" implies.
      return { color: "text-brand", icon: <IconCheck size={13} /> };
    case "failed":
    case "unreachable":
      return { color: "text-critical", icon: <IconX size={13} /> };
    case "no_response":
      return { color: "text-serious", icon: <IconClock size={13} /> };
  }
}

export function StatusChip({
  status,
}: {
  status: ValveStatus | CommandStatus | GatewayReachability;
}) {
  const { t } = useTranslation();
  const parts = chipParts(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-0.5 text-xs font-medium ${parts.color}`}
    >
      {parts.icon}
      <span className="text-ink-2">{t(`status.${status}`)}</span>
    </span>
  );
}

/* ---------- Stat tile ---------- */

/**
 * label (sentence case, no colon) + value (sans semibold, proportional
 * figures) + optional icon carrying the tile's accent color. One glance,
 * no chart needed — see dataviz skill: "a single current value -> stat tile".
 */
export function StatTile({
  label,
  value,
  icon,
  accent = "text-ink-3",
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4 shadow-sm">
      <div className={`mb-2 flex items-center gap-1.5 text-xs font-medium ${accent}`}>
        {icon}
        <span className="text-ink-3">{label}</span>
      </div>
      <div className="text-3xl font-semibold text-ink">{value}</div>
    </div>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-edge bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-3 hover:text-ink"
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Time-ago (locale-aware, tiny) ---------- */

export function TimeAgo({ iso }: { iso: string | null }) {
  const { t } = useTranslation();
  if (!iso) return <span className="text-ink-3">{t("common.never")}</span>;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  let text: string;
  if (mins < 1) text = t("common.justNow");
  else if (mins < 60) text = t("common.minutesAgo", { count: mins });
  else if (mins < 60 * 24) text = t("common.hoursAgo", { count: Math.floor(mins / 60) });
  else text = t("common.daysAgo", { count: Math.floor(mins / (60 * 24)) });
  return <span className="text-ink-3">{text}</span>;
}
