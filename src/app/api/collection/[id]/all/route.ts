import { NextResponse } from "next/server";
import { getAllCollectionCards } from "@/lib/collections/liveCollection";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the first fetch of a big collection pages through everything

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const r = await getAllCollectionCards(params.id);
  return NextResponse.json(r);
}
