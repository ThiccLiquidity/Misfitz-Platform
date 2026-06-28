"use client";

import { useThemeMode } from "./ThemeProvider";

export function ThemeToggle() {
  const { mode, toggle } = useThemeMode();

  return (
    <button
      onClick={toggle}
      type="button"
      className="rounded-full border border-page-border px-3 py-1 text-xs font-medium text-title transition hover:opacity-80"
      aria-label="Toggle light/dark theme"
    >
      {mode === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
