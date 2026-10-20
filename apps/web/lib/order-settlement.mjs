/** Settlement requires recorded receipt evidence; it never guesses a foreign exchange rate. */
export function orderSettlement(order) {
  const unknown = { paidMinor: null, balanceMinor: null };
  if (!Array.isArray(order.payments) || !Number.isSafeInteger(order.priceMinor) || order.priceMinor < 0 || !order.currency) return unknown;
  let total = 0n;
  for (const payment of order.payments) {
    if (payment.voidedAt) continue;
    const amount = payment.currency === order.currency ? payment.amountMinor : payment.appliedCurrency === order.currency ? payment.appliedAmountMinor : null;
    if (!Number.isSafeInteger(amount) || amount < 0) return unknown;
    total += BigInt(amount);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return unknown;
  const paidMinor = Number(total);
  return { paidMinor, balanceMinor: Math.max(0, order.priceMinor - paidMinor) };
}
