import { isValidChiaOwnerId } from "@/lib/wallet/message";
import { getMyHoldingsFast, getDemoHoldings } from "@/lib/portfolio/myHoldings";
import { YourBinder } from "@/components/binder/YourBinder";
import { AddressForm } from "@/components/portfolio/AddressForm";

// Your Binder — every NFT you own in one binder, sorted by rarity, with total value. Accepts a pasted
// xch1… address OR a did:chia… profile id (DID collectors hold across many addresses, so the profile
// lookup is the only way to see their full collection). Falls back to a seeded demo when nothing is
// entered; tells the user plainly when an id is invalid or simply holds no NFTs.
export const dynamic = "force-dynamic";

export default async function BinderPage({ searchParams }: { searchParams: { address?: string } }) {
  const raw = searchParams.address?.trim()?.toLowerCase();
  const valid = !!raw && isValidChiaOwnerId(raw);
  const invalid = !!raw && !valid;
  const addresses = valid ? [raw as string] : [];

  const holdings = addresses.length ? await getMyHoldingsFast(addresses) : null;
  const noResults = addresses.length > 0 && (!holdings || holdings.nfts.length === 0);
  const demo = !raw ? await getDemoHoldings() : null;
  const showBinder = holdings && holdings.nfts.length > 0 ? holdings : null;

  return (
    <div className="py-2">
      <div className="mb-4 flex flex-col gap-3 px-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-title text-xl font-bold">Your Binder</h1>
        <div className="w-full sm:max-w-md">
          <AddressForm initial={raw ?? ""} path="/binder" buttonLabel="Open binder" />
        </div>
      </div>

      {invalid && (
        <div className="mx-2 mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          That doesn&apos;t look like a Chia id. Paste an <span className="font-semibold">xch1…</span> address or a{" "}
          <span className="font-semibold">did:chia…</span> profile id.
        </div>
      )}

      {noResults && (
        <div className="mx-2 mb-4 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          No NFTs found for <span className="font-mono">{raw}</span>. If this is a collector who holds through a
          DID profile, paste their <span className="font-semibold">did:chia…</span> id instead — an address only shows
          what sits at that one puzzle hash.
        </div>
      )}

      {showBinder && <YourBinder key={addresses.join(",")} holdings={showBinder} />}
      {demo && <YourBinder key="demo" holdings={demo} />}
    </div>
  );
}
