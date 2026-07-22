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
  // HIDDEN theme — "nostalgia": a true reskin, sibling of light/dark. 90s Saturday-morning warmth: a
  // sun-bleached honey-oak desk (subtle /nostalgia/desk.png texture wash — see [data-theme="nostalgia"]
  // in globals.css), manila pages, brick-red trapper-keeper trim, espresso marker ink. This is a LIGHT
  // theme (dark ink on warm light surfaces) so the same token contract as light mode holds; dark leather
  // chrome panels (.tf-panel) re-point these vars locally in CSS. All text tokens pass WCAG AA.
  nostalgia: {
    vaultBg: "#c99f63",     // sun-bleached honey oak (desk.png texture layers over this)
    pageBg: "#f7ecd2",      // manila binder page
    pageBorder: "#b23a28",  // brick-red trapper-keeper trim (borders only, never body text)
    cardBg: "#fffaf0",      // warm index-card white
    cardBorder: "#b5773f",  // toffee/caramel
    glow: "0 2px 6px rgba(93,58,26,0.28)",
    artBg: "#f3e2ba",
    artIcon: "#a3703a",
    title: "#402a18",       // espresso marker ink (9.8:1 on pageBg)
    sub: "#4a2f16",         // espresso, 5.1:1 on desk / 10.5:1 on manila (AA everywhere)
    good: "#1b6e2e",        // kelly green (5.1:1 AA)
    fair: "#8a5500",        // deep amber (5.4:1 AA)
    bad: "#a82a1e",         // ketchup red (6.1:1 AA)
  },
  "nostalgia-night": {
    vaultBg: "#070c18",
    pageBg: "#10182b",
    pageBorder: "#c9a227",
    cardBg: "#141d33",
    cardBorder: "#6f83ab",
    glow: "0 2px 10px rgba(3,6,14,0.55)",
    artBg: "#0e1728",
    artIcon: "#6f83ab",
    title: "#dfe8f5",
    sub: "#a9bad6",
    good: "#8fce6b",
    fair: "#d9b35c",
    bad: "#e08a6f",
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
