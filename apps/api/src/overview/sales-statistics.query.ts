import { BadRequestException } from '@nestjs/common';
import { SalesStatus, OrderType, Discipline } from '@prisma/client';
import { normalizeOrderSourceFilter } from '../orders/order-source';
import { financeBusinessDay } from '../finance/finance-report-model';
import { normalizeSalesCountry } from './sales-statistics-country';
import type { SalesQuery, SalesQueryInput } from './sales-statistics.types';

const DATE = /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
function validDay(value: string) { return DATE.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function select<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value == null || value === '') return fallback;
  if (!allowed.includes(value as T)) throw new BadRequestException('Некорректное значение фильтра статистики');
  return value as T;
}
export function normalizeSalesQuery(input: SalesQueryInput = {}, now = new Date()): SalesQuery {
  // ES2022 DTO instances own undefined fields for omitted optional query parameters.
  for (const [key, value] of Object.entries(input)) if (value !== undefined && (typeof value !== 'string' || value.length > (key === 'clientId' ? 128 : 200))) throw new BadRequestException('Некорректный параметр статистики');
  const month = financeBusinessDay(now).slice(0, 7), start = new Date(`${month}-01T12:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 11);
  const last = new Date(`${month}-01T12:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  const from = input.from || start.toISOString().slice(0, 10), to = input.to || last.toISOString().slice(0, 10);
  if (!validDay(from) || !validDay(to) || from > to || Date.parse(to) - Date.parse(from) > 3660 * 86400000) throw new BadRequestException('Выберите корректный период статистики не более десяти лет');
  const page = Number(input.page || 1), pageSize = Number(input.pageSize || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || ![10, 25, 50, 100].includes(pageSize)) throw new BadRequestException('Некорректная страница статистики');
  const status = input.status === 'all' ? '' : input.status || '', orderType = input.orderType === 'all' ? '' : input.orderType || '', discipline = input.discipline === 'all' ? '' : input.discipline || '';
  if (status && !Object.values(SalesStatus).includes(status as SalesStatus)) throw new BadRequestException('Неизвестный статус заказа');
  if (orderType && !Object.values(OrderType).includes(orderType as OrderType)) throw new BadRequestException('Неизвестный тип заказа');
  if (discipline && discipline !== 'UNKNOWN' && !Object.values(Discipline).includes(discipline as Discipline)) throw new BadRequestException('Неизвестный вид спорта');
  const rawCountry = input.country === 'all' ? '' : input.country || '';
  const excluded = rawCountry.startsWith('OTHERS:') ? rawCountry.slice(7).split(',') : [];
  if (excluded.length && (excluded.length > 5 || excluded.some(code => code !== 'UNKNOWN' && (!/^[A-Z]{2}$/.test(code) || normalizeSalesCountry(code).code !== code)))) throw new BadRequestException('Неизвестная страна фильтра');
  const country = excluded.length ? 'OTHERS:' + [...new Set(excluded)].sort().join(',') : rawCountry === 'UNKNOWN' ? rawCountry : rawCountry ? normalizeSalesCountry(rawCountry).code : '';
  if (rawCountry && !country) throw new BadRequestException('Неизвестная страна фильтра');
  if (input.valuationVersion && !/^[a-f0-9]{64}$/.test(input.valuationVersion)) throw new BadRequestException('Некорректная версия отчёта');
  if (input.refresh && !['0', '1'].includes(input.refresh)) throw new BadRequestException('Некорректное обновление отчёта');
  return {
    from, to, currency: select(input.currency, ['EUR', 'USD', 'UAH'] as const, 'EUR'),
    source: normalizeOrderSourceFilter(input.source === 'all' ? '' : input.source), status, clientId: input.clientId || '', country: country || '', orderType, discipline,
    tab: select(input.tab, ['countries', 'sources', 'clients', 'sports', 'types'] as const, 'countries'),
    months: Number(select(input.months, ['3', '6', '12'] as const, '6')) as 3 | 6 | 12,
    metric: select(input.metric, ['orders', 'pieces', 'amount'] as const, 'orders'),
    customerMetric: select(input.customerMetric, ['clients', 'orders'] as const, 'clients'),
    revenueMetric: select(input.revenueMetric, ['orders', 'payments'] as const, 'orders'),
    ranking: select(input.ranking, ['amount', 'received', 'orders', 'pieces'] as const, 'amount'),
    scope: select(input.scope, ['sales', 'all'] as const, 'sales'), repeat: select(input.repeat, ['', 'new', 'repeat', 'new-client', 'returning-client'] as const, ''),
    drill: select(input.drill, ['', 'orders', 'pieces', 'countries', 'clients', 'payments'] as const, ''), page, pageSize,
    sort: select(input.sort, ['label', 'orders', 'pieces', 'amount', 'received', 'average', 'clients'] as const, 'orders'),
    direction: select(input.direction, ['asc', 'desc'] as const, 'desc'),
  };
}
