// Small formatting helpers shared across NFT card/detail components — kept here instead of
// duplicated per-component so address/currency display stays consistent everywhere.

export function truncateAddress(address: string, head = 10, tail = 6): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function formatXch(value: number): string {
  return `${value.toFixed(2)} XCH`;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

// Compact formatting for big headline numbers (market cap, volume): 49,900 -> "49.9K", 1.2M, etc.
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K";
  return n.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0);
}
export function formatXchShort(value: number): string {
  return `${compact(value)} XCH`;
}
export function formatUsdShort(value: number): string {
  return `$${compact(value)}`;
}
