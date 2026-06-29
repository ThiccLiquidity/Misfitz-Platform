import Image from "next/image";

// Landing = the full Traitfolio mockup, fit to the viewport. Invisible <a> hotspots sit exactly
// over the baked-in buttons (aligned visually against the live page) so they route for real.
export function Landing() {
  return (
    <div className="tf-hero flex min-h-screen w-full items-center justify-center">
      <div className="relative">
        <Image
          src="/brand/landing-hero.png"
          alt="Traitfolio — The home of digital collecting"
          width={1536}
          height={1024}
          className="block max-h-screen w-auto max-w-full"
          priority
        />

        <a href="/" aria-label="Traitfolio home" className="absolute" style={{ left: "4%", top: "3%", width: "32%", height: "8%" }} />
        <a href="/browse" aria-label="Browse collections" className="absolute" style={{ left: "70%", top: "5%", width: "13%", height: "5%" }} />
        <a href="/login" aria-label="Open my binder" className="absolute" style={{ left: "16%", top: "74.5%", width: "22%", height: "10%" }} />
        <a href="/signup" aria-label="Create account" className="absolute" style={{ left: "39%", top: "74.5%", width: "22%", height: "10%" }} />
        <a href="/browse" aria-label="Explore NFTs" className="absolute" style={{ left: "62%", top: "74.5%", width: "22%", height: "10%" }} />
      </div>
    </div>
  );
}
