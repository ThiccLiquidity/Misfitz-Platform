import { BinderLoadingNote } from "@/components/binder/BinderLoadingNote";
import { LoadingBar } from "@/components/status/WorkingIndicator";

// Shown automatically by Next while the binder server-renders (i.e. while we read the wallet). Uses
// theme CSS variables (set on the app shell) so the skeleton is visible in BOTH light and dark — the
// earlier white-alpha version was invisible on the light page.
function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className}`}
      style={{ background: "rgba(128,128,128,0.18)" }}
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

      <div className="mx-2 mb-4 flex flex-col gap-2 rounded-xl px-4 py-5" style={panel}>
        <LoadingBar label="Loading your binder…" />
        <BinderLoadingNote />
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
