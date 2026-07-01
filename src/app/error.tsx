"use client";

import Link from "next/link";
import { useEffect } from "react";

// Route-level error boundary: any thrown error while rendering a page shows this instead of a crash.
// "Try again" re-runs the failed render (transient network / upstream hiccups usually clear).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <div className="text-5xl" aria-hidden>😵‍💫</div>
      <h1 className="text-title mt-4 text-2xl font-black">Something went wrong</h1>
      <p className="text-subtle mt-2 text-sm">
        We hit a snag loading this. It&apos;s often a temporary hiccup reaching MintGarden or Dexie —
        trying again usually clears it.
      </p>
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={reset} className="rounded-lg px-5 py-2.5 text-sm font-bold text-black" style={{ background: "rgba(56,189,248,0.95)" }}>
          Try again
        </button>
        <Link href="/browse" className="text-title rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold">
          Browse collections
        </Link>
      </div>
    </div>
  );
}
