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
