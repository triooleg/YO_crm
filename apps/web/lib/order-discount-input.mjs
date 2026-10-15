// Both money and percentages accept two decimals, but travel as integers.
export function parseDiscountValue(input, mode) {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match || !['FIXED', 'PERCENT'].includes(mode)) return null;
  const value = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  const maximum = mode === 'PERCENT' ? 10000n : 2147483647n;
  return value <= maximum ? Number(value) : null;
}
