import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { classifyOrderSource, orderOriginSelect } from '../orders/order-source';
import { csvCell } from '../finance/finance-report-model';
import { parseExchangeRateCache, type ExchangeRateCache } from '../finance/exchange-rates';
import { normalizeSalesCountry, salesCountryLabels } from './sales-statistics-country';
import { normalizeSalesQuery } from './sales-statistics.query';
import { SalesStatisticsFx } from './sales-statistics-fx';
import { buildSalesStatistics, salesStatisticsValuationEvents, type SalesStatisticsSources } from './sales-statistics.model';
import type { SalesQuery, SalesQueryInput, SalesStatisticsReport } from './sales-statistics.types';

type Actor = { id: string; role: string };
const READ_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'];
const FINANCIAL_ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT'];
const BATCH = 500, SOURCE_TTL = 30_000, EXPORT_TTL = 120_000;
const orderSelect = {
  ...orderOriginSelect, number: true, clientId: true, client: { select: { displayName: true } },
  createdAt: true, updatedAt: true, archivedAt: true, country: true, type: true, discipline: true,
  priceMinor: true, currency: true, depositRequiredMinor: true, salesStatus: true, paymentStatus: true, shippingStatus: true,
  items: { where: { archivedAt: null }, select: { id: true, quantity: true, priceMinor: true, discipline: true, archivedAt: true, instances: { select: { id: true, archivedAt: true } } } },
} satisfies Prisma.OrderSelect;
const paymentSelect = { id: true, orderId: true, amountMinor: true, currency: true, receivedAt: true, voidedAt: true, appliedAmountMinor: true, appliedCurrency: true, exchangeRateSnapshot: true } satisfies Prisma.PaymentSelect;
const expenseSelect = { id: true, orderId: true, amountMinor: true, currency: true, incurredAt: true, archivedAt: true } satisfies Prisma.ExpenseSelect;
const args = (cursor?: string) => ({ take: BATCH, orderBy: { id: 'asc' as const }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
async function batches<T extends { id: string }>(read: (cursor?: string) => Promise<T[]>): Promise<T[]> {
  const all: T[] = []; let cursor: string | undefined;
  for (;;) {
    const next = await read(cursor); all.push(...next);
    if (all.length > 250_000) throw new ServiceUnavailableException('Слишком большой набор статистики: уточните период отчёта');
    if (next.length < BATCH) return all;
    const last = next[next.length - 1]!.id;
    if (last === cursor) throw new ServiceUnavailableException('Не удалось прочитать полный набор статистики');
    cursor = last;
  }
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Snapshot = { sources: SalesStatisticsSources; snapshots: unknown[]; provider: 'NBU' | 'ECB'; cache: ExchangeRateCache | null; version: string; at: number };
type PreparedFx = Awaited<ReturnType<SalesStatisticsFx['prepare']>>;
type ExportSnapshot = { actor: string; role: string; fingerprint: string; snapshot: Snapshot; fx: PreparedFx; report: SalesStatisticsReport; expires: number };

@Injectable()
export class SalesStatisticsService {
  private source?: Snapshot;
  private reading?: Promise<Snapshot>;
  private readonly fx = new SalesStatisticsFx();
  private readonly exports = new Map<string, ExportSnapshot>();
  constructor(private readonly prisma: PrismaService) {}

  private permissions(actor: Actor) {
    if (!READ_ROLES.includes(actor.role)) throw new ForbiddenException('Недостаточно прав для статистики продаж');
    return FINANCIAL_ROLES.includes(actor.role);
  }
  private async read(now: Date, force = false): Promise<Snapshot> {
    if (!force && this.source && now.getTime() < this.source.at + SOURCE_TTL) return this.source;
    if (this.reading) return this.reading;
    this.reading = this.prisma.$transaction(async tx => {
      const [orders, payments, expenses, redirects, clients, settings] = await Promise.all([
        batches(cursor => tx.order.findMany({ ...args(cursor), select: orderSelect })),
        batches(cursor => tx.payment.findMany({ ...args(cursor), where: { voidedAt: null }, select: paymentSelect })),
        batches(cursor => tx.expense.findMany({ ...args(cursor), where: { archivedAt: null }, select: expenseSelect })),
        tx.clientMergeRedirect.findMany({ select: { sourceClientId: true, targetClientId: true } }),
        batches(cursor => tx.client.findMany({ ...args(cursor), select: { id: true, displayName: true } })),
        tx.appSetting.findMany({ where: { section: 'finance', key: { in: ['exchangeRateProvider', 'exchangeRateCache'] } }, select: { key: true, value: true } }),
      ]);
      const sources: SalesStatisticsSources = {
        orders: orders.map(order => {
          const { activities: _activities, externalData: _externalData, sourceSystem: _system, sourceAccount: _account, sourceLinkMode: _mode, externalId: _externalId, client, ...record } = order;
          return { ...record, clientName: client.displayName, country: normalizeSalesCountry(order.country).code, orderSource: classifyOrderSource(order) };
        }),
        payments: payments.map(({ exchangeRateSnapshot: _snapshot, ...payment }) => payment),
        expenses, redirects, clients, countryLabels: salesCountryLabels,
      };
      const provider = settings.find(row => row.key === 'exchangeRateProvider')?.value === 'ECB' ? 'ECB' as const : 'NBU' as const;
      let cache: ExchangeRateCache | null = null;
      try { cache = parseExchangeRateCache(settings.find(row => row.key === 'exchangeRateCache')?.value); } catch { /* Missing evidence stays missing; no refresh or write. */ }
      if (cache?.provider !== provider) cache = null;
      return { sources, snapshots: payments.map(payment => payment.exchangeRateSnapshot).filter(Boolean), provider, cache, version: digest({ sources, provider, cache }), at: now.getTime() };
    }, { isolationLevel: 'RepeatableRead', timeout: 30_000, maxWait: 5_000 });
    try { this.source = await this.reading; return this.source; } finally { this.reading = undefined; }
  }

  async report(input: SalesQueryInput, actor: Actor, now = new Date()): Promise<SalesStatisticsReport> {
    const financial = this.permissions(actor), query = normalizeSalesQuery(input, now);
    const snapshot = await this.read(now, (input as SalesQueryInput & { refresh?: string }).refresh === '1');
    // Official historical HTTP is deliberately outside the database transaction.
    const events = financial ? salesStatisticsValuationEvents(snapshot.sources, query, now) : [];
    const span = Date.parse(query.to) - Date.parse(query.from) + 86_400_000;
    const priority = { from: new Date(Date.parse(query.from) - span).toISOString().slice(0, 10), to: query.to };
    const fx = await this.fx.prepare({ provider: snapshot.provider, currency: query.currency, events, priority, cache: snapshot.cache, snapshots: snapshot.snapshots });
    const report = buildSalesStatistics(snapshot.sources, query, financial, fx, now);
    const fingerprint = digest(query), version = digest({ snapshot: snapshot.version, fx: fx.version, query, actor: actor.id, role: actor.role });
    report.valuationVersion = version;
    report.generatedAt = new Date(snapshot.at).toISOString(); report.expiresAt = new Date(snapshot.at + SOURCE_TTL).toISOString();
    for (const [key, value] of this.exports) if (value.expires <= now.getTime()) this.exports.delete(key);
    while (this.exports.size >= 100) this.exports.delete(this.exports.keys().next().value!);
    this.exports.set(version, { actor: actor.id, role: actor.role, fingerprint, snapshot, fx, report, expires: now.getTime() + EXPORT_TTL });
    return report;
  }

  export(input: SalesQueryInput, actor: Actor, now = new Date()): string {
    this.permissions(actor);
    const query = normalizeSalesQuery(input, now), token = input.valuationVersion;
    const saved = token ? this.exports.get(token) : undefined;
    if (!saved || saved.actor !== actor.id || saved.role !== actor.role || saved.expires <= now.getTime() || saved.fingerprint !== digest(query)) throw new ConflictException('Данные или курс отчёта обновились. Обновите статистику перед экспортом.');
    const report = buildSalesStatistics(saved.snapshot.sources, query, saved.report.financial, saved.fx, new Date(saved.report.generatedAt), true);
    return salesStatisticsCsv(report);
  }
}

/** Complete filtered groups or drill rows, never only the ten visible ranking rows. */
export function salesStatisticsCsv(report: SalesStatisticsReport): string {
  const { query } = report;
  const group = query.tab === 'sources' ? report.sources : query.tab === 'sports' ? report.sports : query.tab === 'types' ? report.types : query.tab === 'clients' ? report.clients : report.countries;
  const rows = query.drill ? report.drilldown.rows : group;
  if (rows.length > 50_000) throw new BadRequestException('Экспорт ограничен 50 000 строками. Уточните фильтры.');
  const header = ['Название', 'Страна', 'Заказы', 'Физические изделия', query.drill ? 'Клиент' : 'Клиенты', ...(report.financial ? [query.drill === 'payments' ? 'Сумма платежа, мин. ед.' : 'Стоимость заказов, мин. ед.', 'Получено платежей, мин. ед.', 'Средний чек, мин. ед.', 'Валюта'] : []),
    ...(!query.drill && query.tab === 'clients' && report.financial ? ['Заказы за всё время', 'Стоимость заказов за всё время, мин. ед.', 'Поступления за всё время, мин. ед.'] : [])];
  const result: unknown[][] = [
    ['Статистика продаж', query.from, query.to],
    ['Методика', 'Физические изделия включают аксессуары; стоимость заказа включает доставку и сохранённые скидки'],
    ['Курс', report.valuation.provider, 'На дату события', 'Пропущено пересчётов', report.valuation.missingCount],
    header,
    ...rows.map(row => [row.label, row.country, row.orders, row.pieces, 'clients' in row ? row.clients : row.clientName || '', ...(report.financial ? [row.amountMinor, row.receivedMinor, row.averageMinor, query.currency] : []),
      ...(!query.drill && query.tab === 'clients' && report.financial && 'lifetimeOrders' in row ? [row.lifetimeOrders, row.lifetimeAmountMinor, row.lifetimeReceivedMinor] : [])]),
  ];
  return '\uFEFF' + result.map(row => row.map(csvCell).join(';')).join('\r\n');
}
