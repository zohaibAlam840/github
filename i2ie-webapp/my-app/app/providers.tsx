"use client";

/*
 * Client-side providers: i18n (EN/AR + RTL) and auth.
 * The persisted language is applied after mount — the static export is
 * prerendered in English, then flips if the user chose Arabic.
 */

import { useEffect, type ReactNode } from "react";
import "@/lib/i18n"; // initializes i18next once (module side-effect)
import { persistedLang, setLanguage } from "@/lib/i18n";
import { persistedTheme, setTheme } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    setLanguage(persistedLang());
    setTheme(persistedTheme());
  }, []);

  return <AuthProvider>{children}</AuthProvider>;
}
