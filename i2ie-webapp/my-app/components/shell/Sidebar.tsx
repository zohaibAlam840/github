"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { IconValve } from "@/components/icons";
import { NAV_ITEMS, activeNavItem } from "./nav";

export function Sidebar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pathname = usePathname();
  const active = activeNavItem(pathname);

  if (!user) return null;
  const items = NAV_ITEMS.filter((n) => n.roles.includes(user.role));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-e border-hairline bg-surface">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid size-9 place-items-center rounded-lg bg-brand text-white">
          <IconValve size={20} />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">{t("app.name")}</div>
          <div className="text-[11px] text-ink-3">{t("app.tagline")}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {items.map((item) => {
          const isActive = active?.href === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-ink-2 hover:bg-hairline/40 hover:text-ink"
              }`}
            >
              <Icon size={17} />
              {t(item.i18nKey)}
            </Link>
          );
        })}
      </nav>

      {/* Signed-in user */}
      <div className="border-t border-hairline px-5 py-4">
        <div className="text-sm font-medium text-ink">{user.name}</div>
        <div className="text-xs text-ink-3">{t(`roles.${user.role}`)}</div>
      </div>
    </aside>
  );
}
