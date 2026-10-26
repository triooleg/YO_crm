import type { Prisma } from '@prisma/client';

const NUMBER_LOCK = 'order-business-number-v1';

export function websiteBusinessSequence(value: string | null | undefined) {
  const match = value?.trim().match(/^(?:YO-|KC-)([1-9]\d*)$/i);
  if (!match) return 0;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : 0;
}

function keycrmBusinessSequence(value: string | null | undefined) {
  const match = value?.trim().match(/^(?:#|YO-|KC-)?([1-9]\d*)$/i);
  if (!match) return 0;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : 0;
}

export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
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
  return `YO-${next}`;
}

export const nextWebsiteOrderNumber = nextOrderNumber;
