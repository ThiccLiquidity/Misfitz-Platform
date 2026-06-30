// Small reusable semi-circle gauge for the card's "Deal Score" stat — generic (score + label in,
// SVG out), so it isn't tied to NftRarityCard and could be reused anywhere else a 0-100 score
// needs the same "TCG card" gauge treatment.
interface DealScoreGaugeProps {
  score: number; // 0-100
  label?: string;
}

const ARC_RADIUS = 42;
const ARC_LENGTH = Math.PI * ARC_RADIUS; // half-circle circumference

// Display-only playful label for the deal score. Internal labels stay stable (used as color keys);
// this just changes what the user reads.
export function funLabel(label?: string): string {
  switch (label) {
    case "GREAT DEAL":  return "Send it 🚀";
    case "GOOD DEAL":   return "Cop it 🤝";
    case "FAIR DEAL":   return "Fair play ⚖️";
    case "OVERPRICED":  return "Champagne taste 🥂";
    default:            return label ?? "";
  }
}

export function colorForLabel(label?: string): string {
  switch (label) {
    case "GREAT DEAL":
      return "#22c55e"; // bright green
    case "GOOD DEAL":
      return "#10b981"; // emerald — still green but less vivid
    case "FAIR DEAL":
      return "#3b82f6"; // neutral blue
    case "OVERPRICED":
      return "#ef4444"; // bright red
    default:
      return "#9a9aa2";
  }
}

export function DealScoreGauge({ score, label }: DealScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const filled = (clamped / 100) * ARC_LENGTH;
  const color = colorForLabel(label);

  return (
    <svg viewBox="0 0 100 58" width="64" height="38" className="mx-auto">
      <path
        d="M 8 50 A 42 42 0 0 1 92 50"
        fill="none"
        stroke="var(--rc-divider)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M 8 50 A 42 42 0 0 1 92 50"
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${ARC_LENGTH}`}
      />
      <text x="50" y="46" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--rc-ink)">
        {Math.round(clamped)}
      </text>
    </svg>
  );
}
