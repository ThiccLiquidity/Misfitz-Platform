import { redirect } from "next/navigation";

// /portfolio was the single-address ancestor of /binder. /binder is a strict superset (multi-wallet,
// profile bar, empty/invalid states) and is the only one in the nav and the sitemap, so the page itself
// was dead code. Kept as a redirect so any old bookmark or shared link still lands somewhere correct.
export const dynamic = "force-dynamic";

export default function PortfolioPage({ searchParams }: { searchParams: { address?: string } }) {
  const address = (searchParams.address ?? "").trim();
  redirect(address ? `/binder?address=${encodeURIComponent(address)}` : "/binder");
}
