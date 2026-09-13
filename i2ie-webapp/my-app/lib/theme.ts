/*
 * Theme — explicit light/dark, independent of the OS/browser setting.
 *
 * Without this, a user whose system prefers dark never sees the light
 * palette at all (and vice versa) — confusing when the two look similar
 * enough at a glance to not obviously register as "changed". Defaults to
 * light with no stored preference, since that's the intended first
 * impression; the toggle persists whatever the user picks after that.
 */

export type Theme = "light" | "dark";
const STORAGE_KEY = "i2i.theme";

export function persistedTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

/** Stamp <html data-theme> (see globals.css — it wins over prefers-color-scheme). */
export function setTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }
}
