import { redirect } from "next/navigation";

// Milestone 1 has a single collection, so the root just opens straight into it. A real
// marketing/landing page and a multi-collection directory are future additions, not a rewrite.
export default function HomePage() {
  redirect("/collections/misfitz");
}
