"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ThemeMode } from "@/types";

// The app now has just two live themes: Day (warm) and Night (moonlight). Internally they map to the
// existing "nostalgia" / "nostalgia-night" theme tokens; the legacy "dark"/"light" values are migrated on
// load so returning users land on the closest new theme.
interface ThemeContextValue { mode: ThemeMode; toggle: () => void; setTheme: (m: ThemeMode) => void; }
const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "chia-collector-theme-mode";
const isNight = (m: ThemeMode) => m === "nostalgia-night" || m === "dark";
// Any stored/legacy value -> one of the two live themes. Night: old "dark" + "nostalgia-night". Day: rest.
const normalize = (m: string | null): ThemeMode => (m === "nostalgia-night" || m === "dark") ? "nostalgia-night" : "nostalgia";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("nostalgia"); // Day by default

  const apply = (m: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEY, m);
    document.documentElement.style.colorScheme = isNight(m) ? "dark" : "light";
    setMode(m);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const themeParam = params.get("theme");
    if (params.get("nostalgia-night") === "1" || themeParam === "nostalgia-night" || themeParam === "night") { apply("nostalgia-night"); return; }
    if (params.get("nostalgia") === "1" || themeParam === "nostalgia" || themeParam === "day") { apply("nostalgia"); return; }
    apply(normalize(window.localStorage.getItem(STORAGE_KEY)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = (m: ThemeMode) => apply(m);
  const toggle = () => apply(isNight(mode) ? "nostalgia" : "nostalgia-night");

  return <ThemeContext.Provider value={{ mode, toggle, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeMode must be used inside a ThemeProvider");
  return ctx;
}
