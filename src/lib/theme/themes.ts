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
    vaultBg: "#f4e8cc",
    pageBg: "#fff6e6",
    pageBorder: "#e8ac3e",
    cardBg: "#ffffff",
    cardBorder: "#e8ac3e",
    glow: "none",
    artBg: "#ffe6b0",
    artIcon: "#c98a1f",
    title: "#8a5a12",
    sub: "#a87a3a",
    good: "#3b8f2f",
    fair: "#a8741a",
    bad: "#b3402c",
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
