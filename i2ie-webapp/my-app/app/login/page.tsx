"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { persistedLang, setLanguage } from "@/lib/i18n";
import { Button, Card, Field } from "@/components/ui";
import { IconGlobe, IconSpinner, IconValve } from "@/components/icons";

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, ready, login } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // Already signed in? Straight to the dashboard.
  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(false);
    setBusy(true);
    try {
      await login(username, password);
      router.replace("/dashboard");
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-plane p-6">
      {/* Language toggle, top corner (logical inset for RTL) */}
      <button
        onClick={() => setLanguage(persistedLang() === "ar" ? "en" : "ar")}
        className="absolute top-4 end-4 inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-2 hover:bg-hairline/40"
      >
        <IconGlobe size={15} />
        {t("topbar.language")}
      </button>

      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-brand text-white">
            <IconValve size={26} />
          </span>
          <div>
            <div className="text-xl font-semibold text-ink">{t("app.name")}</div>
            <div className="text-sm text-ink-3">{t("app.tagline")}</div>
          </div>
        </div>

        <Card className="p-6">
          <h1 className="text-lg font-semibold text-ink">{t("login.title")}</h1>
          <p className="mb-5 text-sm text-ink-3">{t("login.subtitle")}</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <Field
              label={t("login.username")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
            <Field
              label={t("login.password")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />

            {error && (
              <p className="text-sm font-medium text-critical">
                {t("login.error")}
              </p>
            )}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <IconSpinner size={16} /> : null}
              {t("login.submit")}
            </Button>
          </form>
        </Card>

        {/* Demo credentials — mock phase only */}
        <p className="mt-4 text-center text-xs text-ink-3">
          {t("login.demo")}: {t("login.demoHint")}
        </p>
      </div>
    </main>
  );
}
