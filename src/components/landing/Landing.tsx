import Link from "next/link";
import Image from "next/image";

// Traitfolio landing (logged-out home). Two-column hero from the mockup: framed binder on the left,
// headline on the right, then the three CTAs + placeholder search over a warm gradient.
export function Landing() {
  return (
    <div className="tf-hero relative mx-auto max-w-6xl overflow-hidden rounded-3xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="grid items-center gap-8 lg:grid-cols-2">
        {/* Binder */}
        <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/5">
          <Image
            src="/brand/hero-binder.png"
            alt="Traitfolio collector binder"
            width={691}
            height={635}
            className="h-auto w-full"
            priority
          />
        </div>

        {/* Headline */}
        <div className="text-center lg:text-left">
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-[#171327] sm:text-5xl">
            THE HOME OF <span className="tf-grad">DIGITAL</span> COLLECTING.
          </h1>
          <p className="mt-4 text-2xl font-black tracking-tight">
            <span className="text-[#7c3aed]">Discover.</span>{" "}
            <span className="text-[#2563eb]">Collect.</span>{" "}
            <span className="text-[#e0399b]">Showcase.</span>
          </p>
        </div>
      </div>

      {/* CTAs */}
      <div className="mx-auto mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
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

      {/* Placeholder search */}
      <div className="mx-auto mt-4 max-w-4xl">
        <div
          className="flex items-center gap-3 rounded-full border border-black/5 bg-white/90 px-5 py-3.5 text-left text-sm text-slate-500 shadow-sm"
          title="Search is coming soon"
        >
          <span aria-hidden>🔍</span>
          <span>Search NFTs, Collections, Traits or Collectors…</span>
        </div>
      </div>

      <p className="mt-10 text-center text-sm font-semibold text-[#2a2350]">
        Built for collectors. Not corporations. 💜
      </p>
    </div>
  );
}
