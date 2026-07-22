import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThemeLab } from "./ThemeLab";

// Dev-only visual gallery for theme iteration (see docs/NOSTALGIA-MODE.md). 404s in production
// unless ENABLE_THEME_LAB=1 is set explicitly. Every element renders through the REAL components,
// so a screenshot of this page IS the theme. Activate a theme with ?nostalgia=1 or the lab buttons.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Theme Lab", robots: { index: false, follow: false } };

export default function ThemeLabPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_THEME_LAB !== "1") notFound();
  return <ThemeLab />;
}
