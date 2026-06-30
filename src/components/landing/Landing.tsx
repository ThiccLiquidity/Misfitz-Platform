import Image from "next/image";
import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";

// Landing (logged-out home). Browsing/shopping is the headline product, portfolio tracking is the
// secondary act. Built in HTML (not a baked hero image) so the hierarchy is real and maintainable.
export function Landing() {
  return (
    <div className="tf-hero min-h-screen w-full" style={{ background: "var(--vault-bg)", color: "var(--title)" }}>
      {/* Nav: brand only. The old top-right "Browse Collections" button was redundant with the hero CTA. */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
        <Link href="/" aria-label="Traitfolio home" className="flex items-center gap-2">
          <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-8 w-auto sm:h-9" priority />
          <Wordmark className="text-xl sm:text-2xl" />
        </Link>
        <div className="flex items-center gap-5 text-sm font-semibold" style={{ color: "var(--subtle)" }}>
          <Link href="/binder" className="hidden transition hover:text-title sm:inline">Track a wallet</Link>
          <Link href="/login" className="transition hover:text-title">Log in</Link>
          <Link
            href="/signup"
            className="rounded-full px-4 py-2 text-[var(--vault-bg)] shadow-sm transition hover:opacity-90"
            style={{ background: "var(--card-border)" }}
          >
            Sign up
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-6 sm:px-8">
        {/* ── HERO: Browse & Shop (the dominant act) ───────────────────────────────── */}
        <section className="pt-12 pb-14 text-center sm:pt-20 sm:pb-20">
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest"
            style={{ background: "rgba(201,162,39,0.12)", color: "var(--title)", border: "1px solid rgba(201,162,39,0.35)" }}
          >
            Every Chia NFT collection · live deals
          </span>
          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            Shop every Chia NFT.
            <br />
            <span className="tf-folio-gradient">Spot the real deals.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base sm:text-xl" style={{ color: "var(--subtle)" }}>
            Browse and shop every collection in one place — filter by trait, sort by rarity, and see
            sale-based values and deal scores so you know what&apos;s actually a steal before you buy.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/browse"
              className="group inline-flex items-center gap-2 rounded-full px-8 py-4 text-lg font-bold text-[var(--vault-bg)] shadow-lg transition hover:opacity-90"
              style={{ background: "linear-gradient(90deg, #f0c000 0%, #ffe577 50%, #c89000 100%)" }}
            >
              <span aria-hidden>🔍</span> Browse &amp; Shop Collections
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          </div>

          {/* What you get — reinforces the shopping value prop */}
          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { icon: "🏷️", title: "Real deal scores", body: "Listings judged against actual recent sale prices." },
              { icon: "🎯", title: "Shop by trait", body: "Filter to the exact traits and rarity you collect." },
              { icon: "💎", title: "True floors", body: "Cheapest clean XCH price across MintGarden + Dexie." },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-2xl px-5 py-5 text-left"
                style={{ background: "var(--card-bg)", border: "1px solid rgba(201,162,39,0.22)" }}
              >
                <div className="text-2xl">{f.icon}</div>
                <div className="mt-2 font-bold">{f.title}</div>
                <div className="mt-1 text-sm" style={{ color: "var(--subtle)" }}>{f.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── SECONDARY: Portfolio tracking (smaller, supporting act) ──────────────── */}
        <section className="pb-16">
          <div
            className="mx-auto max-w-2xl rounded-3xl px-6 py-10 text-center sm:px-10"
            style={{ background: "var(--page-bg)", border: "1px solid rgba(201,162,39,0.25)" }}
          >
            {/* rarity-spectrum accent — ties the section to the brand without a photo */}
            <div className="mx-auto mb-6 flex h-1.5 w-28 overflow-hidden rounded-full">
              {["#cc66ff", "#f0c000", "#a8d0ff", "#ff6060", "#5fce7a", "#6090e0"].map((c) => (
                <span key={c} className="flex-1" style={{ background: c }} />
              ))}
            </div>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--subtle)" }}>
              Also on Traitfolio
            </span>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">Track your portfolio</h2>
            <p className="mx-auto mt-3 max-w-md text-sm sm:text-base" style={{ color: "var(--subtle)" }}>
              Paste a wallet address or DID to value an entire collection of holdings instantly —
              rarity, estimated value, and tier breakdown. No account needed.
            </p>
            <Link
              href="/binder"
              className="mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition hover:bg-[rgba(201,162,39,0.12)]"
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
        style={{ borderTop: "1px solid rgba(201,162,39,0.18)" }}
      >
        <Link href="/" aria-label="Traitfolio home" className="flex items-center gap-2 opacity-90">
          <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-6 w-auto" />
          <Wordmark className="text-base" />
        </Link>
        <p className="text-xs" style={{ color: "var(--subtle)" }}>
          The home of digital collecting on Chia.
        </p>
      </footer>
    </div>
  );
}
