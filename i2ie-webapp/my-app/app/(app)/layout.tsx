"use client";

/*
 * Authenticated shell: sidebar + topbar + content.
 * Guards every screen inside the (app) group — unauthenticated visitors
 * are sent to /login (client-side; this is a static export).
 */

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  // Wait for localStorage before deciding — avoids a login flash.
  if (!ready || !user) return null;

  return (
    <div className="flex min-h-dvh bg-plane">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMenuOpen(true)} />
        {/* Tighter gutters on a phone — 24px each side of a 360px screen is
            13% of the viewport spent on nothing. */}
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
