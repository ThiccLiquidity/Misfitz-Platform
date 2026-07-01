import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Allow indexing of public pages; keep internal/API + debug routes out of search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/comps-status"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
