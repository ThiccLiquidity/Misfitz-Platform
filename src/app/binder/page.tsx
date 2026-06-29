import { isValidChiaAddress } from "@/lib/wallet/message";
import { getMyHoldings, getDemoHoldings } from "@/lib/portfolio/myHoldings";
import { YourBinder } from "@/components/binder/YourBinder";

// Your Binder — every NFT you own in one binder, sorted by rarity, with total value. Sources: a
// pasted ?address= today, plus saved profile addresses once those land. Falls back to a seeded demo
// so the view is never empty while the live holdings fetch is finalized.
export const dynamic = "force-dynamic";

export default async function BinderPage({ searchParams }: { searchParams: { address?: string } }) {
  const raw = searchParams.address?.trim()?.toLowerCase();
  const addresses = raw && isValidChiaAddress(raw) ? [raw] : [];

  let holdings = addresses.length ? await getMyHoldings(addresses) : null;
  if (!holdings || holdings.nfts.length === 0) {
    holdings = await getDemoHoldings();
  }

  return (
    <div className="py-2">
      <h1 className="text-title mb-3 px-2 text-xl font-bold">Your Binder</h1>
      <YourBinder holdings={holdings} />
    </div>
  );
}
