"use client";

import type { ThemeMode } from "@/types";
import { useThemeMode } from "./ThemeProvider";

const isNight = (m: ThemeMode) => m === "nostalgia-night" || m === "dark";

// Two-option Day / Night switch (the two current themes). Shows the current mode; click flips it.
export function ThemeToggle() {
  const { mode, setTheme } = useThemeMode();
  const night = isNight(mode);
  const next: ThemeMode = night ? "nostalgia" : "nostalgia-night";
  return (
    <button
      onClick={() => setTheme(next)}
      type="button"
      className="rounded-full border border-page-border px-3 py-1 text-xs font-medium text-title transition hover:opacity-80"
      aria-label={`${night ? "Night" : "Day"} mode \u2014 switch to ${night ? "Day" : "Night"}`}
    >
      {night ? "\ud83c\udf19 Night" : "\u2600\ufe0f Day"}
    </button>
  );
}
