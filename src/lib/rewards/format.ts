// mojos -> "X.YZ XCH" string, trimmed. Display only — never used in the money math.
const ONE_XCH = BigInt(1_000_000_000_000);
export function xchStr(mojos: bigint, dp = 4): string {
  const neg = mojos < BigInt(0);
  const abs = neg ? -mojos : mojos;
  const whole = abs / ONE_XCH;
  let frac = (abs % ONE_XCH).toString().padStart(12, "0").slice(0, dp).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
