import Image from "next/image";
import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

// Landing (logged-out home). Browsing/shopping is the headline product; portfolio tracking is the
// supporting act. HTML (not a baked image) so layout/hierarchy is real and maintainable.
const FEATURES = [
  { dot: "#f0c000", title: "Real deal scores", body: "Listings judged against real recent sale prices." },
  { dot: "#a8d0ff", title: "Shop by trait", body: "Filter to the exact traits and rarity you collect." },
  { dot: "#5fce7a", title: "True floors", body: "Cheapest clean XCH across MintGarden + Dexie." },
];

export function Landing() {
  return (
    <div
      className="tf-hero min-h-screen w-full"
      style={{
        color: "var(--title)",
        background:
          "radial-gradient(120% 55% at 50% -5%, rgba(201,162,39,0.13), transparent 60%), var(--vault-bg)",
      }}
    >
      {/* Nav: brand only. The old top-right "Browse Collections" button was redundant with the hero CTA. */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
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

      <main className="mx-auto max-w-6xl px-6 sm:px-8">
        {/* ── HERO: Browse & Shop (the dominant act) ───────────────────────────────── */}
        <section className="pt-14 pb-16 text-center sm:pt-24 sm:pb-24">
          <span
            className="inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ background: "rgba(201,162,39,0.10)", color: "var(--title)", border: "1px solid rgba(201,162,39,0.30)" }}
          >
            Every Chia NFT collection · live deals
          </span>
          <h1 className="mx-auto mt-7 max-w-4xl text-5xl font-black leading-[1.03] tracking-tight sm:text-7xl">
            Shop every Chia NFT.
            <br />
            <span className="tf-folio-gradient">Spot the real deals.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed sm:text-lg" style={{ color: "var(--subtle)" }}>
            Browse every collection in one place — filter by trait, sort by rarity, and see
            sale-based values and deal scores so you know what&apos;s a steal before you buy.
          </p>

          <div className="mt-10">
            <Link
              href="/browse"
              className="group inline-flex items-center gap-2 rounded-full px-8 py-4 text-lg font-bold shadow-[0_8px_30px_rgba(201,162,39,0.25)] transition hover:opacity-90"
              style={{ background: "linear-gradient(90deg, #f0c000 0%, #ffe577 50%, #c89000 100%)", border: "1px solid rgba(150,110,0,0.5)", color: "#1a1200" }}
            >
              <span aria-hidden>🔍</span> Browse &amp; Shop Collections
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          </div>

          {/* Feature row — borderless, hairline dividers, no bulky boxes */}
          <div className="mx-auto mt-16 flex max-w-3xl flex-col sm:flex-row">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`flex-1 px-6 py-4 sm:py-2 ${i > 0 ? "sm:border-l" : ""}`}
                style={{ borderColor: "rgba(201,162,39,0.18)" }}
              >
                <div className="flex items-center justify-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: f.dot }} />
                  <span className="text-sm font-bold tracking-wide" style={{ color: "var(--title)" }}>{f.title}</span>
                </div>
                <div className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--subtle)" }}>{f.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── SECONDARY: Portfolio tracking — slim, elegant band ───────────────────── */}
        <section className="pb-20">
          <div
            className="flex flex-col items-center justify-between gap-5 rounded-2xl px-6 py-6 sm:flex-row sm:px-9 sm:py-7"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(201,162,39,0.20)" }}
          >
            <div className="text-center sm:text-left">
              <h2 className="text-xl font-black sm:text-2xl">Track your portfolio</h2>
              <p className="mt-1.5 text-sm" style={{ color: "var(--subtle)" }}>
                Paste a wallet or DID to value an entire collection of holdings instantly. No account needed.
              </p>
            </div>
            <Link
              href="/binder"
              className="inline-flex shrink-0 items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition hover:bg-[rgba(201,162,39,0.12)]"
              style={{ color: "var(--title)", border: "1px solid var(--card-border)" }}
            >
              Value a wallet <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row sm:px-8"
        style={{ borderTop: "1px solid rgba(201,162,39,0.15)" }}
      >
        <Link href="/" aria-label="Traitfolio home" className="flex items-center gap-2 opacity-90">
          <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-6 w-auto" />
          <Wordmark className="text-base" />
        </Link>
        <p className="text-xs" style={{ color: "var(--subtle)" }}>The home of digital collecting on Chia.</p>
      </footer>
    </div>
  );
}
