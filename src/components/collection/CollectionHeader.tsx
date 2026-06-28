import type { CollectionData } from "@/types";

// Theme-driven, not collection-coded — renders from CollectionData only (ARCHITECTURE.md §4).
export function CollectionHeader({ collection }: { collection: CollectionData }) {
  return (
    <div className="mb-4 text-center">
      <h1 className="text-title text-2xl font-semibold">{collection.name}</h1>
      {collection.description && <p className="text-subtle mt-1 text-sm">{collection.description}</p>}
    </div>
  );
}
