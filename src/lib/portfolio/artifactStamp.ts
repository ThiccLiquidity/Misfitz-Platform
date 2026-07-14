import type { NftData } from "@/types";
import type { MgCollection, MgListItem } from "@/lib/data-sources/mintgarden/types";
import { cacheGetLarge } from "@/lib/db/nftCache";
import { mapListItemToCard, traitRarityPct } from "@/lib/data-sources/mintgarden/map";
import { getCollectionFrequency, scaledRankOf, type CollectionFrequency } from "@/lib/rarity/collectionFrequency";
import { readValueIndex } from "@/lib/valuation/valueIndex";
import { stampValueEntry } from "@/lib/valuation/valueEntry";
import { estimateFairValue } from "@/lib/valuation/estimate";
import { getCollection } from "@/lib/data-sources/mintgarden/client";
import { isSeeded } from "@/lib/data-sources/seed/registry";
import { collectibleNumber } from "@/lib/rarity/collectibleNumbers";

// ── Portfolio = a projection of the per-collection cached artifacts the collection page already builds ──
// For each collection the wallet holds, read its cached roster (slimlist2: traits + MintGarden rank) and
// value index (vidx: browse-identical values) ONCE and STAMP every held card from them — instead of a
// MintGarden detail fetch per NFT (fragile, rate-limited). Reads ONLY cached data; never scans MintGarden.
// A held collection with no warm roster is reported in `coldCols` so the caller/client can kick + poll it.
// Mutates cards in place; never adds/removes; never touches listing/dealScore/dexieOfferId (those stay
// from the FRESH fast pass — roster prices are up to 30 days stale).

const SLIMLIST_TTL_MS = 30 * 24 * 60 * 60_000; // matches the roster cache
const ROSTER_MEMO_MS = 5 * 60_000;             // rosters are ~static; amortize the gzip-shard read
const _rosterMemo = new Map<string, { value: Map<string, MgListItem> | null; at: number }>();

async function readRosterMap(colId: string): Promise<Map<string, MgListItem> | null> {
  const hit = _rosterMemo.get(colId);
  if (hit && Date.now() - hit.at < ROSTER_MEMO_MS) return hit.value;
  let value: Map<string, MgListItem> | null = null;
  try {
    const raw = await cacheGetLarge(`slimlist2:${colId}`, SLIMLIST_TTL_MS);
    if (raw) {
      const items = (JSON.parse(raw) as { items?: MgListItem[] }).items ?? [];
      // Only a genuine trait source: some cached rosters predate include_metadata (no inline attributes).
      if (items.length > 0 && items.some((it) => (it.metadata?.attributes?.length ?? 0) > 0)) {
        value = new Map(items.filter((it) => !!it.encoded_id).map((it) => [it.encoded_id, it]));
      }
    }
  } catch { value = null; }
  _rosterMemo.set(colId, { value, at: Date.now() });
  return value;
}

export async function stampCardsFromArtifacts(
  cards: NftData[],
  collections: Map<string, MgCollection>,
  xchUsdRate: number,
  opts: { budgetMs?: number; maxCols?: number } = {},
): Promise<{ coldCols: string[]; asOf: number | null }> {
  const deadline = Date.now() + (opts.budgetMs ?? 3500);
  const maxCols = opts.maxCols ?? 40;

  // Group held cards by col1 collection; seeds are authoritative (applySeedOverlay ran first) — skip them.
  const byCol = new Map<string, NftData[]>();
  for (const c of cards) {
    const col = c.collectionSlug;
    if (!col || !col.startsWith("col1") || isSeeded(col)) continue;
    let arr = byCol.get(col);
    if (!arr) { arr = []; byCol.set(col, arr); }
    arr.push(c);
  }
  // Most-held collections first, bounded — whales don't stall the SSR on 100+ roster reads.
  const colIds = [...byCol.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, maxCols).map(([c]) => c);

  const coldCols: string[] = [];
  let asOf: number | null = null;

  await Promise.all(colIds.map(async (colId) => {
    if (Date.now() > deadline) { coldCols.push(colId); return; }
    const roster = await readRosterMap(colId);
    if (!roster) { coldCols.push(colId); return; }
    const held = byCol.get(colId)!;

    let colMeta = collections.get(colId);
    if (!colMeta) colMeta = (await getCollection(colId).catch(() => null)) ?? undefined;

    const vidx = await readValueIndex(colId).catch(() => null);
    if (vidx?.builtAt) asOf = asOf == null ? vidx.builtAt : Math.max(asOf, vidx.builtAt);

    // OUR ranks only when this collection isn't MintGarden-ranked (roster items lack openrarity_rank).
    const needScaled = held.some((c) => { const it = roster.get(c.launcherId); return !!it && it.openrarity_rank == null; });
    const freq: CollectionFrequency | null = needScaled ? await getCollectionFrequency(colId, { waitMs: 1200 }).catch(() => null) : null;
    const counts = colMeta?.attributes_frequency_counts ?? freq?.freq ?? null;
    const total = (colMeta?.nft_count ?? 0) || (freq?.total ?? 0);

    for (const card of held) {
      const it = roster.get(card.launcherId);
      if (!it) continue; // brand-new mint not in a 30-day roster -> leave the fast-pass baseline
      const floor = card.fairValue?.floorValue ?? null;
      const built = mapListItemToCard(it, colMeta, floor, xchUsdRate);
      const supply = built.totalSupply || total;

      // Traits (+ per-trait rarity %) — identical math to the collection page.
      card.traits = built.nft.traits.map((t) => {
        const pct = traitRarityPct(counts, total, t.trait_type, t.value);
        return pct != null ? { ...t, rarityPercent: pct } : t;
      });

      // Rank: MintGarden's when present, else OUR scaled rank (same as /collection/[id]).
      let rank = built.nft.rarityRank;
      let rankEst = false;
      if (rank == null && freq) {
        const scaled = scaledRankOf(freq, it.id, supply);
        if (scaled != null) { rank = scaled; rankEst = true; }
      }
      const prevRank = card.rarityRank; // the rank the card's EXISTING value was computed with
      if (rank != null) {
        card.rarityRank = rank;
        card.rankEstimated = rankEst;
        card.rarityScore = supply > 0 ? Math.round((100 - (rank / supply) * 100) * 10) / 10 : card.rarityScore;
      }

      // VALUE PRECEDENCE — must never disagree with /collection/[id], never downgrade, never use supply 0:
      //   1) vidx entry (browse's own computed value) — authoritative.
      //   2) the value the card already carries (index stamp or fast-pass baseline) — keep it.
      //   3) a floor+rarity baseline, recomputed ONLY when this rank is NEW info for a card with no browse
      //      value, a real floor AND real supply — with the collector-number premium preserved so it matches
      //      mapListItemToCard exactly. This never clobbers a comps value and never collapses to bare floor.
      const e = vidx?.values?.[card.launcherId];
      if (e) {
        stampValueEntry(card, e, xchUsdRate);
      } else if (card.valueBasis == null && rank != null && rank !== prevRank && floor != null && supply > 0) {
        const nameNum = (it.name ?? "").match(/#?(\d+)\s*$/);
        const collectible = collectibleNumber(nameNum ? parseInt(nameNum[1], 10) : null, supply);
        card.fairValue = estimateFairValue({ floorXch: floor, rarityRank: rank, totalSupply: supply, desirabilityWeight: collectible?.weight ?? 0, xchUsdRate }) ?? card.fairValue;
      }
    }
  }));

  return { coldCols, asOf };
}
