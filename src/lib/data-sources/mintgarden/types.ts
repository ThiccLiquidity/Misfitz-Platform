// Raw MintGarden API response shapes (https://api.mintgarden.io). Only the fields we consume are
// typed; everything else is left off deliberately so the mappers stay readable. Verified against
// live responses (nft detail, collection, and the cursor-paginated list endpoints).

export interface MgAttribute {
  // CHIP-0007 uses `trait_type`, but many Chia collections store the label under `type` or `name`.
  trait_type?: string;
  type?: string;
  name?: string;
  value?: string | number | null;
}

export interface MgEncodedRef {
  id: string;
  encoded_id: string;
}

// GET /collections/{col1...}  (also embedded inside an NFT detail's `collection`)
export interface MgCollection {
  id: string; // col1...
  name: string;
  description: string | null;
  thumbnail_uri: string | null;
  banner_uri: string | null;
  nft_count: number | null;
  floor_price: number | null; // XCH
  // { trait_type(lowercased): { value(lowercased): count } }
  attributes_frequency_counts?: Record<string, Record<string, number>> | null;
  // Discovery fields (present on the /collections and /search list shapes).
  volume?: number | null;       // lifetime traded volume in XCH
  trade_count?: number | null;
  creator?: {
    name?: string | null;
    encoded_id?: string | null;
    verification_state?: number | null;
    avatar_uri?: string | null;
  } | null;
  blocked_content?: boolean | null;
  sensitive_content?: boolean | null;
}

// GET /nfts/{nft1...}
export interface MgNftDetail {
  id: string;
  encoded_id: string; // nft1...
  data: {
    thumbnail_uri?: string | null;
    preview_uri?: string | null;
    data_uris?: string[] | null;
    metadata_json?: {
      name?: string;
      attributes?: MgAttribute[];
      series_total?: number;
      series_number?: number;
    } | null;
  };
  xch_price?: number | null; // active listing ask, if any
  owner_address?: MgEncodedRef | null;
  collection: MgCollection;
  openrarity_rank?: string | number | null;
  // Recent on-chain events; sale events carry an xch_price we use as a value anchor when the
  // collection has no floor.
  events?: {
    type?: number | null;          // 2 = transfer/sale
    xch_price?: number | null;
    address?: { encoded_id?: string | null } | null;          // buyer / new owner
    previous_address?: { encoded_id?: string | null } | null; // seller
    payments?: { asset_id?: string | null }[] | null;         // asset_id null => XCH leg
  }[] | null;
  is_blocked?: boolean | null;
  blocked_content?: boolean | null;
  sensitive_content?: boolean | null;
}

// One element of GET /collections/{id}/nfts and /addresses/{addr}/nfts (slimmer than detail).
export interface MgListItem {
  id: string;
  encoded_id: string; // nft1...
  name: string;
  thumbnail_uri: string | null;
  openrarity_rank?: string | number | null;
  price?: number | null; // listing ask (XCH leg)
  token_code?: string | null; // price denomination: "XCH" for clean offers, a CAT code otherwise
  collection_id: string; // col1...
  collection_name: string;
  owner_address_encoded_id?: string | null;
  // Present ONLY when the list is fetched with include_metadata=true — full CHIP-0007 attributes inline,
  // so we can build the whole rarity table from ~100 list pages instead of one detail fetch per NFT.
  metadata?: { attributes?: MgAttribute[]; series_number?: number | null } | null;
  // Safety flags (same gate as detail) so the fast path can drop blocked NFTs before display.
  is_blocked?: boolean | null;
  collection_blocked_content?: boolean | null;
}

// Cursor-paginated list envelope.
export interface MgPage<T> {
  items: T[];
  next: string | null;
  previous: string | null;
}
