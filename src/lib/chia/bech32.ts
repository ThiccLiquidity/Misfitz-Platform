// Minimal bech32m decoder (BIP-350) for Chia addresses. A Chia address is the bech32m encoding of
// a 32-byte puzzle hash with human-readable part "xch" (no segwit version byte). MintGarden's
// holdings endpoint takes the *hex* puzzle hash, so we decode xch1... -> hex here.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

// 5-bit groups -> 8-bit bytes (no padding allowed on decode).
function convertBits(data: number[], from: number, to: number): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}

export interface DecodedAddress {
  hrp: string;
  hex: string; // puzzle hash, lowercase hex (no 0x)
}

// Decodes a bech32m address (e.g. xch1...) to its puzzle-hash hex. Returns null if malformed.
export function decodeChiaAddress(address: string): DecodedAddress | null {
  const addr = address.trim().toLowerCase();
  const pos = addr.lastIndexOf("1");
  if (pos < 1 || pos + 7 > addr.length) return null;

  const hrp = addr.slice(0, pos);
  const dataPart = addr.slice(pos + 1);

  const data: number[] = [];
  for (const c of dataPart) {
    const d = CHARSET.indexOf(c);
    if (d === -1) return null;
    data.push(d);
  }

  if (polymod([...hrpExpand(hrp), ...data]) !== BECH32M_CONST) return null;

  const payload = convertBits(data.slice(0, data.length - 6), 5, 8);
  if (!payload) return null;
  const hex = payload.map((b) => b.toString(16).padStart(2, "0")).join("");
  return { hrp, hex };
}

// Convenience: just the hex puzzle hash, or null.
export function addressToPuzzleHashHex(address: string): string | null {
  return decodeChiaAddress(address)?.hex ?? null;
}
