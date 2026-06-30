import { BinderLoadingNote } from "@/components/binder/BinderLoadingNote";

// Shown automatically by Next while the binder server-renders (i.e. while we read the wallet). Uses
// theme CSS variables (set on the app shell) so the skeleton is visible in BOTH light and dark — the
// earlier white-alpha version was invisible on the light page.
function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className}`}
      style={{ background: "var(--card-border)", opacity: 0.16 }}
    />
  );
}

export default function BinderLoading() {
  const panel = { background: "var(--card-bg)", border: "1px solid var(--card-border)" };
  return (
    <div className="py-2">
      <div className="mb-3 px-2">
        <h1 className="text-title text-xl font-bold">Your Binder</h1>
      </div>

      <div className="mx-2 mb-4 flex items-center gap-3 rounded-xl px-4 py-5" style={panel}>
        <div
          className="h-6 w-6 shrink-0 animate-spin rounded-full"
          style={{ border: "2px solid var(--card-border)", borderTopColor: "transparent" }}
        />
        <div>
          <div className="text-title text-sm font-semibold">Loading your binder…</div>
          <BinderLoadingNote />
        </div>
      </div>

      {/* Value-header skeleton */}
      <div className="mx-2 mb-4 flex flex-wrap gap-8 rounded-2xl px-6 py-6" style={panel}>
        <Shimmer className="h-12 w-40" />
        <Shimmer className="h-12 w-40" />
      </div>

      {/* Card-grid skeleton */}
      <div className="mx-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Shimmer key={i} className="aspect-[5/7]" />
        ))}
      </div>
    </div>
  );
}
