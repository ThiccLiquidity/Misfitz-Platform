// Declared-rarity fallback (VALUATION.md Part 1, fallback tier).
//
// Some collections — especially TCG-style sets like Chellyz: Master of Blooms — ship NO rarity
// signal on the indexer (no openrarity_rank, no attributes_frequency_counts), so neither
// MintGarden's rank nor our own estimator (which needs the frequency table) can score them. But
// their cards carry the creator's OWN declared rarity as a plain trait ("Rarity: Rare"). For those
// collections we honor the creator's label: map the declared word to one of our tiers and place the
// card at the MIDPOINT of that tier's percentile band, so it shows up in the tier bar / sorts
// correctly. These ranks are approximate (creator-declared, not computed) and are flagged with ≈.
//
// This is a stopgap until the background "compute our own frequency table" job exists; once that
// runs for a collection, the computed rank supersedes the declared one.

import { DEFAULT_RARITY_TIERS, TIER_ORDER, type RarityTierThresholds, type TierId } from "./tiers";

// Trait types that carry an explicit rarity grade. Matched case-insensitively, trimmed.
const RARITY_TRAIT_TYPE = /^(rarity|tier|grade|card rarity|rarity tier|class)$/i;

// Declared rarity words -> our tier id. Conservative: only well-understood grades, with the common
// TCG synonyms. Unknown words return null (stay unranked) rather than guessing.
const DECLARED_TIER_MAP: Record<string, TierId> = {
  "1/1": "mythic", "one of one": "mythic", mythic: "mythic", mythical: "mythic",
  legendary: "legendary", legend: "legendary", "secret rare": "legendary",
  epic: "epic", "ultra rare": "epic", "ultra-rare": "epic", ultrarare: "epic", "super rare": "epic",
  rare: "rare",
  uncommon: "uncommon", "un-common": "uncommon",
  common: "common", basic: "common", standard: "common", normal: "common",
};

type Trait = { trait_type: string; value: string | number };

/** The tier a card's own declared rarity trait implies, or null if it has none we recognize. */
export function declaredRarityTier(traits: Trait[]): TierId | null {
  for (const t of traits) {
    if (RARITY_TRAIT_TYPE.test(String(t.trait_type).trim())) {
      const mapped = DECLARED_TIER_MAP[String(t.value).trim().toLowerCase()];
      if (mapped) return mapped;
    }
  }
  return null;
}

/** A representative rank (1 = rarest) at the midpoint of a tier's percentile band. */
export function syntheticRankForTier(
  tier: TierId,
  totalSupply: number,
  thresholds: RarityTierThresholds = DEFAULT_RARITY_TIERS,
): number | null {
  if (totalSupply <= 0) return null;
  let lower = 0;
  for (const id of TIER_ORDER) {
    const upper = thresholds[id];
    if (id === tier) {
      const midPct = (lower + upper) / 2;
      return Math.max(1, Math.min(totalSupply, Math.round((midPct / 100) * totalSupply)));
    }
    lower = upper;
  }
  return null;
}
