import Image from "next/image";

// Landing = the full Traitfolio mockup, widened so its gradient fills the screen edge-to-edge
// (no side margins). Invisible <a> hotspots sit over the baked-in buttons so they route for real.
export function Landing() {
  return (
    <div className="tf-hero w-full">
      <div className="relative w-full">
        <Image
          src="/brand/landing-hero-v2.png"
          alt="Traitfolio — The home of digital collecting"
          width={2056}
          height={1024}
          className="block w-full"
          priority
        />

        <a href="/" aria-label="Traitfolio home" className="absolute" style={{ left: "15.6%", top: "3%", width: "23.9%", height: "8%" }} />
        <a href="/browse" aria-label="Browse collections" className="absolute" style={{ left: "64.9%", top: "5%", width: "9.7%", height: "5%" }} />
        <a href="/login" aria-label="Open my binder" className="absolute" style={{ left: "24.6%", top: "74.5%", width: "16.4%", height: "10%" }} />
        <a href="/signup" aria-label="Create account" className="absolute" style={{ left: "41.8%", top: "74.5%", width: "16.4%", height: "10%" }} />
        <a href="/browse" aria-label="Explore NFTs" className="absolute" style={{ left: "59%", top: "74.5%", width: "16.4%", height: "10%" }} />
      </div>
    </div>
  );
}
