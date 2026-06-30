import { listTopCollections, searchCollections } from "@/lib/data-sources/mintgarden/client";
import { mapCollectionSummary } from "@/lib/data-sources/mintgarden/map";
import type { MgCollection } from "@/lib/data-sources/mintgarden/types";
import type { CollectionSummary } from "@/types";

// Discovery service for the /browse page. Trending = MintGarden's volume-sorted /collections feed;
// search = the /search endpoint. Both drop blocked collections and never throw (empty on failure).
const notBlocked = (c: MgCollection) => c.blocked_content !== true && c.name?.trim();

export async function getTrendingCollections(size = 24): Promise<CollectionSummary[]> {
  try {
    const page = await listTopCollections(undefined, size);
    return (page.items ?? []).filter(notBlocked).map(mapCollectionSummary);
  } catch {
    return [];
  }
}

export async function searchCollectionsByName(query: string): Promise<CollectionSummary[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const cols = await searchCollections(q);
    return cols.filter(notBlocked).map(mapCollectionSummary);
  } catch {
    return [];
  }
}
