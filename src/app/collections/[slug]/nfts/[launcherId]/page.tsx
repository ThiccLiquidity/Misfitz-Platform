import { notFound } from "next/navigation";
import { getCollectionBySlug, listNftsForCollection, getNftByLauncherId } from "@/lib/db/queries";
import { enrichNfts, computeDealScore } from "@/lib/rarity/enrich";
import { fetchMarketContext, fetchNftListing } from "@/lib/market/dexie";
import { NftDetailView } from "@/components/nft/NftDetailView";

// Generic route — works for any collection + NFT, no Misfitz-specific code here.
//
// Trait rarity % accuracy: we load a batch (same cap as the collection browser) to give
// computeTraitRarity() real frequency data. NFTs ranked beyond the cap fall back to
// single-NFT enrichment — trait %s will read 100% but listing/dealScore still compute
// correctly since those derive from fairValue alone, not the batch.
const DEV_CAP = 500;

export default async function NftDetailPage({
  params,
}: {
  params: { slug: string; launcherId: string };
}) {
  // Fetch collection first — we need dexieCollectionId before we can build market context
  const collection = await getCollectionBySlug(params.slug);
  if (!collection) notFound();

  // Fan out: NFT batch + live market data (XCH rate + floor + per-NFT listing) in parallel
  const [batchNfts, market, liveListing] = await Promise.all([
    listNftsForCollection(params.slug, 0, DEV_CAP),
    fetchMarketContext(collection.dexieCollectionId),
    // Only hits the network for real nft1... IDs — returns null instantly for mock IDs
    fetchNftListing(params.launcherId),
  ]);

  // Enrich the full batch so trait rarity % is computed across real frequencies
  const enrichedBatch = enrichNfts(batchNfts, collection.totalSupply, market);
  let nft = enrichedBatch.find((n) => n.launcherId === params.launcherId) ?? null;

  // NFT not in the batch (ranked > DEV_CAP) — fetch individually
  if (!nft) {
    const rawNft = await getNftByLauncherId(params.launcherId);
    if (!rawNft) notFound();
    [nft] = enrichNfts([rawNft], collection.totalSupply, market);
  }

  // Override listing + deal score with live Dexie data if this NFT has an active ask
  if (nft && liveListing) {
    const priceXch = liveListing.priceXch;
    const priceUsd = Math.round(priceXch * market.xchUsdRate * 100) / 100;
    const fairValueXch = nft.fairValue?.totalEstimate ?? 0;
    nft = {
      ...nft,
      listing: { priceXch, priceUsd },
      dealScore: fairValueXch > 0 ? computeDealScore(fairValueXch, priceXch) : null,
    };
  }

  return <NftDetailView nft={nft} collection={collection} />;
}
