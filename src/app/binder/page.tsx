import { isValidChiaAddress } from "@/lib/wallet/message";
import { getMyHoldingsFast, getDemoHoldings } from "@/lib/portfolio/myHoldings";
import { YourBinder } from "@/components/binder/YourBinder";
import { AddressForm } from "@/components/portfolio/AddressForm";

// Your Binder — every NFT you own in one binder, sorted by rarity, with total value. Today it
// takes a pasted ?address=; saved profile addresses + wallet connect populate it automatically
// later. Falls back to a seeded demo when no address is given.
export const dynamic = "force-dynamic";

export default async function BinderPage({ searchParams }: { searchParams: { address?: string } }) {
  const raw = searchParams.address?.trim()?.toLowerCase();
  const addresses = raw && isValidChiaAddress(raw) ? [raw] : [];

  let holdings = addresses.length ? await getMyHoldingsFast(addresses) : null;
  if (!holdings || holdings.nfts.length === 0) {
    holdings = await getDemoHoldings();
  }

  return (
    <div className="py-2">
      <div className="mb-4 flex flex-col gap-3 px-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-title text-xl font-bold">Your Binder</h1>
        <div className="w-full sm:max-w-md">
          <AddressForm initial={raw ?? ""} path="/binder" buttonLabel="Open binder" />
        </div>
      </div>
      <YourBinder key={addresses.join(",") || "demo"} holdings={holdings} />
    </div>
  );
}
