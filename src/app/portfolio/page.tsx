import { isValidChiaAddress } from "@/lib/wallet/message";
import { getAddressPortfolio, type Portfolio } from "@/lib/portfolio/service";
import { AddressForm } from "@/components/portfolio/AddressForm";
import { PortfolioResults } from "@/components/portfolio/PortfolioResults";

// No-login value view. Paste an XCH address -> see live holdings valued with our model. Pure read;
// no account, no wallet connection, no DB writes (ARCHITECTURE.md Product Vision / Two entry paths).
export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: { address?: string };
}) {
  const raw = searchParams.address?.trim() ?? "";
  const valid = raw.length > 0 && isValidChiaAddress(raw);

  let portfolio: Portfolio | null = null;
  let error: string | null = null;

  if (raw.length > 0 && !valid) {
    error = "That doesn't look like a Chia address. It should start with xch1…";
  } else if (valid) {
    try {
      portfolio = await getAddressPortfolio(raw.toLowerCase());
    } catch {
      error = "Couldn't reach MintGarden just now. Please try again in a moment.";
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mt-2">
        <h1 className="text-title text-2xl font-bold">What are your Chia NFTs worth?</h1>
        <p className="text-subtle mt-2 max-w-2xl text-sm">
          Paste any Chia address to see the NFTs it holds, each collection&rsquo;s floor, and our
          estimated value per NFT. No account, no wallet connection — just a read.
        </p>
      </header>

      <div className="mt-6 max-w-2xl">
        <AddressForm initial={raw} />
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {portfolio && <PortfolioResults portfolio={portfolio} />}

      {!raw && !portfolio && (
        <p className="text-subtle mt-10 text-sm">
          Tip: your address is the one starting with <span className="font-mono">xch1</span> in Sage
          or Goby. Pasting it here never moves anything — it only reads public on-chain data.
        </p>
      )}
    </div>
  );
}
