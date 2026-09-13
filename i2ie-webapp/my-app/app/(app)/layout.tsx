"use client";

/*
 * Authenticated shell: sidebar + topbar + content.
 * Guards every screen inside the (app) group — unauthenticated visitors
 * are sent to /login (client-side; this is a static export).
 */

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  // Wait for localStorage before deciding — avoids a login flash.
  if (!ready || !user) return null;

  return (
    <div className="flex min-h-dvh bg-plane">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
