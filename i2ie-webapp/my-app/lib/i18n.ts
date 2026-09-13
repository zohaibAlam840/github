/*
 * i18n — EN/AR with RTL, set up ONCE and used everywhere.
 *
 * Rules that keep RTL painless:
 * - Language flips `<html lang>` and `<html dir>` here, in one place.
 * - Components use Tailwind LOGICAL utilities (ms-/me-/ps-/pe-/text-start)
 *   so the layout mirrors automatically — no `left/right` classes.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import ar from "@/locales/ar.json";

export type Lang = "en" | "ar";
const STORAGE_KEY = "i2i.lang";

// Idempotent init — safe under React strict mode / fast refresh.
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: "en", // switched to the persisted choice after mount
    fallbackLng: "en",
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
  });
}

export function persistedLang(): Lang {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem(STORAGE_KEY) === "ar" ? "ar" : "en";
}

/** Switch language AND flip document direction (the one RTL switch). */
export function setLanguage(lang: Lang) {
  void i18n.changeLanguage(lang);
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, lang);
  }
}

export default i18n;
