"use client";

import Link from "next/link";
import { Fragment } from "react";
import { IconChevronDown } from "@/components/icons";

export interface Crumb {
  label: string;
  href?: string; // omit for the current (last) page
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm">
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <IconChevronDown
              size={13}
              className="-rotate-90 shrink-0 text-ink-3 rtl:rotate-90"
            />
          )}
          {item.href ? (
            <Link
              href={item.href}
              className="text-ink-3 hover:text-brand hover:underline"
            >
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-ink">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
