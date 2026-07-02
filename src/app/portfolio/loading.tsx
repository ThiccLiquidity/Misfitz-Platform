// Instant skeleton while the server values an address (the live MintGarden fetch + valuation can take a
// moment for a large wallet). Uses theme CSS variables so it's visible in BOTH light and dark — the old
// hardcoded white-alpha version was invisible on the light page.
function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded ${className}`} style={{ background: "rgba(128,128,128,0.18)" }} />
  );
}

export default function PortfolioLoading() {
  return (
    <div className="mx-auto max-w-6xl">
      <Shimmer className="mt-2 h-8 w-2/3" />
      <Shimmer className="mt-3 h-4 w-1/2" />
      <Shimmer className="mt-6 h-12 max-w-2xl rounded-lg" />
      <Shimmer className="mt-8 h-24 rounded-xl" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Shimmer key={i} className="aspect-[5/7] rounded-[9px]" />
        ))}
      </div>
    </div>
  );
}
