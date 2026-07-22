import { isValidChiaOwnerId } from "@/lib/wallet/ownerId";
import { getMyHoldingsFast, binderGate } from "@/lib/portfolio/myHoldings";
import { YourBinder } from "@/components/binder/YourBinder";
import { WalletProfileBar } from "@/components/portfolio/WalletProfileBar";
import { BinderEmptyState } from "@/components/binder/BinderEmptyState";
import type { Metadata } from "next";

// Your Binder — every NFT you own across one OR MANY wallets in a single binder, sorted by rarity,
// with total value. No login: paste any number of xch1… addresses / did:chia… profile ids (comma-
// separated in the URL); the WalletProfileBar auto-remembers that set on this device so it loads next
// time. When nothing is entered or saved we show a neutral empty state (no placeholder collection).
export const dynamic = "force-dynamic";
export const maxDuration = 60; // whale wallets page within an 8s SSR budget; the rest streams via /api/holdings

export const metadata: Metadata = {
  title: "Your Binder",
  description: "Paste any Chia address or DID to see every NFT you own in one binder — sorted by rarity, with an estimated value for each. No account needed.",
};

export default async function BinderPage({ searchParams }: { searchParams: { address?: string } }) {
  const raw = (searchParams.address ?? "").trim().toLowerCase();
  const ids = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const addresses = [...new Set(ids.filter(isValidChiaOwnerId))];
  const invalid = ids.length > 0 && addresses.length === 0;

  const holdings = addresses.length ? await getMyHoldingsFast(addresses, { budgetMs: 8_000 }) : null; // short budget = fast first paint; poll finishes big wallets
  // A still-"warming" whale wallet may SSR with 0 items on the first pass — that is NOT "no results";
  // render the binder so its poll loop can stream the rest in.
  const { noResults, showBinder } = binderGate(addresses.length, holdings);

  return (
    <div className="py-2">
      {!showBinder && (
        <div className="mb-4 px-2">
          <span className="tf-eyebrow inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]">Portfolio · no login</span>
          <h1 className="tf-binder-title text-title mt-2 text-3xl font-black tracking-tight sm:text-4xl">Your <span className="tf-foil">Binder</span></h1>
          <div className="tf-hairline mt-4" aria-hidden />
        </div>
      )}

      <WalletProfileBar loaded={addresses} />

      {invalid && (
        <div className="mx-2 mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm" style={{ color: "var(--fair)" }}>
          That doesn&apos;t look like a Chia id. Paste an <span className="font-semibold">xch1…</span> address or a{" "}
          <span className="font-semibold">did:chia…</span> profile id.
        </div>
      )}

      {noResults && (
        <div className="mx-2 mb-4 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm" style={{ color: "var(--subtle)" }}>
          No NFTs found for the wallet(s) you entered. If a collector holds through a
          DID profile, paste their <span className="font-semibold">did:chia…</span> id instead — an address only shows
          what sits at that one puzzle hash.
        </div>
      )}

      {showBinder && <YourBinder key={addresses.join(",")} holdings={showBinder} />}

      {/* Neutral empty state when nothing is entered (and no saved profile is auto-loading). */}
      {addresses.length === 0 && !invalid && <BinderEmptyState />}
    </div>
  );
}
