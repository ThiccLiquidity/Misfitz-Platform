import { listCollections } from "@/lib/db/queries";
import { LibraryView } from "@/components/library/LibraryView";

// Browse / explore: all supported collections as binder covers on a shelf.
export default async function BrowsePage() {
  const collections = await listCollections();
  return <LibraryView collections={collections} />;
}
