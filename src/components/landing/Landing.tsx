import Link from "next/link";
import Image from "next/image";

// Landing = the full branded mockup image, shown as-is so the page looks exactly like the artwork.
// Invisible <Link> hotspots sit over the baked-in buttons so they actually work. Positions are
// percentages of the image, so they stay aligned at every size. (Fine-tuned against a screenshot.)
export function Landing() {
  return (
    <div className="relative mx-auto w-full max-w-6xl select-none">
      <Image
        src="/brand/landing-hero.png"
        alt="Traitfolio — The home of digital collecting"
        width={1536}
        height={1024}
        className="h-auto w-full"
        priority
      />

      {/* nav: logo -> home, Browse -> /browse */}
      <Link href="/" aria-label="Traitfolio home" className="absolute left-[1%] top-[0.5%] h-[8%] w-[22%]" />
      <Link href="/browse" aria-label="Browse collections" className="absolute right-[13%] top-[2%] h-[6%] w-[18%]" />

      {/* CTAs */}
      <Link href="/login" aria-label="Open my binder" className="absolute left-[6%] top-[61%] h-[9%] w-[24%]" />
      <Link href="/signup" aria-label="Create account" className="absolute left-[31%] top-[61%] h-[9%] w-[22%]" />
      <Link href="/browse" aria-label="Explore NFTs" className="absolute left-[55%] top-[61%] h-[9%] w-[24%]" />
    </div>
  );
}
