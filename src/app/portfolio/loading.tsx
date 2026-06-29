// Instant skeleton while the server values an address (the live MintGarden fetch + valuation can
// take a moment for a large wallet).
export default function PortfolioLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse">
      <div className="mt-2 h-8 w-2/3 rounded bg-white/10" />
      <div className="mt-3 h-4 w-1/2 rounded bg-white/5" />
      <div className="mt-6 h-12 max-w-2xl rounded-lg bg-white/5" />
      <div className="mt-8 h-24 rounded-xl bg-white/[0.04]" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="aspect-[5/7] rounded-[9px] bg-white/[0.05]" />
        ))}
      </div>
    </div>
  );
}
