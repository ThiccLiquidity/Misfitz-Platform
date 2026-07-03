// Small reusable semi-circle gauge for the "Deal Score" stat. The arc + number are coloured along a
// red -> blue -> green spectrum based on the SCORE itself (overpriced -> fair -> great), so the colour
// always renders (no fragile gradient URLs) and shades smoothly between the three anchors.
interface DealScoreGaugeProps {
  score: number; // 0-100
  label?: string; // optional, for accessibility only
}

const ARC_RADIUS = 42;
const ARC_LENGTH = Math.PI * ARC_RADIUS; // half-circle circumference

// Internal-label -> colour, kept for the text labels next to the gauge (great/good/fair/overpriced).
export function colorForLabel(label?: string): string {
  switch (label) {
    case "GREAT DEAL": return "#22c55e";
    case "GOOD DEAL":  return "#10b981";
    case "FAIR DEAL":  return "#3b82f6";
    case "OVERPRICED": return "#e8a13a";
    default:           return "#9a9aa2";
  }
}

// Display-only playful label for the deal score.
export function funLabel(label?: string): string {
  switch (label) {
    case "GREAT DEAL":  return "Send it 🚀";
    case "GOOD DEAL":   return "Cop it 🤝";
    case "FAIR DEAL":   return "Fair play ⚖️";
    case "OVERPRICED":  return "Raise the floor 📈";
    default:            return label ?? "";
  }
}

// Smoothly interpolate the deal spectrum: 0 = amber (premium ask), 50 = blue (fair), 100 = green (great deal).
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
export function scoreColor(score: number): string {
  const AMBER = [232, 161, 58], BLUE = [59, 130, 246], GREEN = [34, 197, 94];
  const t = Math.max(0, Math.min(100, score)) / 100;
  const [a, b, k] = t <= 0.5 ? [AMBER, BLUE, t / 0.5] : [BLUE, GREEN, (t - 0.5) / 0.5];
  return toHex(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
}

export function DealScoreGauge({ score }: DealScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const filled = (clamped / 100) * ARC_LENGTH;
  const color = scoreColor(clamped);

  return (
    <svg viewBox="0 0 100 58" width="64" height="38" className="mx-auto" aria-hidden>
      {/* track */}
      <path
        d="M 8 50 A 42 42 0 0 1 92 50"
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        style={{ stroke: "var(--rc-divider)" }}
      />
      {/* coloured fill up to the score */}
      <path
        d="M 8 50 A 42 42 0 0 1 92 50"
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${ARC_LENGTH}`}
      />
      <text x="50" y="46" textAnchor="middle" fontSize="22" fontWeight="800" fill={color}>
        {Math.round(clamped)}
      </text>
    </svg>
  );
}
