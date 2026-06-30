import { BinderLoadingNote } from "@/components/binder/BinderLoadingNote";

// Shown automatically by Next while the binder server-renders (i.e. while we fetch the wallet's
// holdings). Without this the browser just spun with a blank page; now the user gets immediate,
// branded "we're loading your wallet" feedback plus a skeleton of the layout to come.
function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/10 ${className}`} />;
}

export default function BinderLoading() {
  return (
    <div className="py-2">
      <div className="mb-3 px-2">
        <h1 className="text-title text-xl font-bold">Your Binder</h1>
      </div>

      <div className="mx-2 mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5">
        <div className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-amber-400" />
        <div>
          <div className="text-title text-sm font-semibold">Loading your binder…</div>
          <BinderLoadingNote />
        </div>
      </div>

      {/* Value-header skeleton */}
      <div className="mx-2 mb-4 flex flex-wrap gap-8 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-6">
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
