import type { Confidence } from "@/lib/valuation/range";

const STYLE: Record<Confidence, { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "bg-emerald-500/15 text-emerald-400" },
  medium: { label: "Medium confidence", cls: "bg-sky-500/15 text-sky-400" },
  low: { label: "Low confidence", cls: "bg-amber-500/15 text-amber-400" },
};

// How much real market data backs the estimate (VALUATION.md Part 3). `short` shows just the word.
export function ConfidenceChip({ confidence, short = false }: { confidence: Confidence; short?: boolean }) {
  const s = STYLE[confidence];
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${s.cls}`}>
      {short ? confidence : s.label}
    </span>
  );
}
