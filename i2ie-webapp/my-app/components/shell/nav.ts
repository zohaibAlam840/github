/*
 * The single nav definition — sidebar, topbar title, and role gating all
 * read from here so they can never disagree.
 */

import type { ComponentType, SVGProps } from "react";
import type { Role } from "@/lib/types";
import {
  IconAlert,
  IconBook,
  IconBuilding,
  IconDashboard,
  IconGateway,
  IconLogs,
  IconQueue,
  IconSettings,
  IconUsers,
} from "@/components/icons";

export interface NavItem {
  href: string;
  i18nKey: string; // nav.<key>
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  roles: Role[]; // who sees it
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", i18nKey: "nav.dashboard", icon: IconDashboard, roles: ["admin", "operator", "viewer"] },
  { href: "/alerts", i18nKey: "nav.alerts", icon: IconAlert, roles: ["admin", "operator", "viewer"] },
  { href: "/buildings", i18nKey: "nav.buildings", icon: IconBuilding, roles: ["admin", "operator", "viewer"] },
  { href: "/queue", i18nKey: "nav.queue", icon: IconQueue, roles: ["admin", "operator", "viewer"] },
  { href: "/gateways", i18nKey: "nav.gateways", icon: IconGateway, roles: ["admin"] },
  { href: "/logs", i18nKey: "nav.logs", icon: IconLogs, roles: ["admin", "operator", "viewer"] },
  { href: "/settings", i18nKey: "nav.settings", icon: IconSettings, roles: ["admin"] },
  { href: "/users", i18nKey: "nav.users", icon: IconUsers, roles: ["admin"] },
  { href: "/guide", i18nKey: "nav.guide", icon: IconBook, roles: ["admin", "operator", "viewer"] },
];

/** Match current pathname to a nav item (trailingSlash-safe). */
export function activeNavItem(pathname: string): NavItem | undefined {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return NAV_ITEMS.find((n) => clean === n.href || clean.startsWith(n.href + "/"));
}
