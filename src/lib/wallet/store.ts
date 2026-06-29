import { prisma } from "@/lib/db/client";
import { CHALLENGE_TTL_MS, buildChallengeMessage, generateNonce, isExpired } from "./message";

// All Prisma access for the wallet feature in one place, so the API routes stay thin.
// Phase 1 = link an address (unverified). Phase 2 = issue challenge -> verify -> stamp verifiedAt.

export async function linkOrGetWallet(userId: string, address: string, walletType?: string) {
  return prisma.wallet.upsert({
    where: { userId_address: { userId, address } },
    update: walletType ? { walletType } : {},
    create: { userId, address, walletType: walletType ?? null },
  });
}

export async function issueChallenge(walletId: string, address: string) {
  const issuedAt = new Date();
  const nonce = generateNonce();
  const message = buildChallengeMessage({ address, nonce, issuedAt });
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  await prisma.walletChallenge.create({ data: { walletId, nonce, message, expiresAt } });
  return { nonce, message, expiresAt };
}

// Returns the challenge (with its wallet) only if live: exists, unconsumed, unexpired. Else null.
export async function takeLiveChallenge(nonce: string) {
  const challenge = await prisma.walletChallenge.findUnique({
    where: { nonce },
    include: { wallet: true },
  });
  if (!challenge || challenge.consumedAt || isExpired(challenge.expiresAt)) return null;
  return challenge;
}

// Consume the challenge and verify the wallet atomically (one-shot — defeats replay).
export async function markVerified(challengeId: string, walletId: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.walletChallenge.update({ where: { id: challengeId }, data: { consumedAt: now } }),
    prisma.wallet.update({ where: { id: walletId }, data: { verifiedAt: now } }),
  ]);
}

export async function listWallets(userId: string) {
  return prisma.wallet.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, address: true, label: true, walletType: true, verifiedAt: true },
  });
}
