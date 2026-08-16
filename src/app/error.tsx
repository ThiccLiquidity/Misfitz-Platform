"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Route-level error boundary: any thrown error while rendering a page shows this instead of a crash.
// "Try again" re-runs the failed render (transient network / upstream hiccups usually clear).
//
// It also has to be DEBUGGABLE. In production React replaces the message with an opaque `digest`, so a user
// reporting "something went wrong" previously handed over exactly zero information — and this component
// only console.error'd in development, i.e. never where it mattered. Now it always logs, and it shows the
// digest with a copy button so a report can be tied to the matching server log line.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // Always, including production — this is the only breadcrumb a user can actually hand back.
    console.error("[route-error]", error?.digest ? `digest=${error.digest}` : "", error);
  }, [error]);

  const detail = [error?.digest ? `digest ${error.digest}` : null, error?.message || null].filter(Boolean).join(" · ");

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
      {detail && (
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(detail).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
          className="text-subtle mt-6 max-w-full truncate rounded-md border border-white/10 px-3 py-1.5 font-mono text-[11px] opacity-70 hover:opacity-100"
          title="Copy this and send it over — it ties your report to the exact server log line"
        >
          {copied ? "copied ✓" : detail}
        </button>
      )}
    </div>
  );
}
