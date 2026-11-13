import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeOrderSourceFilter } from '../orders/order-source';
import { fiscalTaxTable } from './finance-fiscal-model';
import type { FiscalReport, FiscalTaxRow } from './finance-fiscal.types';
import type { FinanceReportQuery } from './finance-report-model';

export type FinanceCacheRowMode = 'legacy' | 'fiscalExpense' | 'tax';
type Row = Record<string, unknown> & { id: string };
export type PreparedFinanceCacheRow<T extends Row = Row> = {
  kind: string; id: string; ordinal: number;
  payload: { value: T; ranks: Record<string, number>; search: { exactId: string; fields: (string | null)[] } };
};
const sorts = ['date', 'number', 'client', 'amount', 'paid', 'balance', 'category', 'status'] as const;
type Sort = typeof sorts[number];
const legacyKeys: Record<Sort, string> = { date: 'date', number: 'number', client: 'clientName', amount: 'amountMinor', paid: 'paidMinor', balance: 'balanceMinor', category: 'categoryName', status: 'status' };
const expenseKeys: Partial<Record<Sort, string>> = { date: 'originalTimestamp', number: 'number', client: 'clientName', amount: 'amountMinor', category: 'categoryName' };
const taxKeys: Partial<Record<Sort, string>> = { number: 'number', client: 'clientName', amount: 'amountMinor', status: 'status', category: 'component' };
const searchFields = {
  legacy: ['number', 'orderNumber', 'clientName', 'categoryName', 'notes'],
  fiscalExpense: ['number', 'categoryName', 'clientName', 'notes'],
  tax: ['id', 'number', 'clientName', 'component', 'status', 'orderId', 'paymentId'],
};
const lower = (value: string) => value.toLocaleLowerCase('ru-RU');
function checkMode(mode: FinanceCacheRowMode) {
  if (!['legacy', 'fiscalExpense', 'tax'].includes(mode)) throw new BadRequestException('Неизвестная проекция строк отчёта');
}

/** Only derivative rows, never personal query state. The parent owns snapshot
 * readiness, integrity, atomic publication and the read transaction's consistency.
 * Legacy payment inputs are the complete selected-month allOrderRows, including
 * activeDebt/receivedInMonth/forecastDate; do not supply a paginated table.
 * Tax inputs are the complete fiscal.rows in ledger order (latest receipt last).
 */
export function prepareCacheRows<T extends Row>(kind: string, rows: readonly T[], mode: FinanceCacheRowMode): PreparedFinanceCacheRow<T>[] {
  checkMode(mode);
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => typeof row.id !== 'string' || !row.id)) {
    throw new BadRequestException('Некорректные идентификаторы строк отчёта');
  }
  // Reuse the authoritative reversal predicate before any query filters. No
  // monetary projection or tax calculation is duplicated here. This function
  // does not validate pageSize; an unbounded page avoids the CSV 50k guard.
  const taxIds = mode === 'tax' ? new Set(fiscalTaxTable(
    { rows: [...rows] as unknown as FiscalTaxRow[] } as FiscalReport,
    { pageSize: Number.MAX_SAFE_INTEGER }, false).rows.map(row => row.id)) : undefined;
  // Preserve input order when localeCompare considers distinct Unicode IDs
  // equivalent: the existing JS sort is stable in that case.
  const eligible = taxIds ? rows.filter(row => taxIds.has(row.id)) : [...rows];
  const result = eligible.map((row, ordinal) => ({ kind, id: row.id, ordinal,
    payload: { value: row, ranks: {} as Record<string, number>,
      // JS case folding avoids PostgreSQL locale differences (including İ).
      // These derived fields are row data, not saved user search/filter state.
      search: { exactId: lower(row.id), fields: searchFields[mode].map(field => typeof row[field] === 'string' ? lower(row[field] as string) : null) } },
  }));
  for (const sort of sorts) for (const direction of ['asc', 'desc'] as const) {
    const key = mode === 'legacy' ? legacyKeys[sort] : mode === 'tax' ? taxKeys[sort] ?? 'date' : expenseKeys[sort] ?? 'originalTimestamp';
    const sorted = [...result].sort((left, right) => {
      const a = left.payload.value[key], b = right.payload.value[key];
      const tie = () => left.id.localeCompare(right.id);
      if (mode === 'legacy') {
        if (a == null && b != null) return 1;
        if (b == null && a != null) return -1;
      } else {
        if (a === null) return b === null ? tie() : 1;
        if (b === null) return -1;
      }
      const comparison = typeof a === 'number' && typeof b === 'number'
        ? mode === 'legacy' ? a - b : a < b ? -1 : a > b ? 1 : 0
        : String(mode === 'legacy' ? a ?? '' : a).localeCompare(String(mode === 'legacy' ? b ?? '' : b), 'ru', { numeric: true });
      return comparison * (direction === 'asc' ? 1 : -1) || tie();
    });
    sorted.forEach((row, rank) => { row.payload.ranks[`${sort}:${direction}`] = rank; });
  }
  // Detach payloads from callers and produce actual JSON (undefined omitted).
  return JSON.parse(JSON.stringify(result)) as PreparedFinanceCacheRow<T>[];
}

/** Read-only SQL pagination. Pass an already-authorized ready snapshot key and
 * one stable transaction; count and page must see the same published row set.
 * All query values, including rank names/JSON keys, are bound parameters.
 */
export async function readFinanceCacheRows(
  tx: Pick<Prisma.TransactionClient, '$queryRawUnsafe'>, key: string, kind: string,
  query: FinanceReportQuery, mode: FinanceCacheRowMode, exportAll = false,
) {
  checkMode(mode);
  const pageSize = query.pageSize ?? 10, requestedPage = query.page ?? 1;
  const sort = query.sort ?? 'date', direction = query.direction ?? 'desc';
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 100000 || ![10, 25, 50, 100].includes(pageSize)
    || !sorts.includes(sort as Sort) || !['asc', 'desc'].includes(direction)) throw new BadRequestException('Недопустимая страница или сортировка отчёта');
  const source = normalizeOrderSourceFilter(query.source);
  const tab = mode === 'tax' ? 'taxes' : mode === 'fiscalExpense' ? 'expenses' : query.tab ?? 'payments';
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const field = (name: string) => `(payload->'value'->>${bind(name)})`;
  const where = [`"snapshotKey" = ${bind(key)}`, `kind = ${bind(kind)}`];
  if (source) {
    // Tax excludes explicit null order IDs; its JS predicate does not exclude
    // an omitted field. Only legacy coerces absent/empty sources to UNKNOWN.
    if (mode === 'tax') where.push(`COALESCE(jsonb_typeof(payload->'value'->'orderId'), '') <> 'null'`);
    const origin = mode === 'legacy' ? `COALESCE(NULLIF(${field('orderSource')}, ''), 'UNKNOWN')` : field('orderSource');
    // Only this allowlisted operator varies; source values remain parameters.
    where.push(`${origin} ${source === 'NON_WEBSITE' ? 'IS DISTINCT FROM' : '='} ${bind(source === 'NON_WEBSITE' ? 'WEBSITE' : source)}`);
  }
  for (const name of ['clientId', 'orderId', 'categoryId', 'status'] as const) {
    if (mode === 'tax' && name === 'categoryId' || mode === 'fiscalExpense' && name === 'status') continue;
    if (query[name]) where.push(`${field(name)} = ${bind(query[name])}`);
  }
  if (mode === 'tax' && query.taxComponent) where.push(`${field('component')} = ${bind(query.taxComponent)}`);
  if (mode === 'legacy' && tab === 'payments') {
    if (query.scope === 'forecast') where.push(`COALESCE(${field('forecastDate')}, '') <> ''`);
    else where.push(`(${field('receivedInMonth')} = 'true' OR (${field('activeDebt')} = 'true' AND (${field('originalBalanceMinor')})::numeric > 0))`);
  }
  for (const [name, operator] of [['from', '>='], ['to', '<=']] as const) if (query[name]) {
    // Legacy uses date.slice(0,10); fiscal tables compare the full date value.
    const date = mode === 'legacy' ? `left(${field('date')}, 10)` : field('date');
    if (mode === 'legacy') where.push(`jsonb_typeof(payload->'value'->'date') = 'string'`);
    where.push(`${date} ${operator} ${bind(query[name])}`);
  }
  const search = query.search?.trim().toLocaleLowerCase('ru-RU');
  if (search) {
    const needle = bind(search);
    const contains = `EXISTS (SELECT 1 FROM jsonb_array_elements_text(payload->'search'->'fields') AS s(value) WHERE strpos(s.value, ${needle}) > 0)`;
    where.push(mode === 'fiscalExpense' || mode === 'legacy' && tab === 'expenses'
      ? `(payload->'search'->>'exactId' = ${needle} OR ${contains})` : contains);
  }
  const predicate = where.join(' AND ');
  const counts = await tx.$queryRawUnsafe<{ total: bigint | number | string }[]>(
    `SELECT count(*) AS total FROM "FinanceReportCacheRow" WHERE ${predicate}`, ...values);
  const total = Number(counts[0]!.total);
  if (!Number.isSafeInteger(total) || total < 0) throw new BadRequestException('Некорректное число строк отчёта');
  if (exportAll && total > 50000) throw new BadRequestException('Экспорт ограничен 50 000 строками. Уточните фильтры.');
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const rank = bind(`${sort}:${direction}`), limit = bind(exportAll ? 50000 : pageSize), offset = bind(exportAll ? 0 : (page - 1) * pageSize);
  const saved = await tx.$queryRawUnsafe<{ value: Row }[]>(
    `SELECT payload->'value' AS value FROM "FinanceReportCacheRow" WHERE ${predicate} ORDER BY (payload->'ranks'->>${rank})::int LIMIT ${limit} OFFSET ${offset}`, ...values);
  return { tab, rows: saved.map(row => row.value), total, page, pageSize };
}
