export function parseOrderPriceMinor(value: string) {
  const match = value.trim().match(/^(\d+)(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  const minor = BigInt(match[1]!) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  return minor <= 2_147_483_647n ? Number(minor) : null;
}
