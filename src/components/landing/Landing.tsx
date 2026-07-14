import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { formatXchShort } from "@/lib/format";

// Landing (logged-out home). Browsing/shopping is the headline product; portfolio tracking is the
// supporting act. "Gold Standard" art direction: a warm vault backdrop with engraved security-paper
// texture, a gold-foil headline, a minted CTA, drifting gold dust, and a floating fan of collectible
// cards beside the headline. All motion is CSS-only and disabled under prefers-reduced-motion.
// Theme-aware: .tf-land-bg scopes --title/--subtle/--card-bg/--card-border and the tf-* helpers carry
// light-mode overrides. The hero fan is DATA-DRIVEN — `featured` (top-3 trending, from the server) fills
// real character art + floors, each linking into its collection; a stylized trio is the fallback.

type Featured = { id: string; name: string; imageUrl: string | null; floorXch: number | null };

// A card as the fan renders it: either real art (img + href) or a stylized fallback (glyph + art gradient).
type FanItem = { name: string; tag: string; href?: string; img?: string | null; glyph?: string; art?: string };

const FEATURES = [
  { icon: "◎", dot: "#f0c000", title: "Real deal scores", body: "Every listing judged against real recent sale prices — so you know a steal on sight." },
  { icon: "❖", dot: "#a8d0ff", title: "Shop by trait", body: "Filter to the exact traits and rarity you collect, across every collection." },
  { icon: "▲", dot: "#5fce7a", title: "True floors", body: "The cheapest clean XCH price, reconciled across MintGarden + Dexie." },
];

// Stylized fallback trio (order: [center/hero, left, right]) when trending data isn't available.
const FALLBACK: FanItem[] = [
  { name: "GRAIL #1", tag: "MYTHIC", glyph: "👽", art: "radial-gradient(ellipse at 42% 40%,#3a2606,#1a1206)" },
  { name: "APE #204", tag: "RARE", glyph: "🐵", art: "linear-gradient(160deg,#3a1c5e,#241242)" },
  { name: "FOX #77", tag: "EPIC", glyph: "🦊", art: "linear-gradient(160deg,#0a3a66,#0a2340)" },
];

// Deterministic (SSR-safe) gold-dust motes: left%, top%, size px, duration s, delay s.
const DUST = [
  { l: 10, t: 22, s: 3, d: 15, delay: 0 }, { l: 20, t: 40, s: 2, d: 18, delay: 2.5 },
  { l: 32, t: 14, s: 4, d: 20, delay: 1 }, { l: 44, t: 33, s: 2, d: 16, delay: 4 },
  { l: 56, t: 20, s: 3, d: 19, delay: 3 }, { l: 66, t: 42, s: 2, d: 17, delay: 1.8 },
  { l: 74, t: 16, s: 4, d: 21, delay: 5 }, { l: 84, t: 34, s: 2, d: 15, delay: 2 },
  { l: 90, t: 24, s: 3, d: 18, delay: 3.6 }, { l: 15, t: 52, s: 2, d: 20, delay: 6 },
  { l: 50, t: 48, s: 3, d: 22, delay: 4.5 }, { l: 78, t: 50, s: 2, d: 19, delay: 5.5 },
];

// The visible card body (art zone + foot). Real cards get an <Image>; fallbacks get a glyph on a gradient.
function CardBody({ item }: { item: FanItem }) {
  return (
    <div className="tf-fan-card">
      <div className="tf-fan-art" style={item.art ? { background: item.art } : undefined}>
        {item.img ? (
          <Image src={item.img} alt={item.name} fill sizes="200px" unoptimized className="object-cover" />
        ) : (
          <span className="tf-fan-glyph">{item.glyph}</span>
        )}
      </div>
      <div className="tf-fan-foot">
        <span className="truncate">{item.name}</span>
        <span className="tf-fan-rank">{item.tag}</span>
      </div>
    </div>
  );
}

// One fan slot. Wraps the card in a link when it's a real collection; otherwise renders inert.
function Slot({ item, slot, hero, chip }: { item: FanItem; slot: string; hero?: boolean; chip?: string }) {
  const body = hero ? (
    <div className="tf-holo-frame">
      {chip && <span className="tf-deal-chip">{chip}</span>}
      <CardBody item={item} />
    </div>
  ) : (
    <CardBody item={item} />
  );
  const wrapped = item.href ? (
    <Link href={item.href} aria-label={`${item.name} — open collection`} className="block h-full w-full">{body}</Link>
  ) : body;
  return (
    <div className={`tf-fan-slot ${slot}`}>
      <div className="tf-fan-bob">{wrapped}</div>
    </div>
  );
}

export function Landing({ featured = [] }: { featured?: Featured[] }) {
  const usingReal = featured.length >= 3;
  const items: FanItem[] = usingReal
    ? featured.slice(0, 3).map((c) => ({
        name: c.name,
        tag: c.floorXch != null ? formatXchShort(c.floorXch) : "TRENDING",
        href: `/collection/${c.id}`,
        img: c.imageUrl,
      }))
    : FALLBACK;
  // items[0] = hero (center), [1] = left, [2] = right.
  const heroChip = usingReal ? "🔥 TRENDING" : "DEAL +38%";

  return (
    <div className="tf-land-bg relative min-h-screen w-full overflow-hidden" style={{ color: "var(--title)" }}>
      {/* Engraved security-paper texture over the top of the hero */}
      <div className="tf-land-paper" aria-hidden />
      {/* Drifting gold dust */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {DUST.map((p, i) => (
          <span key={i} className="tf-dust" style={{ left: `${p.l}%`, top: `${p.t}%`, width: p.s, height: p.s, animationDuration: `${p.d}s`, animationDelay: `${p.delay}s` }} />
        ))}
      </div>

      {/* Nav */}
      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
        <Link href="/" aria-label="Traitfolio home" className="flex items-center gap-2">
          <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-8 w-auto sm:h-9" priority />
          <Wordmark className="text-xl sm:text-2xl" />
        </Link>
        <div className="flex items-center gap-5 text-sm font-semibold" style={{ color: "var(--subtle)" }}>
          <Link href="/browse" className="hidden transition hover:text-title sm:inline">Browse</Link>
          <Link href="/binder" className="transition hover:text-title">Your Binder</Link>
          <ThemeToggle />
        </div>
      </nav>

      <main className="relative z-10 mx-auto max-w-6xl px-6 sm:px-8">
        {/* ── HERO: headline + floating card fan ──────────────────────────────── */}
        <section className="pt-8 sm:pt-14">
          <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]">
            {/* Left: copy */}
            <div className="text-center lg:text-left">
              <span className="tf-eyebrow inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]">
                Every Chia NFT collection · live deals
              </span>
              <h1 className="mx-auto mt-6 max-w-2xl text-balance text-5xl font-black leading-[1.03] tracking-tight sm:text-6xl lg:mx-0 lg:text-6xl xl:text-7xl">
                Shop every <span className="whitespace-nowrap">Chia NFT.</span>
                <br />
                <span className="tf-foil">Spot the real deals.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed sm:text-lg lg:mx-0" style={{ color: "var(--subtle)" }}>
                Browse every collection in one place — filter by trait, sort by rarity, and see
                sale-based values and deal scores so you know what&apos;s a steal before you buy.
              </p>
              <div className="mt-9">
                <Link href="/browse" className="tf-mint group inline-flex items-center gap-2.5 rounded-full px-8 py-4 text-lg font-bold">
                  <svg aria-hidden viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.4-3.4" />
                  </svg>
                  Browse &amp; Shop Collections
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
                </Link>
              </div>
            </div>

            {/* Right: floating card fan (real trending art when available) */}
            <div className="-my-6 flex justify-center sm:my-0 lg:justify-end" {...(usingReal ? {} : { "aria-hidden": true })}>
              <div className="tf-fan scale-[0.82] sm:scale-90 lg:scale-100">
                <Slot item={items[1]} slot="tf-fan-slot--l" />
                <Slot item={items[2]} slot="tf-fan-slot--r" />
                <Slot item={items[0]} slot="tf-fan-slot--c" hero chip={heroChip} />
              </div>
            </div>
          </div>

          {/* Feature plaques */}
          <div className="mt-12 grid gap-3 pb-14 sm:mt-16 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="tf-plaque">
                <div className="flex items-center gap-2">
                  <span className="tf-plaque-chip grid h-7 w-7 place-items-center rounded-lg text-sm font-black" style={{ ["--dot"]: f.dot } as CSSProperties}>{f.icon}</span>
                  <span className="text-sm font-black tracking-wide" style={{ color: "var(--title)" }}>{f.title}</span>
                </div>
                <div className="mt-2 text-[13px] leading-snug" style={{ color: "var(--subtle)" }}>{f.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── SECONDARY: portfolio band ───────────────────────────────────────── */}
        <section className="pb-20">
          <div className="tf-band relative flex flex-col items-center justify-between gap-5 overflow-hidden rounded-2xl px-6 py-6 sm:flex-row sm:px-9 sm:py-7">
            <span aria-hidden className="tf-band-edge absolute inset-y-0 left-0 w-1" />
            <div className="text-center sm:text-left">
              <h2 className="text-xl font-black sm:text-2xl">Track your whole binder</h2>
              <p className="mt-1.5 text-sm" style={{ color: "var(--subtle)" }}>
                Paste a wallet or DID to value everything you own in one binder — instantly, no account needed.
              </p>
            </div>
            <Link href="/binder" className="tf-band-btn inline-flex shrink-0 items-center gap-2 rounded-full px-6 py-3 text-sm font-bold">
              Value a wallet <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="tf-foot relative z-10 mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row sm:px-8">
        <Link href="/" aria-label="Traitfolio home" className="flex items-center gap-2 opacity-90">
          <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-6 w-auto" />
          <Wordmark className="text-base" />
        </Link>
        <p className="text-xs" style={{ color: "var(--subtle)" }}>The home of digital collecting on Chia.</p>
      </footer>
    </div>
  );
}
