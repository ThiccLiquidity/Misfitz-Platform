import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";

// Shell only for milestone 1 — watchlist, wallet linking, and badges land in later milestones
// (ARCHITECTURE.md "First Implementation Milestone"), but the route and basic identity exist now.
export default async function ProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const profile = await prisma.profile.findUnique({ where: { userId: session.user.id } });

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-title text-xl font-semibold">{profile?.username ?? session.user.email}</h1>
      <p className="text-subtle mt-1 text-sm">Collector level {profile?.collectorLevel ?? 1}</p>

      <div className="mt-6 space-y-2">
        <p className="text-subtle text-sm">Wallet linking coming soon.</p>
        <p className="text-subtle text-sm">Your watchlist and badges will show up here.</p>
      </div>
    </div>
  );
}
