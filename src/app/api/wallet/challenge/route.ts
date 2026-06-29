import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { isValidChiaAddress } from "@/lib/wallet/message";
import { linkOrGetWallet, issueChallenge } from "@/lib/wallet/store";

// Phase 2, step 1: link the address (unverified) and hand back a single-use message to sign.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { address, walletType } = await req.json().catch(() => ({}));
  if (!isValidChiaAddress(address)) {
    return NextResponse.json({ error: "Enter a valid Chia address (xch1...)." }, { status: 400 });
  }

  const normalized = address.trim().toLowerCase();
  const wallet = await linkOrGetWallet(session.user.id, normalized, walletType);
  const { nonce, message, expiresAt } = await issueChallenge(wallet.id, normalized);

  return NextResponse.json({ walletId: wallet.id, address: normalized, nonce, message, expiresAt });
}
