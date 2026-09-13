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
import { NetworkError, UnauthenticatedError } from "@/lib/api";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    setLanguage(persistedLang());
    setTheme(persistedTheme());
  }, []);

  /*
   * One place that knows which rejections are expected.
   *
   * A 401 is already fully handled — lib/api.ts clears the token and the
   * auth layer redirects to /login — and a failed fetch is already retried
   * by the next poll tick. Neither needs a stack trace in the console, and
   * on a dev server they arrived in threes on every restart. Everything
   * else is left alone and still surfaces, so a real bug is not hidden.
   */
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof UnauthenticatedError || e.reason instanceof NetworkError) {
        e.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return <AuthProvider>{children}</AuthProvider>;
}
