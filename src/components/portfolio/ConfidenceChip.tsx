"use client";

import type { Confidence } from "@/lib/valuation/range";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// How much real market data backs the estimate (VALUATION.md Part 3). Colors are tuned per theme so
// the chip reads on BOTH the dark vault and the white light-mode page (the old Tailwind /15 + *-400
// classes washed out to near-invisible on white).
const DARK: Record<Confidence, { fg: string; bg: string }> = {
  high:   { fg: "#34d399", bg: "rgba(16,185,129,0.15)" },
  medium: { fg: "#38bdf8", bg: "rgba(14,165,233,0.15)" },
  low:    { fg: "#fbbf24", bg: "rgba(245,158,11,0.15)" },
};
const LIGHT: Record<Confidence, { fg: string; bg: string }> = {
  high:   { fg: "#047857", bg: "rgba(5,150,105,0.12)" },
  medium: { fg: "#0369a1", bg: "rgba(3,105,161,0.10)" },
  low:    { fg: "#b45309", bg: "rgba(180,83,9,0.10)" },
};
const LABEL: Record<Confidence, string> = {
  high: "High confidence", medium: "Medium confidence", low: "Low confidence",
};

export function ConfidenceChip({ confidence, short = false }: { confidence: Confidence; short?: boolean }) {
  const { mode } = useThemeMode();
  const s = (mode === "light" ? LIGHT : DARK)[confidence];
  return (
    <span
      className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
      style={{ color: s.fg, background: s.bg }}
    >
      {short ? confidence : LABEL[confidence]}
    </span>
  );
}
