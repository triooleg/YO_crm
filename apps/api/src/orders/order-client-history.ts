import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isIP } from 'node:net';
import { isOrderImageName } from './order-image-name';

export const clientHistoryClientSelect = { id: true, displayName: true, country: true, source: true } satisfies Prisma.ClientSelect;
export const clientHistoryOrderSelect = {
  id: true, clientId: true, number: true, createdAt: true, priceMinor: true, currency: true, salesStatus: true, country: true,
  modelImagePath: true, externalImageUrl: true, sourceSystem: true,
  compositionOperations: { take: 1, select: { id: true } },
  _count: { select: { items: true } },
  items: { where: { archivedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 2, select: { id: true, name: true, modelImagePath: true, externalImageUrl: true } },
} satisfies Prisma.OrderSelect;
type HistoryOrderRecord = Prisma.OrderGetPayload<{ select: typeof clientHistoryOrderSelect }>;
export type ClientOrderHistoryDesign = { id: string; name: string; imageUrl: string | null };
export type ClientOrderHistoryItem = Pick<HistoryOrderRecord, 'id' | 'clientId' | 'number' | 'createdAt' | 'priceMinor' | 'currency' | 'salesStatus' | 'country'> & { designCount: number; quantity: number; designs: ClientOrderHistoryDesign[] };
export type ClientOrderHistoryCurrencyTotal = { currency: string; totalMinor: number };
type ActiveItemAggregate = { _count: { _all: number }; _sum: { quantity: number | null } };
export type OrderClientFilter = Prisma.ClientGetPayload<{ select: typeof clientHistoryClientSelect }>;
export type ClientOrderHistorySummary = { total: number; completed: number; inProgress: number; cancelled: number };
export type ClientOrderHistoryQuery = { page?: string | number; pageSize?: string | number };
export type ClientOrderHistoryPage = {
  client: OrderClientFilter;
  summary: ClientOrderHistorySummary;
  items: ClientOrderHistoryItem[];
  totalsByCurrency: ClientOrderHistoryCurrencyTotal[];
  page: number;
  pageSize: number;
  total: number;
};

export function normalizeOrderClientId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200 || /[\s\p{Cc}]/u.test(value)) throw new BadRequestException('Некорректный идентификатор клиента');
  return value;
}

export function normalizeClientHistoryPage(query: ClientOrderHistoryQuery) {
  const integer = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value))) throw new BadRequestException('Некорректная страница истории заказов');
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new BadRequestException('Некорректная страница истории заказов');
    return number;
  };
  const page = integer(query.page, 1), pageSize = integer(query.pageSize, 20);
  if (page > 100000 || (pageSize !== 20 && pageSize !== 50)) throw new BadRequestException('Некорректная страница истории заказов');
  return { page, pageSize };
}

export async function requireActiveOrderClient(db: Pick<Prisma.TransactionClient, 'client'>, id: string): Promise<OrderClientFilter> {
  const client = await db.client.findFirst({ where: { id, archivedAt: null }, select: clientHistoryClientSelect });
  if (!client) throw new NotFoundException('Клиент не найден');
  return client;
}

export function summarizeClientOrderStatuses(groups: readonly { salesStatus: string; _count: { _all: number } }[]): ClientOrderHistorySummary {
  const summary = { total: 0, completed: 0, inProgress: 0, cancelled: 0 };
  for (const group of groups) {
    const count = group._count._all;
    summary.total += count;
    if (group.salesStatus === 'COMPLETED') summary.completed += count;
    else if (group.salesStatus === 'CANCELLED') summary.cancelled += count;
    else summary.inProgress += count;
  }
  return summary;
}

/** Local model names use the existing authenticated order-images route. Website
 * images retain the producer's public-HTTPS policy; never fetch while reading. */
function historyDesignImage(source: { modelImagePath: string | null; externalImageUrl: string | null }, sourceSystem: string | null): string | null {
  if (source.modelImagePath) { const route = '/api/orders/images/' + source.modelImagePath; return route.length <= 2048 && isOrderImageName(source.modelImagePath) ? route : null; }
  if (sourceSystem !== 'YOLEOTARD_WEBSITE' || !source.externalImageUrl || source.externalImageUrl.length > 2048 || /[\s\p{Cc}\\]/u.test(source.externalImageUrl)) return null;
  try {
    const url = new URL(source.externalImageUrl), host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || isIP(host) || !host.includes('.') || /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|test|invalid|example|onion)$/i.test(host) || url.href.length > 2048) return null;
    for (const [key, token] of url.searchParams) if (/(?:token|authorization|password|secret|signature|credential|apikey|accesskey|keypairid|^auth$|^key$|^sig$)/i.test(key.replace(/[-_]/g, '')) || /\bbearer\s/i.test(token)) return null;
    return url.href;
  } catch { return null; }
}

const previewId = (id: string) => id.length > 0 && id.length <= 200 && !/[\s\p{Cc}]/u.test(id);
function previewName(name: string, fallback: string): string {
  return (name.trim() ? name : fallback).slice(0, 500).replace(/[\uD800-\uDBFF]$/, '');
}

export function presentClientHistoryOrder(order: HistoryOrderRecord, active?: ActiveItemAggregate): ClientOrderHistoryItem {
  const { compositionOperations, _count, items, modelImagePath, externalImageUrl, sourceSystem, ...visible } = order;
  const managed = Boolean(compositionOperations?.length || _count?.items);
  const designCount = active?._count._all ?? (managed ? 0 : 1);
  const quantity = active ? active._sum.quantity : managed ? 0 : 1;
  if (!Number.isSafeInteger(designCount) || designCount < 0 || quantity === null || !Number.isSafeInteger(quantity) || quantity < 0) throw new InternalServerErrorException('Не удалось прочитать состав заказа');
  const designs: ClientOrderHistoryDesign[] = active ? items.filter(item => previewId(item.id)).map(item => ({ id: item.id, name: previewName(item.name, order.number), imageUrl: historyDesignImage(item, sourceSystem) }))
    : managed || !previewId(order.id) ? [] : [{ id: order.id, name: previewName(order.number, order.id), imageUrl: historyDesignImage({ modelImagePath, externalImageUrl }, sourceSystem) }];
  const country = typeof visible.country === 'string' && (visible.country.length > 100 || /\p{Cc}/u.test(visible.country)) ? null : visible.country;
  return { ...visible, country, designCount, quantity, designs };
}

export function presentClientHistoryCurrencyTotals(groups: readonly { currency: string; _sum: { priceMinor: number | null } }[]): ClientOrderHistoryCurrencyTotal[] {
  if (groups.length > 256) throw new InternalServerErrorException('Не удалось рассчитать сумму заказов');
  return groups.map(group => {
    const totalMinor = group._sum.priceMinor;
    if (totalMinor === null || !Number.isSafeInteger(totalMinor) || totalMinor < 0 || !/^[A-Z]{3}$/.test(group.currency)) throw new InternalServerErrorException('Не удалось рассчитать сумму заказов');
    return { currency: group.currency, totalMinor };
  });
}
