import { isValidChiaOwnerId } from "@/lib/wallet/ownerId";
import { getMyHoldingsFast, getDemoHoldings } from "@/lib/portfolio/myHoldings";
import { YourBinder } from "@/components/binder/YourBinder";
import { WalletProfileBar } from "@/components/portfolio/WalletProfileBar";

// Your Binder — every NFT you own across one OR MANY wallets in a single binder, sorted by rarity,
// with total value. No login: paste any number of xch1… addresses / did:chia… profile ids (comma-
// separated in the URL); the WalletProfileBar lets collectors save that set to this device so it
// auto-loads next time. Falls back to a seeded demo when nothing is entered or saved.
export const dynamic = "force-dynamic";

export default async function BinderPage({ searchParams }: { searchParams: { address?: string } }) {
  const raw = (searchParams.address ?? "").trim().toLowerCase();
  const ids = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const addresses = [...new Set(ids.filter(isValidChiaOwnerId))];
  const invalid = ids.length > 0 && addresses.length === 0;

  const holdings = addresses.length ? await getMyHoldingsFast(addresses) : null;
  const noResults = addresses.length > 0 && (!holdings || holdings.nfts.length === 0);
  const showBinder = holdings && holdings.nfts.length > 0 ? holdings : null;
  // Demo only when the visitor has entered nothing at all (the bar auto-loads any saved profile).
  const demo = addresses.length === 0 ? await getDemoHoldings() : null;

  return (
    <div className="py-2">
      <div className="mb-3 px-2">
        <h1 className="text-title text-xl font-bold">Your Binder</h1>
      </div>

      <WalletProfileBar loaded={addresses} />

      {invalid && (
        <div className="mx-2 mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          That doesn&apos;t look like a Chia id. Paste an <span className="font-semibold">xch1…</span> address or a{" "}
          <span className="font-semibold">did:chia…</span> profile id.
        </div>
      )}

      {noResults && (
        <div className="mx-2 mb-4 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          No NFTs found for the wallet(s) you entered. If a collector holds through a
          DID profile, paste their <span className="font-semibold">did:chia…</span> id instead — an address only shows
          what sits at that one puzzle hash.
        </div>
      )}

      {showBinder && <YourBinder key={addresses.join(",")} holdings={showBinder} />}
      {demo && <YourBinder key="demo" holdings={demo} />}
    </div>
  );
}
