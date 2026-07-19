import type { ThemeConfig, ThemeMode } from "@/types";

// Ported directly from the validated interactive prototype (dark "vault" / light "binder page").
// Collection.themeConfig.accent tints the border/title colors so a future collection can have its
// own identity without touching this file — see BinderView.
export interface ThemeTokens {
  vaultBg: string;
  pageBg: string;
  pageBorder: string;
  cardBg: string;
  cardBorder: string;
  glow: string;
  artBg: string;
  artIcon: string;
  title: string;
  sub: string;
  good: string;
  fair: string;
  bad: string;
}

const BASE_THEMES: Record<ThemeMode, ThemeTokens> = {
  dark: {
    vaultBg: "#150f09",
    pageBg: "#241a10",
    pageBorder: "#b8923f",
    cardBg: "#2e2014",
    cardBorder: "#c9a227",
    glow: "0 0 8px rgba(201,162,39,0.35)",
    artBg: "#3a2a18",
    artIcon: "#7a6038",
    title: "#e8c878",
    sub: "#b89968",
    good: "#8fce6b",
    fair: "#d9b35c",
    bad: "#e08a6f",
  },
  light: {
    // Sky-blue "bright collector's room" palette — vibrant and playful like the reference.
    // Dark sidebars (FilterSidebar, CollectionSwitcher) are hardcoded and stay dark,
    // creating the reference's contrast of dark-sidebar / light-content.
    vaultBg: "#c8e8f8",   // sky blue page background
    pageBg:  "#ffffff",   // white binder pages / panels
    pageBorder: "#2980c8", // clear sky blue border
    cardBg: "#ffffff",
    cardBorder: "#2980c8",
    glow: "none",
    artBg: "#daf0ff",
    artIcon: "#1a6db5",
    title: "#0a1e38",     // very dark navy
    sub: "#2d5a8e",       // medium navy
    good: "#1a7f3c",
    fair: "#b86200",
    bad: "#c42020",
  },
  // HIDDEN prototype skin — 90s Saturday-morning: an open binder on a wood table, manila pages, chunky
  // primary-color accents. CSS-only for now (see [data-theme="nostalgia"] in globals.css); commissioned art
  // drops in via the --nostalgia-* CSS vars without touching this palette. Not in the visible theme toggle.
  nostalgia: {
    vaultBg: "#7c5236",    // wood table / desk
    pageBg: "#fdf3d8",     // manila binder page
    pageBorder: "#c0392b", // bold retro red trapper-keeper trim
    cardBg: "#fffdf5",
    cardBorder: "#2e7bc0", // primary crayon blue
    glow: "0 2px 0 rgba(70,40,10,0.25)",
    artBg: "#ffe8b0",
    artIcon: "#c0392b",
    title: "#3a2416",      // brown marker ink
    // Contrast pass (AA on the manila/cream pages): good/fair failed as text (3.1:1 / 2.0:1) — darkened. The
    // vibrant trapper-keeper red stays on BORDERS (pageBorder / the CSS block); these tokens are TEXT only.
    sub: "#6a4a2a",        // 7.2:1
    good: "#1b6e2e",       // 5.7:1 (was #2f9e44, 3.1:1 — fail)
    fair: "#8a5500",       // 5.6:1 (was #e8a020, 2.0:1 — fail)
    bad: "#a82a1e",        // 6.3:1 (text; border trim keeps #c0392b)
  },
};

// Applies a collection's accent to the chrome (border/title) while keeping the validated
// dark-vault / light-page base palette intact — this is the "theme-driven, not collection-coded"
// seam called out in ARCHITECTURE.md §4.
export function getThemeTokens(mode: ThemeMode, theme?: ThemeConfig): ThemeTokens {
  const base = BASE_THEMES[mode];
  if (!theme?.accent) return base;
  return { ...base, pageBorder: theme.accent, cardBorder: theme.accent, title: theme.accent };
}

export function themeTokensToCssVars(tokens: ThemeTokens): Record<string, string> {
  return {
    "--vault-bg": tokens.vaultBg,
    "--page-bg": tokens.pageBg,
    "--page-border": tokens.pageBorder,
    "--card-bg": tokens.cardBg,
    "--card-border": tokens.cardBorder,
    "--card-glow": tokens.glow,
    "--art-bg": tokens.artBg,
    "--title": tokens.title,
    "--subtle": tokens.sub,
    "--good": tokens.good,
    "--fair": tokens.fair,
    "--bad": tokens.bad,
  };
}
