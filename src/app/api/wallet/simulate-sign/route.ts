import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { getWalletVerifier } from "@/lib/wallet/registry";
import { mockPubkey, mockSignature } from "@/lib/wallet/verifiers/mock";

// DEV ONLY. Stands in for Sage/Goby while the platform is mock-first: given a challenge message +
// address, it fabricates the exact { pubkey, signature } the MockWalletVerifier accepts, so the
// end-to-end flow is demoable with no wallet installed. Hard-disabled whenever a real verifier is
// active, so it can never forge a real proof.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (getWalletVerifier().id !== "mock") {
    return NextResponse.json({ error: "Simulated signing is disabled (real verifier active)." }, { status: 403 });
  }

  const { address, message } = await req.json().catch(() => ({}));
  if (!address || !message) {
    return NextResponse.json({ error: "address and message are required." }, { status: 400 });
  }

  const normalized = String(address).trim().toLowerCase();
  const pubkey = mockPubkey(normalized);
  const signature = mockSignature(normalized, message, pubkey);
  return NextResponse.json({ pubkey, signature, signingMode: "mock" });
}
