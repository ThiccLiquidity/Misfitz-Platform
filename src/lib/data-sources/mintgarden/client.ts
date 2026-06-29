import type { MgCollection, MgNftDetail, MgListItem, MgPage } from "./types";

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

export function listAddressNfts(
  address: string,
  cursor?: string | null,
  size = 50,
): Promise<MgPage<MgListItem>> {
  const q = new URLSearchParams({ size: String(size) });
  if (cursor) q.set("page", cursor);
  return getJson<MgPage<MgListItem>>(`/addresses/${encodeURIComponent(address)}/nfts?${q}`);
}
