import Image from "next/image";
import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";

// Landing = the hero image (nav strip erased) with a REAL nav (logo + Browse) on top, so there's
// no baked toggle/artifacts. Invisible <a> hotspots sit over the baked CTA buttons.
export function Landing() {
  return (
    <div className="tf-hero w-full">
      <div className="relative w-full">
        <Image
          src="/brand/landing-hero-v3.png"
          alt="Traitfolio — The home of digital collecting"
          width={2056}
          height={1024}
          className="block w-full"
          priority
        />

        {/* real nav over the cleared top strip */}
        <nav className="absolute inset-x-0 top-0 flex items-center justify-between px-6 sm:px-10" style={{ height: "12.5%" }}>
          <Link href="/" aria-label="Traitfolio home" className="flex items-center gap-2">
            <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-8 w-auto sm:h-10" priority />
            <Wordmark className="text-xl sm:text-2xl" />
          </Link>
          <Link
            href="/browse"
            className="flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white"
          >
            <span aria-hidden>🔍</span> Browse Collections
          </Link>
        </nav>

        {/* CTA hotspots */}
        <a href="/binder" aria-label="Open my binder" className="absolute" style={{ left: "24.6%", top: "74.5%", width: "16.4%", height: "10%" }} />
        <a href="/signup" aria-label="Create account" className="absolute" style={{ left: "41.8%", top: "74.5%", width: "16.4%", height: "10%" }} />
        <a href="/browse" aria-label="Explore NFTs" className="absolute" style={{ left: "59%", top: "74.5%", width: "16.4%", height: "10%" }} />
      </div>
    </div>
  );
}
