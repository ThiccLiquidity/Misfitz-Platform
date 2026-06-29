"use client";

import type { CSSProperties, ReactNode } from "react";
import { NavBar } from "./NavBar";
import { useThemeMode } from "@/components/theme/ThemeProvider";
import { getThemeTokens, themeTokensToCssVars } from "@/lib/theme/themes";

export function AppShell({ children }: { children: ReactNode }) {
  const { mode } = useThemeMode();
  const tokens = getThemeTokens(mode);
  const cssVars = themeTokensToCssVars(tokens);

  return (
    <div data-theme={mode} style={cssVars as CSSProperties} className="min-h-screen bg-vault-bg text-title">
      <NavBar />
      <main className="px-4 pt-3 pb-6 md:px-8">{children}</main>
    </div>
  );
}
