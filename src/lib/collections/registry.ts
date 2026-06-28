import type { CollectionPlugin } from "./types";
import { misfitz } from "./misfitz";

// Source-controlled, reviewable list of collection plugins. The seed script (prisma/seed.ts)
// mirrors each entry into a Collection row — the running app queries the database, this
// registry is what makes onboarding a collection a one-file change (ARCHITECTURE.md §8/§9).
export const collectionRegistry: CollectionPlugin[] = [misfitz];

export function getCollectionPlugin(slug: string): CollectionPlugin | undefined {
  return collectionRegistry.find((c) => c.slug === slug);
}
