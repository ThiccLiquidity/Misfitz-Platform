import { listCollections } from "@/lib/db/queries";
import { LibraryView } from "@/components/library/LibraryView";

// Library / wallet home — shows all seeded collections as binder covers on a shelf.
// A redirect to Misfitz was here during Milestone 1 (single-collection phase).
export default async function HomePage() {
  const collections = await listCollections();
  return <LibraryView collections={collections} />;
}
