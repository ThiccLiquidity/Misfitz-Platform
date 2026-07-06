import type { Trait } from "@/types";

// Seeded collections: their roster + OUR OpenRarity ranks + traits come from a bundled file generated
// from the mint metadata (scripts/build-seed.ts), so a MintGarden-unranked / partially-indexed collection
// (e.g. Misfitz) shows complete + ranked instantly, and the valuation model gets ranks without a scan.
//
// OPT-IN + kill switch: only active when TRAITFOLIO_SEED=1. Off by default -> zero change to the live site.
// Live market data (floor/listings/sales) is unaffected — the seed only supplies roster/traits/ranks.

export interface SeedEntry { n: number; name: string; image: string; rank: number; traits: [string, string][] }
export interface Seed { colId: string; name: string; supply: number; builtAt: number; byNumber: Record<string, SeedEntry> }

// One entry per seeded collection (dynamic import so the ~MB JSON only loads when that collection is viewed).
const LOADERS: Record<string, () => Promise<Seed>> = {
  "col1s8fwfqdl3x77h7rn40m0mzhkgp7kajdwu56me36glv0ez8w79heqst90mh":
    () => import("./col1s8fwfqdl3x77h7rn40m0mzhkgp7kajdwu56me36glv0ez8w79heqst90mh.json").then((m) => (m as unknown as { default: Seed }).default),
};

const ENABLED = process.env.TRAITFOLIO_SEED === "1";
const _cache = new Map<string, Promise<Seed | null>>();

export function isSeeded(colId: string): boolean { return ENABLED && colId in LOADERS; }

export function getSeed(colId: string): Promise<Seed | null> {
  if (!isSeeded(colId)) return Promise.resolve(null);
  let p = _cache.get(colId);
  if (!p) { p = LOADERS[colId]().catch(() => null); _cache.set(colId, p); }
  return p;
}

// Extract the mint number from an NFT name like "Misfitz #0015" -> 15 (the bridge key to on-chain data).
export function numberFromName(name: string): number | null {
  const m = (name ?? "").match(/#?\s*0*(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

export function seedTraitsToTraits(e: SeedEntry): Trait[] {
  return e.traits.map(([trait_type, value]) => ({ trait_type, value }));
}
