import Link from "next/link";

// 404 — a bad or stale URL should land somewhere friendly, not a raw Next error.
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <div className="text-5xl" aria-hidden>🧭</div>
      <h1 className="text-title mt-4 text-2xl font-black">Page not found</h1>
      <p className="text-subtle mt-2 text-sm">
        That link doesn&apos;t point anywhere on Traitfolio. It may have moved, or the collection is no
        longer listed.
      </p>
      <div className="mt-6 flex gap-3">
        <Link href="/browse" className="rounded-lg px-5 py-2.5 text-sm font-bold text-black" style={{ background: "rgba(56,189,248,0.95)" }}>
          Browse collections
        </Link>
        <Link href="/" className="text-title rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold">
          Home
        </Link>
      </div>
    </div>
  );
}
