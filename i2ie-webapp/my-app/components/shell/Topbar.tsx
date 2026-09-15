"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { onAppEvent } from "@/lib/socket";
import { api } from "@/lib/api";
import { fetchWorkerHealth, type ModemState } from "@/lib/workerStatus";
import { persistedLang, setLanguage } from "@/lib/i18n";
import { persistedTheme, setTheme, type Theme } from "@/lib/theme";
import { IconGlobe, IconLogout, IconMenu, IconMoon, IconRadio, IconSun } from "@/components/icons";
import { activeNavItem } from "./nav";

/**
 * "The worker replied" and "SMS can be sent" are different questions, and
 * this chip has to answer the second one. It previously read the worker's
 * `transport` field, which was the constant string "router" — so a machine
 * with no modem plugged in showed a green "Router connected" badge. Green
 * now requires state === "ready", and nothing else does.
 */
type TransportStatus = "demo" | "offline" | "noModem" | "notReady" | "degraded" | "router";

const TRANSPORT_META: Record<TransportStatus, { i18nKey: string; color: string }> = {
  demo: { i18nKey: "topbar.transportDemo", color: "text-ink-3" },
  offline: { i18nKey: "topbar.transportOffline", color: "text-critical" },
  noModem: { i18nKey: "topbar.transportNoModem", color: "text-critical" },
  notReady: { i18nKey: "topbar.transportNotReady", color: "text-critical" },
  degraded: { i18nKey: "topbar.transportDegraded", color: "text-warn" },
  router: { i18nKey: "topbar.transportRouter", color: "text-good" },
};

/**
 * Maps the worker's modem state onto the chip. Only "ready" is green.
 *
 * "Nothing is plugged in" and "a modem is plugged in but cannot send" are
 * kept apart deliberately: telling someone there is no modem while one sits
 * in the USB port, with no SIM in it, is the exact failure this chip is
 * being fixed for. The reason lands in the tooltip either way.
 */
function chipFor(state: ModemState): TransportStatus {
  switch (state) {
    case "ready":
      return "router";
    case "degraded":
      return "degraded";
    case "absent":
      return "noModem";
    // undriven / port_only / not_ready — hardware is there, it just cannot send.
    default:
      return "notReady";
  }
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const active = activeNavItem(pathname);

  // Live queue length — pushed over SSE from the queue engine.
  const [queued, setQueued] = useState(0);
  useEffect(
    () => onAppEvent("queue:update", (p) => setQueued(p.queued + (p.processingId ? 1 : 0))),
    []
  );

  // Explicit light/dark toggle — independent of the OS setting, see lib/theme.ts.
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => setThemeState(persistedTheme()), []);

  // Real modem status — polls the local sms-worker's /health so this shows
  // whether SMS can actually be sent, never a "simulated" claim. See
  // lib/workerStatus.ts.
  const [transportStatus, setTransportStatus] = useState<TransportStatus>("demo");
  const [transportDetail, setTransportDetail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const settings = await api.settings.get();
      if (cancelled) return;
      if (!settings.workerUrl) {
        setTransportStatus("demo");
        setTransportDetail(null);
        return;
      }
      const health = await fetchWorkerHealth(settings.workerUrl);
      if (cancelled) return;
      if (!health) {
        setTransportStatus("offline");
        setTransportDetail(settings.workerUrl);
        return;
      }
      setTransportStatus(chipFor(health.state));
      // The reason is the actionable half ("No SIM card detected on COM5"),
      // so it goes in the tooltip rather than being dropped.
      setTransportDetail(health.reason ?? health.detail);
    }
    void poll();
    const interval = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  const toggleTheme = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    setThemeState(next);
  };

  const toggleLang = () =>
    setLanguage(persistedLang() === "ar" ? "en" : "ar");

  return (
    // flex-wrap: on a phone the chips wrap to a second line instead of
    // squeezing the page title to nothing or forcing a horizontal scroll.
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-surface px-4 py-3 sm:px-6">
      <button
        onClick={onMenu}
        className="-ms-1 rounded-lg p-1.5 text-ink-2 hover:bg-hairline/40 lg:hidden"
        aria-label={t("nav.openMenu")}
      >
        <IconMenu size={20} />
      </button>
      <h1 className="flex-1 truncate text-base font-semibold text-ink sm:text-lg">
        {active ? t(active.i18nKey) : t("app.name")}
      </h1>

      {/* Queue badge (live) */}
      <span className="inline-flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1 text-xs text-ink-2">
        {t("topbar.queue")}
        <span
          className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold ${
            queued > 0 ? "bg-brand text-white" : "bg-hairline text-ink-3"
          }`}
        >
          {queued}
        </span>
      </span>

      {/* Green only when the modem is genuinely ready to send */}
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1 text-xs text-ink-2"
        title={transportDetail ?? undefined}
      >
        <IconRadio size={13} className={TRANSPORT_META[transportStatus].color} />
        {t(TRANSPORT_META[transportStatus].i18nKey)}
      </span>

      <button
        onClick={toggleTheme}
        className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-hairline/40"
        title={t(theme === "light" ? "topbar.themeDark" : "topbar.themeLight")}
      >
        {theme === "light" ? <IconMoon size={15} /> : <IconSun size={15} />}
      </button>

      <button
        onClick={toggleLang}
        className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-hairline/40"
      >
        <IconGlobe size={15} />
        {t("topbar.language")}
      </button>

      <button
        onClick={() => {
          logout();
          router.replace("/login");
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-hairline/40"
        title={t("topbar.logout")}
      >
        <IconLogout size={15} />
        {t("topbar.logout")}
      </button>
    </header>
  );
}
