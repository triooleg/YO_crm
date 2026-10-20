import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { SalesQuery, SalesTotals, SalesGroup, SalesDrillRow, SalesStatisticsReport } from './sales-statistics.types';
import { financeBusinessDay } from '../finance/finance-report-model';

export type SalesStatisticsDate = Date | string;
export interface SalesStatisticsItemSource {
  id: string; quantity: number; priceMinor: number; discipline: string | null;
  archivedAt: SalesStatisticsDate | null; instances: { id: string; archivedAt: SalesStatisticsDate | null }[];
}
export interface SalesStatisticsOrderSource {
  id: string; number: string; clientId: string; clientName: string; createdAt: SalesStatisticsDate;
  country: string | null; orderSource: string; type: string; discipline: string | null;
  priceMinor: number; currency: string; depositRequiredMinor: number;
  salesStatus: string; paymentStatus: string; shippingStatus: string; archivedAt: SalesStatisticsDate | null;
  items: SalesStatisticsItemSource[];
}
export interface SalesStatisticsPaymentSource {
  id: string; orderId: string; amountMinor: number; currency: string; receivedAt: SalesStatisticsDate;
  voidedAt: SalesStatisticsDate | null; appliedAmountMinor?: number | null; appliedCurrency?: string | null;
}
export interface SalesStatisticsExpenseSource {
  id: string; orderId: string | null; amountMinor: number; currency: string;
  incurredAt: SalesStatisticsDate; archivedAt: SalesStatisticsDate | null;
}
export interface SalesStatisticsRedirectSource { sourceClientId: string; targetClientId: string }
export interface SalesStatisticsClientSource { id: string; displayName: string }
export interface SalesStatisticsSources {
  orders: SalesStatisticsOrderSource[]; payments: SalesStatisticsPaymentSource[]; expenses: SalesStatisticsExpenseSource[];
  redirects: SalesStatisticsRedirectSource[]; clients: SalesStatisticsClientSource[]; countryLabels: Record<string, string>;
}
export interface SalesStatisticsValuation {
  provider: string; convert: (amount: number, currency: string, date: SalesStatisticsDate) => number | null; dates?: string[];
}
type Order = SalesStatisticsOrderSource;
const unique = <T extends { id: string }>(rows: T[]): T[] => [...new Map(rows.map(row => [row.id, row])).values()];
function sum(values: number[]): number {
  let result = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new ServiceUnavailableException('Некорректная сумма отчёта');
    result += BigInt(value);
  }
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new ServiceUnavailableException('Сумма отчёта вне безопасного диапазона');
  return Number(result);
}
function average(amount: number | null, count: number): number | null {
  return amount === null || count === 0 ? null : Number((BigInt(amount) * 2n + BigInt(count)) / (2n * BigInt(count)));
}
const completeSum = (values: (number | null)[]) => values.some(value => value === null) ? null : sum(values as number[]);
const activeItems = (order: Order) => unique(order.items).filter(item => !item.archivedAt).map(item => {
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new ServiceUnavailableException('Некорректное количество изделий');
  return item;
});
const sport = (order: Order, item: SalesStatisticsItemSource) => item.discipline || order.discipline || 'UNKNOWN';
const eligible = (order: Order) => !order.archivedAt && order.salesStatus !== 'CANCELLED' && !['CANCELLED', 'REFUNDED'].includes(order.paymentStatus);
const businessDay = (value: SalesStatisticsDate) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : financeBusinessDay(new Date(value));
const shiftDay = (value: string, offset: number) => new Date(Date.parse(value + 'T12:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);

/** Pure projection: the caller owns the snapshot, query normalization and historical FX. */
export function buildSalesStatistics(sources: SalesStatisticsSources, query: SalesQuery, financial: boolean, valuation: SalesStatisticsValuation, now = new Date(), exportAll = false): SalesStatisticsReport {
  const days = new Map<string | number, string>(), itemCache = new Map<Order, SalesStatisticsItemSource[]>(), pieceCache = new Map<Order, number>();
  const day = (value: SalesStatisticsDate) => {
    const key = value instanceof Date ? value.getTime() : value;
    if (!days.has(key)) days.set(key, businessDay(value));
    return days.get(key)!;
  };
  const items = (order: Order) => { if (!itemCache.has(order)) itemCache.set(order, activeItems(order)); return itemCache.get(order)!; };
  const pieces = (order: Order) => { if (!pieceCache.has(order)) pieceCache.set(order, sum(items(order).map(item => item.quantity))); return pieceCache.get(order)!; };
  const warningIds = new Map<string, Set<string>>();
  const warn = (code: string, id: string) => { const ids = warningIds.get(code) ?? new Set<string>(); ids.add(id); warningIds.set(code, ids); };
  const conversions = new Map<string, number | null>();
  const convert = (id: string, amount: number, currency: string, date: SalesStatisticsDate) => {
    if (!financial) return null;
    const key = JSON.stringify([id, amount, currency, date]);
    if (conversions.has(key)) return conversions.get(key)!;
    if (!Number.isSafeInteger(amount) || amount < 0) throw new ServiceUnavailableException('Некорректная исходная сумма отчёта');
    const value = valuation.convert(amount, currency, date);
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new ServiceUnavailableException('Некорректная конвертация отчёта');
    if (value === null) warn('MISSING_EXCHANGE_RATE', id);
    conversions.set(key, value); return value;
  };
  const redirects = new Map<string, string>();
  for (const row of sources.redirects) {
    if (redirects.has(row.sourceClientId) && redirects.get(row.sourceClientId) !== row.targetClientId) throw new BadRequestException('Неоднозначное направление объединения');
    redirects.set(row.sourceClientId, row.targetClientId);
  }
  const clientNames = new Map(sources.clients.map(row => [row.id, row.displayName]));
  const canonicalIds = new Map<string, string>();
  const canonical = (id: string) => {
    const seen = new Set<string>();
    while (redirects.has(id) && !canonicalIds.has(id)) {
      if (seen.has(id)) throw new BadRequestException('Цикл объединения клиентов');
      seen.add(id); id = redirects.get(id)!;
    }
    id = canonicalIds.get(id) ?? id;
    if (!clientNames.has(id)) throw new BadRequestException('Не найден канонический клиент');
    for (const source of seen) canonicalIds.set(source, id);
    return id;
  };
  for (const id of redirects.keys()) canonical(id);
  const orders: Order[] = unique(sources.orders).map(order => {
    const clientId = canonical(order.clientId);
    return { id: order.id, number: order.number, clientId, clientName: clientNames.get(clientId)!, createdAt: order.createdAt,
      country: order.country === 'UNKNOWN' ? null : order.country, orderSource: order.orderSource, type: order.type, discipline: order.discipline,
      salesStatus: order.salesStatus, paymentStatus: order.paymentStatus, shippingStatus: order.shippingStatus, archivedAt: order.archivedAt, items: order.items,
      priceMinor: financial ? order.priceMinor : 0, depositRequiredMinor: financial ? order.depositRequiredMinor : 0, currency: financial ? order.currency : '' };
  });
  const orderMap = new Map(orders.map(order => [order.id, order]));
  const payments = unique(sources.payments).filter(payment => !payment.voidedAt);
  const paymentsByOrder = new Map<string, SalesStatisticsPaymentSource[]>();
  for (const payment of payments) { const rows = paymentsByOrder.get(payment.orderId) ?? []; rows.push(payment); paymentsByOrder.set(payment.orderId, rows); }
  const history = orders.filter(eligible).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
  const historyByClient = new Map<string, Order[]>();
  const allByClient = new Map<string, Order[]>();
  for (const order of orders) { const rows = allByClient.get(order.clientId) ?? []; rows.push(order); allByClient.set(order.clientId, rows); }
  const first = new Map<string, Order>();
  for (const order of history) {
    if (!first.has(order.clientId)) first.set(order.clientId, order);
    const rows = historyByClient.get(order.clientId) ?? []; rows.push(order); historyByClient.set(order.clientId, rows);
  }
  const repeat = (order: Order) => Boolean(first.has(order.clientId) && first.get(order.clientId)!.id !== order.id);
  const excludedCountries = new Set(query.country.startsWith('OTHERS:') ? query.country.slice(7).split(',') : []);
  const matchesRepeat = (order: Order) => {
    const initial = first.get(order.clientId);
    if (!query.repeat) return true;
    if (query.repeat === 'repeat') return repeat(order);
    if (query.repeat === 'new') return initial?.id === order.id;
    if (!initial) return false;
    const firstMonth = day(initial.createdAt).slice(0, 7), month = day(order.createdAt).slice(0, 7);
    return query.repeat === 'new-client' ? firstMonth === month : firstMonth < month;
  };
  const amount = (rows: Order[]) => financial ? completeSum(rows.map(order => convert('order:' + order.id, order.priceMinor, order.currency, order.createdAt))) : null;
  const matches = (order: Order) => (!query.source || (query.source === 'NON_WEBSITE' ? order.orderSource !== 'WEBSITE' : order.orderSource === query.source))
    && (!query.country || (excludedCountries.size ? !excludedCountries.has(order.country ?? 'UNKNOWN') : (order.country ?? 'UNKNOWN') === query.country)) && (!query.clientId || order.clientId === canonical(query.clientId))
    && (!query.orderType || order.type === query.orderType) && (!query.status || order.salesStatus === query.status)
    && (!query.discipline || items(order).some(item => sport(order, item) === query.discipline))
    && matchesRepeat(order);
  const cohort = orders.filter(order => (query.scope === 'all' ? !order.archivedAt : eligible(order)) && matches(order));
  const inside = (value: SalesStatisticsDate, from: string, to: string) => day(value) >= from && day(value) <= to;
  const selected = cohort.filter(order => inside(order.createdAt, query.from, query.to));
  const exportCount = query.drill === 'pieces' ? sum(selected.map(order => items(order).length)) : query.drill === 'orders' ? selected.length
    : query.drill === 'clients' ? new Set(selected.map(order => order.clientId)).size : query.drill === 'countries' ? new Set(selected.map(order => order.country)).size : 0;
  if (exportAll && exportCount > 50_000) throw new BadRequestException('Экспорт ограничен 50000 строками. Уточните фильтры.');
  const length = Math.round((Date.parse(query.to) - Date.parse(query.from)) / 86_400_000) + 1;
  const previousFrom = shiftDay(query.from, -length), previousTo = shiftDay(query.from, -1);
  const receipts = (from: string, to: string) => payments.filter(payment => {
    const order = orderMap.get(payment.orderId);
    return order && matches(order) && inside(payment.receivedAt, from, to);
  });
  const cash = (rows: SalesStatisticsPaymentSource[]) => financial ? completeSum(rows.map(payment => convert('payment:' + payment.id, payment.amountMinor, payment.currency, payment.receivedAt))) : null;
  const unfiltered = ![query.source, query.status, query.clientId, query.country, query.orderType, query.discipline, query.repeat].some(Boolean);
  const expenses = unique(sources.expenses).filter(expense => !expense.archivedAt);
  /** Unallocated expenses belong only to the unfiltered cohort, never prorated across countries/clients. */
  const expenseAmount = (from: string, to: string) => {
    if (!financial) return null;
    const rows = expenses.filter(expense => {
      if (!inside(expense.incurredAt, from, to)) return false;
      if (!expense.orderId) { warn(unfiltered ? 'UNALLOCATED_EXPENSES_INCLUDED' : 'UNALLOCATED_EXPENSES_EXCLUDED', expense.id); return unfiltered; }
      const order = orderMap.get(expense.orderId);
      return order && matches(order);
    });
    return completeSum(rows.map(expense => convert('expense:' + expense.id, expense.amountMinor, expense.currency, expense.incurredAt)));
  };
  const debt = (rows: Order[]) => {
    if (!financial) return null;
    const values: (number | null)[] = [];
    for (const order of rows.filter(row => eligible(row) && row.salesStatus !== 'COMPLETED' && row.shippingStatus !== 'RETURNED')) {
      const applied: number[] = [];
      let unknown = false;
      for (const payment of paymentsByOrder.get(order.id) ?? []) {
        const value = payment.currency === order.currency ? payment.amountMinor : payment.appliedCurrency === order.currency ? payment.appliedAmountMinor : null;
        if (value === null || value === undefined || !Number.isSafeInteger(value) || value < 0) { warn('MISSING_APPLIED_PAYMENT', payment.id); unknown = true; continue; }
        applied.push(value);
      }
      values.push(unknown ? null : convert('order:' + order.id, Math.max(0, sum([order.priceMinor, -sum(applied)])), order.currency, order.createdAt));
    }
    return completeSum(values);
  };
  const currentPayments = receipts(query.from, query.to);
  if (exportAll && query.drill === 'payments' && currentPayments.length > 50_000) throw new BadRequestException('Экспорт ограничен 50000 строками. Уточните фильтры.');
  const currentPaymentsByOrder = new Map<string, SalesStatisticsPaymentSource[]>();
  for (const payment of currentPayments) { const rows = currentPaymentsByOrder.get(payment.orderId) ?? []; rows.push(payment); currentPaymentsByOrder.set(payment.orderId, rows); }
  const totals = (rows: Order[], paid: SalesStatisticsPaymentSource[], from: string, to: string): SalesTotals => ({ orders: rows.length, pieces: sum(rows.map(pieces)), countries: new Set(rows.map(row => row.country).filter(Boolean)).size,
    unknownCountryOrders: rows.filter(row => !row.country).length, clients: new Set(rows.map(row => row.clientId)).size,
    repeatOrders: rows.filter(repeat).length, repeatClients: new Set(rows.filter(repeat).map(row => row.clientId)).size,
    repeatShare: rows.length ? new Set(rows.filter(repeat).map(row => row.clientId)).size / new Set(rows.map(row => row.clientId)).size * 100 : null, amountMinor: amount(rows), receivedMinor: cash(paid),
    debtMinor: debt(rows), expensesMinor: expenseAmount(from, to), resultMinor: cash(paid) === null || expenseAmount(from, to) === null ? null : sum([cash(paid)!, -expenseAmount(from, to)!]), averageMinor: average(amount(rows), rows.length) });
  const group = (rows: Order[], key: string, label: string, country: string | null, paid: SalesStatisticsPaymentSource[] = []): SalesGroup => ({ key, label, country, ...(financial ? { receiptCount: paid.length } : {}), orders: rows.length, pieces: sum(rows.map(pieces)), clients: new Set(rows.map(row => row.clientId)).size,
    amountMinor: amount(rows), receivedMinor: cash(paid), averageMinor: average(amount(rows), rows.length), pieceAverageMinor: average(amount(rows), sum(rows.map(pieces))) });
  const by = (rows: Order[], key: (order: Order) => string, paid: SalesStatisticsPaymentSource[] = []): SalesGroup[] => {
    const buckets = new Map<string, { orders: Order[]; payments: SalesStatisticsPaymentSource[] }>();
    const bucket = (value: string) => { if (!buckets.has(value)) buckets.set(value, { orders: [], payments: [] }); return buckets.get(value)!; };
    for (const order of rows) bucket(key(order)).orders.push(order);
    for (const payment of paid) bucket(key(orderMap.get(payment.orderId)!)).payments.push(payment);
    return [...buckets].map(([value, members]) => group(members.orders, value, value, null, members.payments));
  };
  const countries = by(selected, order => order.country ?? 'UNKNOWN', currentPayments).map(row => ({ ...row, country: row.key === 'UNKNOWN' ? null : row.key, label: sources.countryLabels[row.key] ?? (row.key === 'UNKNOWN' ? 'Не определена' : row.key) }));
  const itemAmount = (order: Order, item: SalesStatisticsItemSource) => {
    if (!financial) return null;
    if (!Number.isSafeInteger(item.priceMinor) || item.priceMinor < 0) throw new ServiceUnavailableException('Некорректная цена изделия');
    const line = BigInt(item.priceMinor) * BigInt(item.quantity);
    if (line > BigInt(Number.MAX_SAFE_INTEGER)) throw new ServiceUnavailableException('Сумма изделий вне безопасного диапазона');
    return convert('order:' + order.id, Number(line), order.currency, order.createdAt);
  };
  /** Sport order counts/values overlap; the pie uses exclusive quantities. Unit averages use stored item prices. */
  const sportGroups = (selectedRows: Order[], paid: SalesStatisticsPaymentSource[]) => [...new Set([...selectedRows, ...paid.map(payment => orderMap.get(payment.orderId)!)].flatMap(order => items(order).map(item => sport(order, item))))].map(key => {
    const rows = selectedRows.filter(order => items(order).some(item => sport(order, item) === key));
    const ids = new Set(paid.map(payment => orderMap.get(payment.orderId)!).filter(order => items(order).some(item => sport(order, item) === key)).map(order => order.id));
    const lines = rows.flatMap(order => items(order).filter(item => sport(order, item) === key).map(item => ({ order, item })));
    const count = sum(lines.map(({ item }) => item.quantity));
    return { ...group(rows, key, key, null, paid.filter(payment => ids.has(payment.orderId))), pieces: count,
      pieceAverageMinor: financial ? average(completeSum(lines.map(({ order, item }) => itemAmount(order, item))), count) : null };
  });
  const sports = sportGroups(selected, currentPayments);
  for (const order of selected) if (new Set(items(order).map(item => sport(order, item))).size > 1) warn('SPORT_ORDER_OVERLAP', order.id);
  for (const order of selected) for (const item of items(order)) if (item.instances.filter(instance => !instance.archivedAt).length !== item.quantity) warn('ITEM_INSTANCE_MISMATCH', order.id + ':' + item.id);
  const countryOrdersByClient = new Map<string, Map<string, Order>>();
  for (const order of [...selected, ...currentPayments.map(payment => orderMap.get(payment.orderId)!)]) {
    const rows = countryOrdersByClient.get(order.clientId) ?? new Map<string, Order>();
    rows.set(order.id, order); countryOrdersByClient.set(order.clientId, rows);
  }
  const clients = by(selected, order => order.clientId, currentPayments).map(row => {
    const lifetime = historyByClient.get(row.key) ?? [];
    const countryOrders = [...(countryOrdersByClient.get(row.key)?.values() ?? [])];
    const countries = [...new Set(countryOrders.map(order => order.country).filter((country): country is string => Boolean(country)))].sort();
    return { ...row, country: countries.length === 1 ? countries[0]! : null, countries, hasUnknownCountry: countryOrders.some(order => !order.country), label: clientNames.get(row.key)!, ...(financial ? { lifetimeOrders: lifetime.length } : {}), lifetimeAmountMinor: amount(lifetime), lifetimeReceivedMinor: cash((allByClient.get(row.key) ?? []).flatMap(order => paymentsByOrder.get(order.id) ?? [])) };
  });
  const endMonth = new Date(query.to.slice(0, 7) + '-01T12:00:00Z');
  const monthly = Array.from({ length: query.months }, (_, index) => {
    const date = new Date(endMonth); date.setUTCMonth(date.getUTCMonth() + index - query.months + 1);
    const month = date.toISOString().slice(0, 7), rows = selected.filter(order => day(order.createdAt).startsWith(month));
    const clientIds = [...new Set(rows.map(order => order.clientId))];
    const from = month + '-01' > query.from ? month + '-01' : query.from;
    const next = new Date(date); next.setUTCMonth(next.getUTCMonth() + 1);
    const last = shiftDay(next.toISOString().slice(0, 10), -1), to = last < query.to ? last : query.to;
    const paid = receipts(from, to);
    return { month, orders: rows.length, pieces: sum(rows.map(pieces)), amountMinor: amount(rows), receivedMinor: cash(paid),
      newClients: clientIds.filter(id => first.has(id) && day(first.get(id)!.createdAt).slice(0, 7) === month).length,
      returningClients: clientIds.filter(id => first.has(id) && day(first.get(id)!.createdAt).slice(0, 7) < month).length,
      newOrders: rows.filter(order => first.get(order.clientId)?.id === order.id).length, repeatOrders: rows.filter(repeat).length,
      countries: by(rows, order => order.country ?? 'UNKNOWN', paid).map(row => ({ ...row, country: row.key === 'UNKNOWN' ? null : row.key, label: sources.countryLabels[row.key] ?? (row.key === 'UNKNOWN' ? 'Не определена' : row.key) })), sources: by(rows, order => order.orderSource, paid), sports: sportGroups(rows, paid), types: by(rows, order => order.type, paid) };
  }).filter(row => row.month >= query.from.slice(0, 7));
  const orderRows: SalesDrillRow[] = selected.map(order => ({ id: order.id, label: order.number, orderId: order.id, number: order.number, clientId: order.clientId, clientName: order.clientName,
    date: new Date(order.createdAt).toISOString(), country: order.country, source: order.orderSource, orderType: order.type, discipline: order.discipline, orders: 1, pieces: pieces(order),
    amountMinor: amount([order]), receivedMinor: cash(currentPaymentsByOrder.get(order.id) ?? []), averageMinor: amount([order]) }));
  const current = totals(selected, currentPayments, query.from, query.to), previous = totals(cohort.filter(order => inside(order.createdAt, previousFrom, previousTo)), receipts(previousFrom, previousTo), previousFrom, previousTo);
  const sourceGroups = by(selected, order => order.orderSource, currentPayments), types = by(selected, order => order.type, currentPayments);
  const compare = (left: number | string | null, right: number | string | null, leftKey: string, rightKey: string, direction: 'asc' | 'desc') => {
    if (left === null || right === null) return left === right ? leftKey.localeCompare(rightKey) : left === null ? 1 : -1;
    const value = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right, 'ru') : Number(left) - Number(right);
    return value * (direction === 'asc' ? 1 : -1) || leftKey.localeCompare(rightKey);
  };
  const groupValue = (row: SalesGroup, sort: string) => sort === 'amount' ? row.amountMinor : sort === 'received' ? row.receivedMinor : sort === 'average' ? row.averageMinor : sort === 'label' ? row.label : sort === 'pieces' ? row.pieces : sort === 'clients' ? row.clients : row.orders;
  for (const groups of [countries, sourceGroups, sports, types]) groups.sort((a, b) => compare(groupValue(a, query.sort), groupValue(b, query.sort), a.key, b.key, query.direction));
  const ranking = !financial && ['amount', 'received'].includes(query.ranking) ? 'orders' : query.ranking;
  const clientSort = query.sort === 'label' || query.sort === 'average' ? query.sort : ranking;
  clients.sort((a, b) => compare(groupValue(a, clientSort), groupValue(b, clientSort), a.key, b.key, query.direction));
  const optionOrders = orders.filter(order => !order.archivedAt);
  const countryOptions = [...new Set(optionOrders.map(order => order.country ?? 'UNKNOWN'))].sort().map(value => ({ value, label: sources.countryLabels[value] ?? (value === 'UNKNOWN' ? 'Не определена' : value) }));
  const options = {
    clients: [...new Set(sources.clients.map(client => canonical(client.id)))].map(value => ({ value, label: clientNames.get(value)! })).sort((a, b) => a.label.localeCompare(b.label, 'ru') || a.value.localeCompare(b.value)),
    countries: countryOptions, types: [...new Set(optionOrders.map(order => order.type))].sort(),
    disciplines: [...new Set(optionOrders.flatMap(order => items(order).map(item => sport(order, item))))].sort(),
    statuses: [...new Set(optionOrders.map(order => order.salesStatus))].sort(),
  };
  const groupedRows = (groups: SalesGroup[], kind: 'countries' | 'clients'): SalesDrillRow[] => groups.filter(row => row.orders > 0 || (financial && query.ranking === 'received' && (row.receiptCount ?? 0) > 0)).map(row => ({
    id: row.key, label: row.label, orderId: null, number: null, clientId: kind === 'clients' ? row.key : null, clientName: kind === 'clients' ? row.label : null,
    date: null, country: row.country, source: null, orderType: null, discipline: null, orders: row.orders, pieces: row.pieces,
    amountMinor: row.amountMinor, receivedMinor: row.receivedMinor, averageMinor: row.averageMinor,
  }));
  const paymentRows: SalesDrillRow[] = query.drill === 'payments' ? currentPayments.map(payment => {
    const order = orderMap.get(payment.orderId)!;
    const value = financial ? convert('payment:' + payment.id, payment.amountMinor, payment.currency, payment.receivedAt) : null;
    return { id: payment.id, label: order.number, orderId: order.id, orderArchived: !!order.archivedAt, number: order.number, clientId: order.clientId, clientName: order.clientName,
      date: new Date(payment.receivedAt).toISOString(), country: order.country, source: order.orderSource, orderType: order.type, discipline: order.discipline,
      orders: 0, pieces: 0, amountMinor: value, receivedMinor: value, averageMinor: null };
  }) : [];
  const rows = query.drill === 'payments' ? paymentRows : query.drill === 'orders' ? orderRows : query.drill === 'pieces' ? orderRows.flatMap(row => {
    const order = orderMap.get(row.orderId!)!;
    return items(order).filter(item => !query.discipline || sport(order, item) === query.discipline).map(item => ({ ...row, id: order.id + ':' + item.id, label: order.number + ' / ' + item.id, pieces: item.quantity, discipline: sport(order, item),
      // Order-level shipping/discounts cannot be attributed to an item without an allocation policy.
      amountMinor: null, receivedMinor: null, averageMinor: null }));
  }) : query.drill === 'countries' ? groupedRows(countries, 'countries') : query.drill === 'clients' ? groupedRows(clients, 'clients') : [];
  const sortValue = (row: SalesDrillRow) => query.sort === 'amount' ? row.amountMinor : query.sort === 'received' ? row.receivedMinor : query.sort === 'average' ? row.averageMinor : query.sort === 'clients' ? (row.clientId ? 1 : countries.find(country => country.key === row.id)?.clients ?? 0) : row[query.sort];
  rows.sort((a, b) => {
    const left = sortValue(a), right = sortValue(b);
    if (left === null || right === null) return left === right ? a.id.localeCompare(b.id) : left === null ? 1 : -1;
    const comparison = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right, 'ru') : Number(left) - Number(right);
    return comparison * (query.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
  });
  return { query, generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30_000).toISOString(), financial, valuationVersion: '',
    valuation: { provider: valuation.provider, basis: 'event-date', missingCount: warningIds.get('MISSING_EXCHANGE_RATE')?.size ?? 0, dates: financial ? [...new Set(valuation.dates ?? [])].sort() : [] }, warnings: [...warningIds].map(([code, ids]) => ({ code, count: ids.size })), current, previous,
    countries, sources: sourceGroups, clients, sports, types, monthly, options,
    drilldown: { kind: query.drill, rows: exportAll ? rows : rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize } };
}

/** Discover only monetary dependencies of this report, including its visible clients' lifetime values.
 * A zero valuation does not change membership; the same pure projection owns all predicates.
 */
export function salesStatisticsValuationEvents(sources: SalesStatisticsSources, query: SalesQuery, now = new Date()) {
  const events = new Map<string, { amountMinor: number; currency: string; date: SalesStatisticsDate }>();
  buildSalesStatistics(sources, query, true, { provider: 'dependency-only', convert: (amountMinor, currency, date) => {
    events.set(JSON.stringify([currency, date, amountMinor]), { amountMinor, currency, date }); return 0;
  } }, now);
  return [...events.values()];
}
