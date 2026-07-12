import { isValidChiaOwnerId } from "@/lib/wallet/ownerId";
import { getMyHoldingsFast } from "@/lib/portfolio/myHoldings";
import { AddressForm } from "@/components/portfolio/AddressForm";
import { YourBinder } from "@/components/binder/YourBinder";

// No-login value view. Paste an xch1 address / did:chia id -> holdings valued, rendered PROGRESSIVELY:
// the fast slim-list grid paints in ~1s (art + floor-anchored value), then traits, our estimated ranks,
// and refined values stream in — the same fast path as Your Binder. No account, no wallet connection.
export const dynamic = "force-dynamic";
export const maxDuration = 60; // background comps warm (keepAlive) needs room to finish

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: { address?: string };
}) {
  const raw = (searchParams.address ?? "").trim().toLowerCase();
  const valid = raw.length > 0 && isValidChiaOwnerId(raw);
  const invalid = raw.length > 0 && !valid;
  const holdings = valid ? await getMyHoldingsFast([raw]) : null;
  const noResults = valid && (!holdings || holdings.nfts.length === 0);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mt-2">
        <h1 className="text-title text-2xl font-bold">What are your Chia NFTs worth?</h1>
        <p className="text-subtle mt-2 max-w-2xl text-sm">
          Paste any Chia address or DID to see the NFTs it holds, each collection&rsquo;s floor, and our
          estimated value per NFT. No account, no wallet connection — just a read.
        </p>
      </header>

      <div className="mt-6 max-w-2xl">
        <AddressForm initial={raw} />
      </div>

      {invalid && (
        <p className="mt-4 text-sm text-red-400">
          That doesn&rsquo;t look like a Chia id. Paste an <span className="font-mono">xch1…</span> address
          or a <span className="font-mono">did:chia…</span> profile id.
        </p>
      )}

      {noResults && (
        <p className="text-subtle mt-6 text-sm">No NFTs found for this address.</p>
      )}

      {holdings && holdings.nfts.length > 0 && (
        <div className="mt-6">
          <YourBinder key={raw} holdings={holdings} />
        </div>
      )}

      {!raw && (
        <p className="text-subtle mt-10 text-sm">
          Tip: your address is the one starting with <span className="font-mono">xch1</span> in Sage or
          Goby. Pasting it here never moves anything — it only reads public on-chain data.
        </p>
      )}
    </div>
  );
}
