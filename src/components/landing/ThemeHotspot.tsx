"use client";

import type { CSSProperties } from "react";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// Invisible button placed over the baked-in light/dark toggle in the landing image. Flips the
// site theme (the landing image itself is fixed, but the rest of the site follows this choice).
export function ThemeHotspot({ className, style }: { className?: string; style?: CSSProperties }) {
  const { toggle } = useThemeMode();
  return (
    <button type="button" aria-label="Toggle light or dark theme" onClick={toggle} className={className} style={style} />
  );
}
