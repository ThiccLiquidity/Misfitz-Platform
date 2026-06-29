export function CollectionStats({ nftCount }: { nftCount: number }) {
  return (
    <div className="mb-2 text-center">
      <span className="text-subtle text-xs">{nftCount} NFTs in this collection</span>
    </div>
  );
}
