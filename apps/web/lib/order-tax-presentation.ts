/** Commercial read presentation only. Never derive a FOP liability or reprice an order. */
import type { TaxOrderEstimate } from './tax-integration-contract';
export type OrderPriceEstimate = TaxOrderEstimate;
type Price = { priceMinor: number; currency: string; deliveryMinor?: number | null; taxMinor?: number | null; giftWrapMinor?: number | null; discountMinor?: number | null };
const minor = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function orderTaxPresentation(order: Price, items: readonly { priceMinor: number; quantity: number }[], estimate?: OrderPriceEstimate | null) {
  const sum = items.every(item => minor(item.priceMinor) && minor(item.quantity))
    ? items.reduce((total, item) => total + BigInt(item.priceMinor) * BigInt(item.quantity), 0n) : null;
  const productsMinor = sum !== null && sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : null;
  const totalMinor = minor(order.priceMinor) ? order.priceMinor : null;
  const deliveryMinor = minor(order.deliveryMinor) ? order.deliveryMinor : null;
  const parts = [productsMinor, deliveryMinor, order.taxMinor, order.giftWrapMinor, order.discountMinor];
  const allocated = parts.every(minor) && BigInt(productsMinor!) + BigInt(deliveryMinor!) + BigInt(order.taxMinor!) + BigInt(order.giftWrapMinor!) - BigInt(order.discountMinor!) === BigInt(totalMinor ?? -1);
  const priceTaxMinor = estimate && !estimate.incomplete && estimate.currency === order.currency && minor(estimate.amountMinor) && totalMinor !== null && estimate.amountMinor <= totalMinor ? estimate.amountMinor : null;
  return { totalMinor, productsMinor, deliveryMinor, allocated, priceTaxMinor };
}
