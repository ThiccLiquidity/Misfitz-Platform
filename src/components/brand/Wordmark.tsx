// Traitfolio wordmark: "TRAIT" in the theme title color, "FOLIO" in the rainbow brand gradient.
// Pure text so it stays crisp at any size; the rainbow nods at the rarity spectrum.
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-black tracking-tight ${className}`} style={{ fontFamily: "var(--font-righteous), sans-serif" }}>
      <span className="text-title">TRAIT</span>
      <span className="tf-folio-gradient">FOLIO</span>
    </span>
  );
}
