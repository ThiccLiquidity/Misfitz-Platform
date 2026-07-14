import { Landing } from "@/components/landing/Landing";
import { getTrendingCollections } from "@/lib/collections/discovery";

// Traitfolio landing (logged-out home). The library moved to /browse. We server-fetch the top trending
// collections (MintGarden volume feed, TTL-cached) to fill the hero card fan with REAL character art +
// floors, each linking into its collection. getTrendingCollections never throws; if it returns too few,
// Landing falls back to a stylized trio so the front door never looks broken.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const trending = await getTrendingCollections(12).catch(() => []);
  const featured = trending
    .filter((c) => c.imageUrl)
    .slice(0, 3)
    .map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl, floorXch: c.floorXch }));
  return <Landing featured={featured} />;
}
