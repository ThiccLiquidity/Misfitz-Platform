import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { listWallets } from "@/lib/wallet/store";
import { WalletPanel, type WalletRow } from "@/components/profile/WalletPanel";

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const [profile, wallets] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: session.user.id } }),
    listWallets(session.user.id),
  ]);

  const walletRows: WalletRow[] = wallets.map((w) => ({
    id: w.id,
    address: w.address,
    label: w.label,
    walletType: w.walletType,
    verifiedAt: w.verifiedAt ? w.verifiedAt.toISOString() : null,
  }));

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-title text-xl font-semibold">{profile?.username ?? session.user.email}</h1>
      <p className="text-subtle mt-1 text-sm">Collector level {profile?.collectorLevel ?? 1}</p>

      <WalletPanel initialWallets={walletRows} />

      <p className="text-subtle mt-8 text-sm">Your watchlist and badges will show up here.</p>
    </div>
  );
}
