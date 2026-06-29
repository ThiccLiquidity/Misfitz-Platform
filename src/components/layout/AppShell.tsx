"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NavBar } from "./NavBar";
import { useThemeMode } from "@/components/theme/ThemeProvider";
import { getThemeTokens, themeTokensToCssVars } from "@/lib/theme/themes";

// Applies the base dark/light theme at the shell level so chrome (nav, auth pages) is themed
// even outside a collection's BinderView, which then layers its own accent on top for the
// binder itself (ARCHITECTURE.md §4/§11).
export function AppShell({ children }: { children: ReactNode }) {
  const { mode } = useThemeMode();
  const tokens = getThemeTokens(mode);
  const cssVars = themeTokensToCssVars(tokens);
  // The landing is a full-bleed branded hero with its own (baked-in) nav, so we suppress the app
  // chrome + padding there.
  const isLanding = usePathname() === "/";

  return (
    <div data-theme={mode} style={cssVars as CSSProperties} className="min-h-screen bg-vault-bg text-title">
      {!isLanding && <NavBar />}
      <main className={isLanding ? "" : "px-4 pt-3 pb-6 md:px-8"}>{children}</main>
    </div>
  );
}
