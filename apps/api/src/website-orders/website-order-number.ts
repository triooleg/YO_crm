import type { Prisma } from '@prisma/client';

const NUMBER_LOCK = 'order-business-number-v1';

export function websiteBusinessSequence(value: string | null | undefined) {
  // Stored legacy year segments are provenance, not part of the numeric counter.
  const match = value?.trim().match(/^(?:(?:YO-|KC-)(?:\d{2,4}-)?|\d{2}-(?:\d{2,4}-)?)(\d+)$/i);
  if (!match) return 0;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : 0;
}

export function yearOrderNumber(suffix: string | number, createdAt: Date) {
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) throw new Error('ORDER_NUMBER_INVALID_DATE');
  const year = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv', year: 'numeric' }).format(createdAt).slice(-2).padStart(2, '0');
  return `${year}-${suffix}`;
}

/** Exact legacy alias recorded by the separately audited bulk operation. */
export function legacyOrderNumberAlias(search: string | undefined): Prisma.OrderWhereInput | undefined {
  const value = search?.trim().toUpperCase();
  return value && /^YO-(?:\d{2,4}-)?\d+$/.test(value) && value.length <= 200
    ? { activities: { some: { type: 'ORDER_NUMBER_YEAR_PREFIX_CHANGED', metadata: { path: ['oldNumberSearch'], equals: value } } } }
    : undefined;
}

function keycrmBusinessSequence(value: string | null | undefined) {
  const match = value?.trim().match(/^(?:#|YO-|KC-)?([1-9]\d*)$/i);
  if (!match) return 0;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : 0;
}

export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  createdAt = new Date(),
) {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', NUMBER_LOCK);
  const history = await tx.order.findMany({
    select: { number: true, externalNumber: true, externalId: true, sourceSystem: true },
  });
  const maximum = history.reduce((current, order) => Math.max(
    current,
    websiteBusinessSequence(order.number),
    order.sourceSystem === 'KEYCRM' ? keycrmBusinessSequence(order.externalNumber) : 0,
    order.sourceSystem === 'KEYCRM' ? keycrmBusinessSequence(order.externalId) : 0,
  ), 0);
  const next = maximum + 1;
  if (next > 999_999_999) throw new Error('WEBSITE_ORDER_NUMBER_EXHAUSTED');
  return yearOrderNumber(next, createdAt);
}

export const nextWebsiteOrderNumber = nextOrderNumber;
