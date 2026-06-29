import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { getWalletVerifier } from "@/lib/wallet/registry";
import { takeLiveChallenge, markVerified } from "@/lib/wallet/store";

// Phase 2, step 2: verify the signature SERVER-SIDE against the live challenge, then mark the
// wallet verified. The client cannot fake success — the verifier checks both the signature and
// that the pubkey reconstructs to the claimed address.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { nonce, pubkey, signature, signingMode } = await req.json().catch(() => ({}));
  if (!nonce || !pubkey || !signature) {
    return NextResponse.json({ error: "Missing nonce, pubkey, or signature." }, { status: 400 });
  }

  const challenge = await takeLiveChallenge(nonce);
  if (!challenge) {
    return NextResponse.json(
      { error: "Challenge not found, already used, or expired. Start again." },
      { status: 410 },
    );
  }
  if (challenge.wallet.userId !== session.user.id) {
    return NextResponse.json({ error: "Challenge does not belong to you." }, { status: 403 });
  }

  const result = await getWalletVerifier().verify({
    address: challenge.wallet.address,
    message: challenge.message,
    pubkey,
    signature,
    signingMode,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Signature verification failed.", reason: result.reason },
      { status: 422 },
    );
  }

  await markVerified(challenge.id, challenge.walletId);
  return NextResponse.json({ verified: true, address: challenge.wallet.address });
}
