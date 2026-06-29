import Link from "next/link";
import Image from "next/image";

// Logged-out home (the "/" route). Three paths — your binder, create a profile, or explore — over
// the binder hero, with a placeholder search. Stats strip intentionally omitted for now.
export function Landing() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-4 text-center">
      <div className="mx-auto mt-4 max-w-md">
        <Image
          src="/brand/logo-full.png"
          alt="Traitfolio — The home of digital collecting"
          width={705}
          height={656}
          className="mx-auto h-auto w-full max-w-xs sm:max-w-sm"
          priority
        />
      </div>

      <p className="text-subtle mx-auto mt-6 max-w-xl text-lg">
        Track your collections. Discover new ones. Flex what you own.
      </p>

      <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
        <Link href="/login" className="tf-cta tf-cta-primary">
          <span className="text-base font-bold">Open My Binder</span>
          <span className="text-sm opacity-80">Sign In</span>
        </Link>
        <Link href="/signup" className="tf-cta tf-cta-dark">
          <span className="text-base font-bold">Create Account</span>
          <span className="text-sm opacity-80">Get Started</span>
        </Link>
        <Link href="/browse" className="tf-cta tf-cta-light">
          <span className="text-base font-bold">Browse Collections</span>
          <span className="text-sm opacity-70">Explore NFTs</span>
        </Link>
      </div>

      {/* Placeholder search — wired up later */}
      <div className="mx-auto mt-6 max-w-2xl">
        <div
          className="text-subtle flex items-center gap-3 rounded-full border border-page-border bg-card-bg px-5 py-3.5 text-left text-sm opacity-80"
          title="Search is coming soon"
        >
          <span aria-hidden>🔍</span>
          <span>Search NFTs, Collections, Traits or Collectors…</span>
        </div>
      </div>

      <p className="text-subtle mt-14 text-sm">Built for collectors. Not corporations. 💜</p>
    </div>
  );
}
