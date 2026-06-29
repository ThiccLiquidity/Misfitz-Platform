import { Wordmark } from "@/components/brand/Wordmark";

// Placeholder for the photographic binder hero. Echoes the cover (spine + holographic T sticker +
// wordmark + Collect/Showcase/Trade badge) so the layout reads right until the real PNG is dropped
// into /public/brand/hero-binder.png and swapped in here.
export function BinderHero() {
  return (
    <div className="relative mx-auto aspect-[7/6] w-full max-w-md select-none">
      <div className="absolute inset-0 rounded-2xl shadow-2xl tf-binder-cover">
        {/* spine */}
        <div className="absolute inset-y-0 left-0 w-5 rounded-l-2xl bg-black/40" />
        {/* badge */}
        <div className="absolute right-4 top-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-300 text-center text-[8px] font-black uppercase leading-tight text-black">
          Collect<br />Showcase<br />Trade
        </div>
        {/* holographic T sticker */}
        <div className="absolute left-1/2 top-1/2 flex h-28 w-24 -translate-x-1/2 -translate-y-[70%] items-center justify-center rounded-xl tf-holo">
          <span className="text-5xl font-black text-white drop-shadow">T</span>
        </div>
        {/* wordmark */}
        <div className="absolute inset-x-0 bottom-10 text-center">
          <Wordmark className="text-3xl" />
        </div>
        {/* zipper hint */}
        <div className="absolute bottom-3 right-5 h-6 w-4 rounded-sm tf-holo" />
      </div>
      <p className="text-subtle absolute -bottom-6 left-0 right-0 text-center text-[10px] opacity-60">
        placeholder — drop hero art at /public/brand/hero-binder.png
      </p>
    </div>
  );
}
