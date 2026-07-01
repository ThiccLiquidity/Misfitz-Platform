// Instant skeleton while /browse server-renders the trending collections. Theme-aware.
function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse ${className}`} style={{ background: "rgba(128,128,128,0.18)" }} />;
}

export default function BrowseLoading() {
  return (
    <div className="px-2">
      <Shimmer className="mb-4 h-11 max-w-xl rounded-lg" />
      <Shimmer className="mb-3 h-4 w-40 rounded" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 18 }).map((_, i) => (
          <Shimmer key={i} className="aspect-[3/4] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
