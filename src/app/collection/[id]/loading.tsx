// Instant skeleton while the live collection page server-renders (collection meta + first cards +
// floor). Theme-aware so it reads in light and dark. Keeps navigation feeling immediate.
function Shimmer({ className = "" }: { className?: string }) {
  // Neutral gray (not the gold --card-border) so the skeleton reads as a plain placeholder in both
  // themes instead of flashing "golden squares" that look like the collection's branded border.
  return <div className={`animate-pulse ${className}`} style={{ background: "rgba(128,128,128,0.18)" }} />;
}

export default function CollectionLoading() {
  const panel = { background: "var(--card-bg)", border: "1px solid var(--card-border)" };
  return (
    <div className="py-2">
      <div className="mb-4 flex items-center gap-4 rounded-2xl px-5 py-4" style={panel}>
        <Shimmer className="h-14 w-14 rounded-xl" />
        <div className="flex-1">
          <Shimmer className="h-6 w-48 rounded" />
          <Shimmer className="mt-2 h-4 w-32 rounded" />
        </div>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Shimmer key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="flex gap-4">
        <Shimmer className="hidden h-[420px] w-[248px] shrink-0 rounded-xl md:block" />
        <div className="grid flex-1 grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 15 }).map((_, i) => (
            <Shimmer key={i} className="aspect-[5/7] rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
