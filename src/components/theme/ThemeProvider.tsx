"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ThemeMode } from "@/types";

interface ThemeContextValue {
  mode: ThemeMode;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "chia-collector-theme-mode";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    // Hidden activation for the 90s "nostalgia" skin: ?nostalgia=1 (or ?theme=nostalgia) flips it on and
    // remembers it; there is intentionally NO visible toggle yet (prototype). Clear with ?nostalgia=0.
    const params = new URLSearchParams(window.location.search);
    const nostParam = params.get("nostalgia");
    const themeParam = params.get("theme");
    if (nostParam === "1" || themeParam === "nostalgia") {
      window.localStorage.setItem(STORAGE_KEY, "nostalgia");
      document.documentElement.style.colorScheme = "light";
      setMode("nostalgia");
      return;
    }
    if (nostParam === "0") window.localStorage.setItem(STORAGE_KEY, "dark");
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "nostalgia") {
      setMode(stored);
      if (stored === "nostalgia") document.documentElement.style.colorScheme = "light";
    }
  }, []);

  const toggle = () => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      // Keep <html> color-scheme in sync so native controls (select, input, etc.)
      // switch immediately without waiting for a re-render cycle.
      document.documentElement.style.colorScheme = next === "dark" ? "dark" : "light";
      return next;
    });
  };

  return <ThemeContext.Provider value={{ mode, toggle }}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeMode must be used inside a ThemeProvider");
  return ctx;
}
