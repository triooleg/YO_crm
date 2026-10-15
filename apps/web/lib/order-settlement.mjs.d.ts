export type SettlementReceipt = { amountMinor: number; currency: string; appliedAmountMinor?: number | null; appliedCurrency?: string | null; voidedAt?: string | Date | null };
export function orderSettlement(order: { priceMinor: number; currency: string; payments?: readonly SettlementReceipt[] }): { paidMinor: number | null; balanceMinor: number | null };
