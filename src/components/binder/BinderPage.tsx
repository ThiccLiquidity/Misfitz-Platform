import type { NftData } from "@/types";
import { NftCard } from "@/components/nft/NftCard";

interface BinderPageProps {
  nfts: NftData[];
  onOpen: (launcherId: string) => void;
}

// Pure 3x3 grid renderer — 9 cards per page (ARCHITECTURE.md §11). All the flip/animation
// behavior lives in BinderView; this component only knows how to lay out one page's cards.
export function BinderPage({ nfts, onOpen }: BinderPageProps) {
  return (
    <div className="grid h-full grid-cols-3 gap-2 p-3.5">
      {nfts.map((nft) => (
        <NftCard key={nft.launcherId} nft={nft} onOpen={onOpen} />
      ))}
    </div>
  );
}
