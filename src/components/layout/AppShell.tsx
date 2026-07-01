"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NavBar } from "./NavBar";
import { Footer } from "./Footer";
import { useThemeMode } from "@/components/theme/ThemeProvider";
import { getThemeTokens, themeTokensToCssVars } from "@/lib/theme/themes";

export function AppShell({ children }: { children: ReactNode }) {
  const { mode } = useThemeMode();
  const tokens = getThemeTokens(mode);
  const cssVars = themeTokensToCssVars(tokens);
  const isLanding = usePathname() === "/";

  return (
    <div data-theme={mode} style={cssVars as CSSProperties} className="min-h-screen bg-vault-bg text-title">
      {!isLanding && <NavBar />}
      <main
        className={isLanding ? "" : "px-4 pt-3 pb-6 md:px-8"}
        style={isLanding ? undefined : { paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >{children}</main>
      {!isLanding && <Footer />}
    </div>
  );
}
