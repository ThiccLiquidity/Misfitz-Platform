import type { MgCollection, MgNftDetail, MgListItem, MgPage } from "./types";
import { addressToPuzzleHashHex } from "@/lib/chia/bech32";

// Thin typed HTTP client for the public MintGarden API. No SDK, no auth — just fetch + types.
// Isolated here so MintGardenDataSource and mappers never touch URLs or transport concerns.

const BASE = process.env.MINTGARDEN_API_BASE ?? "https://api.mintgarden.io";
const DEFAULT_TIMEOUT_MS = 12_000;

export class MintGardenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MintGardenError";
  }
}

async function getJson<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new MintGardenError(`MintGarden ${path} -> HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof MintGardenError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new MintGardenError(`MintGarden ${path} timed out after ${timeoutMs}ms`);
    }
    throw new MintGardenError(`MintGarden ${path} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Tolerant variant: returns null on any failure (non-200, empty body, bad JSON, timeout) instead
// of throwing. Used for address holdings, where "this address holds nothing" is a normal, non-error
// outcome that must NOT surface as "couldn't reach MintGarden".
async function getJsonOrNull<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function getNftDetail(nftId: string): Promise<MgNftDetail> {
  return getJson<MgNftDetail>(`/nfts/${encodeURIComponent(nftId)}`);
}

export function getCollection(collectionId: string): Promise<MgCollection> {
  return getJson<MgCollection>(`/collections/${encodeURIComponent(collectionId)}`);
}

export function listCollectionNfts(
  collectionId: string,
  cursor?: string | null,
  size = 50,
): Promise<MgPage<MgListItem>> {
  const q = new URLSearchParams({ size: String(size) });
  if (cursor) q.set("page", cursor);
  return getJson<MgPage<MgListItem>>(`/collections/${encodeURIComponent(collectionId)}/nfts?${q}`);
}

const EMPTY_PAGE: MgPage<MgListItem> = { items: [], next: null, previous: null };

// NFTs held at an address. MintGarden's endpoint is `/address/{hex}/nfts` (singular; the puzzle-hash
// HEX, not the xch1 string; a required `type`). We decode the address and tolerate empty results so
// an address that simply holds nothing reads as "no NFTs", never an error.
export async function listAddressNfts(
  address: string,
  cursor?: string | null,
  size = 50,
  type = "address",
): Promise<MgPage<MgListItem>> {
  const hex = addressToPuzzleHashHex(address);
  if (!hex) return EMPTY_PAGE;
  const q = new URLSearchParams({ type, size: String(size) });
  if (cursor) q.set("page", cursor);
  const page = await getJsonOrNull<MgPage<MgListItem>>(`/address/${hex}/nfts?${q}`);
  if (!page) return EMPTY_PAGE;
  return { items: page.items ?? [], next: page.next ?? null, previous: page.previous ?? null };
}
