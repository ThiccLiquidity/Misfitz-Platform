import Link from "next/link";
import Image from "next/image";

// Real, code-built landing. Everything here is a live HTML element — the buttons are actual links
// that route, the layout is responsive, and it fills the viewport. Brand art is the clean logo
// lockup (transparent PNG), not a sliced photo.
export function Landing() {
  return (
    <section className="tf-hero -mx-4 -mt-3 min-h-[calc(100vh-3.5rem)] md:-mx-8">
      <div className="mx-auto flex max-w-4xl flex-col items-center justify-center px-5 py-12 text-center">
        <Image
          src="/brand/logo-full.png"
          alt="Traitfolio — The home of digital collecting"
          width={705}
          height={656}
          className="h-auto w-full max-w-[260px] sm:max-w-xs"
          priority
        />

        <h1 className="mt-6 text-3xl font-black tracking-tight text-[#171327] sm:text-4xl">
          THE HOME OF <span className="tf-grad">DIGITAL</span> COLLECTING.
        </h1>
        <p className="mt-3 text-xl font-black">
          <span className="text-[#7c3aed]">Discover.</span>{" "}
          <span className="text-[#2563eb]">Collect.</span>{" "}
          <span className="text-[#e0399b]">Showcase.</span>
        </p>

        <div className="mt-8 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
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

        <div className="mt-4 w-full max-w-2xl">
          <div className="flex items-center gap-3 rounded-full border border-black/10 bg-white/90 px-5 py-3.5 text-left text-sm text-slate-500 shadow-sm">
            <span aria-hidden>🔍</span>
            <span>Search NFTs, Collections, Traits or Collectors…</span>
          </div>
        </div>

        <p className="mt-10 text-sm font-semibold text-[#2a2350]">
          Built for collectors. Not corporations. 💜
        </p>
      </div>
    </section>
  );
}
