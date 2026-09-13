"use client";

/*
 * Wrapper for admin-only screens (Gateways / Settings / Users).
 * The sidebar already hides them from other roles — this covers the
 * direct-URL case by bouncing non-admins back to the dashboard.
 */

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !isAdmin) router.replace("/dashboard");
  }, [ready, isAdmin, router]);

  if (!ready || !isAdmin) return null;
  return <>{children}</>;
}
