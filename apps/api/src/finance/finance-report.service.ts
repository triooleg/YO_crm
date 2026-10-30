import { legacyOrderNumberAlias } from '../website-orders/website-order-number';
import {classifyOrderSource,orderOriginSelect,loadOrderSourceMap} from '../orders/order-source';
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { parseExchangeRateCache, type ExchangeRateCache } from "./exchange-rates";
import { assertValuationVersion, buildFinanceReport, createReportConverter, financePeriod, financeReportCsv, normalizeFinanceQuery, type FinanceReportQuery, type FinanceValuation } from "./finance-report-model";
import { presentInvoice } from "./invoice-number";
import { TaxesService } from '../taxes/taxes.service';
import { monthsBetween } from '../taxes/tax-math';
import { fiscalTaxTable, projectFiscalReport, unavailableFiscalReport, type FiscalLedger } from './finance-fiscal-model';
import { appendFiscalCsv, fiscalTaxCsv } from './finance-fiscal-csv';
import type { HistoricalRate } from '../taxes/historical-nbu.service';

const BATCH_SIZE = 500;
const orderSelect = { ...orderOriginSelect, id: true, number: true, clientId: true, client: { select: { displayName: true } }, priceMinor: true, currency: true, salesStatus: true, paymentStatus: true, shippingStatus: true, requiredDeliveryAt: true, archivedAt: true, productionSlot: { select: { endsAt: true } } } satisfies Prisma.OrderSelect;
const paymentSelect = { id: true, orderId: true, amountMinor: true, currency: true, receivedAt: true, method: true, notes: true, appliedAmountMinor: true, appliedCurrency: true } satisfies Prisma.PaymentSelect;
const expenseSelect = { id: true, categoryId: true, category: { select: { name: true } }, amountMinor: true, currency: true, incurredAt: true, orderId: true, order: { select: { number: true } }, notes: true, orderShipment: { select: { id: true } } } satisfies Prisma.ExpenseSelect;
const invoiceSelect = { id: true, number: true, documentOptions: true, orderId: true, order: { select: { number: true, clientId: true, client: { select: { displayName: true } } } }, issueDate: true, dueDate: true, totalMinor: true, currency: true, status: true } satisfies Prisma.InvoiceSelect;

async function readBatches<T extends { id: string }>(read: (cursor: string | undefined) => Promise<T[]>) {
  const result: T[] = []; let cursor: string | undefined;
  for (;;) {
    const batch = await read(cursor); result.push(...batch);
    if (batch.length < BATCH_SIZE) return result;
    cursor = batch[batch.length - 1]!.id;
  }
}
const batchArgs = (cursor?: string) => ({ take: BATCH_SIZE, orderBy: { id: "asc" as const }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });

@Injectable()
export class FinanceReportService {
  private readonly fiscalRateCache = new Map<string, { expiresAt: number; value: Promise<HistoricalRate | Error | null> }>();
  constructor(private readonly prisma: PrismaService, private readonly taxes?: TaxesService) {}

  private async historicalRate(currency: string, date: string) {
    const key = currency + ':' + date, now = Date.now();
    let cached = this.fiscalRateCache.get(key);
    if (!cached || cached.expiresAt <= now) {
      if (this.fiscalRateCache.size >= 1024) this.fiscalRateCache.delete(this.fiscalRateCache.keys().next().value!);
      const entry = { expiresAt: now + 30000, value: Promise.resolve<HistoricalRate | Error | null>(null) };
      entry.value = this.taxes!.historicalRate(currency, date).then(rate => { entry.expiresAt = Date.now() + 15 * 60000; return rate; }).catch((reason: unknown) => reason instanceof Error && ['FX_EVIDENCE_INVALID','FX_EVIDENCE_CONFLICT','FX_STORAGE_UNAVAILABLE'].includes(String((reason as Error & {code?:string}).code)) ? reason : null);
      this.fiscalRateCache.set(key, entry); cached = entry;
    }
    const rate = await cached.value;
    if (rate instanceof Error) throw rate;
    if (!rate) throw new Error('HISTORICAL_FX_UNAVAILABLE');
    return rate;
  }

  private async valuation(tx: Prisma.TransactionClient): Promise<FinanceValuation> {
    const settings = await tx.appSetting.findMany({ where: { section: "finance", key: { in: ["exchangeRateProvider", "exchangeRateCache"] } }, select: { key: true, value: true } });
    const selected = settings.find(setting => setting.key === "exchangeRateProvider")?.value, provider = selected === "ECB" ? "ECB" : "NBU";
    let cache: ExchangeRateCache | null = null;
    try { cache = parseExchangeRateCache(settings.find(setting => setting.key === "exchangeRateCache")?.value); } catch { /* Missing/invalid cache is explicit when conversion is needed. */ }
    return { provider, cache: cache?.provider === provider ? cache : null };
  }

  async report(input: FinanceReportQuery, exportAll = false) {
    const now = new Date(), query = normalizeFinanceQuery(input, now), from = financePeriod(query.month, -Math.max(query.range - 1, 1)), end = financePeriod(query.month, 1);
    const snapshot = await this.prisma.$transaction(async tx => {
      const valuation = await this.valuation(tx); assertValuationVersion(query, valuation, now);
      // Archived orders retain immutable history but are outside every active finance projection.
      const orders = await readBatches(cursor => tx.order.findMany({ ...batchArgs(cursor), where: { archivedAt: null }, select: orderSelect }));
      const payments = await readBatches(cursor => tx.payment.findMany({ ...batchArgs(cursor), where: { voidedAt: null, order: { archivedAt: null } }, select: paymentSelect }));
      const expenses = await readBatches(cursor => tx.expense.findMany({ ...batchArgs(cursor), where: { archivedAt: null, incurredAt: { gte: from, lt: end }, OR: [{ orderId: null }, { order: { archivedAt: null } }] }, select: expenseSelect }));
      const invoices = await readBatches(cursor => tx.invoice.findMany({ ...batchArgs(cursor), where: { archivedAt: null, order: { archivedAt: null }, issueDate: { gte: financePeriod(query.month), lt: end } }, select: invoiceSelect }));
      const categories = await readBatches(cursor => tx.expenseCategory.findMany({ ...batchArgs(cursor), where: { OR: [{ active: true }, { expenses: { some: { archivedAt: null, incurredAt: { gte: from, lt: end }, OR: [{ orderId: null }, { order: { archivedAt: null } }] } } }] }, select: { id: true, name: true, active: true } }));
      const orderSources=Object.fromEntries(orders.map(order=>[order.id,classifyOrderSource(order)]));
      const missingIds=[...new Set([...payments.map(row=>row.orderId),...invoices.map(row=>row.orderId),...expenses.map(row=>row.orderId)].filter((id):id is string=>Boolean(id)&&!Object.hasOwn(orderSources,id!)))];
      Object.assign(orderSources,await loadOrderSourceMap(tx,missingIds));
      // Taxes have their own rows/statuses. Legacy fields always use their established projection.
      const legacyQuery = query.tab === 'taxes' ? { ...query, tab: 'payments', status: undefined } : query;
      const result = buildFinanceReport({ orderSources, orders, payments, expenses, invoices: invoices.map(presentInvoice), categories }, legacyQuery, valuation, now, query.tab === 'taxes' ? false : exportAll);
      let ledger: FiscalLedger = { months: [], links: [], unavailable: true };
      let fiscalOrders = orders;
      let fiscalPayments = payments, fiscalExpenses = expenses;
      if (this.taxes) {
        // Recover from a failed tax SQL read without aborting the working legacy cash snapshot.
        await tx.$executeRawUnsafe('SAVEPOINT fiscal_read');
        try {
          const months = [];
          for (const m of monthsBetween(from.toISOString().slice(0, 7), query.month)) months.push(await this.taxes.readReportIn(tx, m));
          const links = [...new Map(months.flatMap(m => m.settlementOptions).map(l => [l.expenseId, { expenseId: l.expenseId, component: l.component }])).values()];
          ledger = { months, links };
          // Extra Kyiv boundary reads belong only to the new fiscal projection.
          const fiscalFrom = new Date(from.getTime() - 86400000);
          const precedingPayments = await readBatches(cursor => tx.payment.findMany({ ...batchArgs(cursor), where: { voidedAt: null, order: { archivedAt: null }, receivedAt: { gte: fiscalFrom, lt: from } }, select: paymentSelect }));
          const precedingExpenses = await readBatches(cursor => tx.expense.findMany({ ...batchArgs(cursor), where: { archivedAt: null, incurredAt: { gte: fiscalFrom, lt: from }, OR: [{ orderId: null }, { order: { archivedAt: null } }] }, select: expenseSelect }));
          fiscalPayments = [...payments, ...precedingPayments]; fiscalExpenses = [...expenses, ...precedingExpenses];
          const extraOriginIds = [...new Set([...precedingPayments.map(p=>p.orderId), ...precedingExpenses.map(e=>e.orderId)].filter((id):id is string=>Boolean(id)&&!Object.hasOwn(orderSources,id!)))];
          Object.assign(orderSources, await loadOrderSourceMap(tx, extraOriginIds));
          const taxOrderIds = [...new Set([...months.flatMap(m => m.entries.map(e => e.orderId)), ...fiscalPayments.map(p => p.orderId), ...fiscalExpenses.map(e => e.orderId)].filter((id): id is string => Boolean(id)))].filter(id => !orders.some(o => o.id === id));
          if (taxOrderIds.length) {
            const historical = await readBatches(cursor => tx.order.findMany({ ...batchArgs(cursor), where: { id: { in: taxOrderIds }, archivedAt: null }, select: orderSelect }));
            fiscalOrders = [...orders, ...historical];
            Object.assign(orderSources, Object.fromEntries(historical.map(o => [o.id, classifyOrderSource(o)])));
          }
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT fiscal_read');
        } catch {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fiscal_read');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT fiscal_read');
          ledger = { months: [], links: [], unavailable: true };
        }
      }
      return { result, data: { orders: fiscalOrders, orderSources, payments: fiscalPayments, expenses: fiscalExpenses, ledger } };
    }, { isolationLevel: "RepeatableRead", timeout: 30_000, maxWait: 5_000 });
    let fiscal = unavailableFiscalReport(query);
    const cashEvidence: Record<string,unknown>[] = [];
    if (!snapshot.data.ledger.unavailable && this.taxes) {
      try { fiscal = await projectFiscalReport(snapshot.data, query, (c, d) => this.historicalRate(c, d), now, evidence => cashEvidence.push(evidence), exportAll && query.tab === 'expenses'); }
      catch (error) { if(error instanceof BadRequestException)throw error; cashEvidence.length = 0; /* The fiscal namespace remains explicitly unavailable; legacy cash is still readable. */ }
    }
    if (query.tab === 'taxes') {
      const table = fiscalTaxTable(fiscal, query, exportAll);
      if (exportAll) return appendFiscalCsv(fiscalTaxCsv(table.rows), fiscal, cashEvidence);
      return { ...snapshot.result, fiscal, table };
    }
    return exportAll ? this.taxes ? appendFiscalCsv(financeReportCsv(snapshot.result, query.tab, fiscal.expenseValues), fiscal, cashEvidence, query.tab === 'expenses') : financeReportCsv(snapshot.result, query.tab) : { ...snapshot.result, fiscal };
  }

  async order(id: string, query: FinanceReportQuery) {
    const now = new Date(), normalized = normalizeFinanceQuery(query, now);
    return this.prisma.$transaction(async tx => {
      const valuation = await this.valuation(tx);
      assertValuationVersion(query, valuation, now);
      const order = await tx.order.findFirst({ where: { id }, select: { id: true, number: true, priceMinor: true, depositRequiredMinor: true, currency: true, requiredDeliveryAt: true, archivedAt: true, client: { select: { displayName: true, country: true, language: true } }, payments: { where: { voidedAt: null }, orderBy: [{ receivedAt: "desc" }, { id: "asc" }], select: { ...paymentSelect, reference: true, sourceSystem: true } }, invoices: { where: { archivedAt: null }, orderBy: [{ issueDate: "desc" }, { id: "asc" }] } } });
      if (!order) throw new NotFoundException("Заказ не найден");
      const convert = createReportConverter(normalized.currency, valuation, now);
      return { ...order, ...(order.invoices ? { invoices: order.invoices.map(presentInvoice) } : {}), displayCurrency: normalized.currency, payments: order.payments.map(payment => ({ ...payment, displayAmountMinor: convert(payment.amountMinor, payment.currency) })) };
    }, { isolationLevel: "RepeatableRead" });
  }

  /** Bounded searchable options, including clients outside the first report page. */
  async options(search = "") {
    const text = search.trim().slice(0, 200);
    const orders = await this.prisma.order.findMany({ where: { archivedAt: null, ...(text ? { OR: [{ number: { contains: text, mode: "insensitive" as const } }, ...(legacyOrderNumberAlias(text) ? [legacyOrderNumberAlias(text)!] : []), { client: { displayName: { contains: text, mode: "insensitive" as const } } }] } : {}) }, take: 100, orderBy: [{ number: "asc" }, { id: "asc" }], select: { id: true, number: true, currency: true, clientId: true, client: { select: { displayName: true } } } });
    return { orders: orders.map(order => ({ id: order.id, number: order.number, currency: order.currency, clientName: order.client.displayName })), clients: [...new Map(orders.map(order => [order.clientId, { id: order.clientId, name: order.client.displayName }])).values()], limit: 100 };
  }
}
