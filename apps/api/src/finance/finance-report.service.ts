import {classifyOrderSource,orderOriginSelect,loadOrderSourceMap} from '../orders/order-source';
import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { parseExchangeRateCache, type ExchangeRateCache } from "./exchange-rates";
import { assertValuationVersion, buildFinanceReport, createReportConverter, financePeriod, financeReportCsv, normalizeFinanceQuery, type FinanceReportQuery, type FinanceValuation } from "./finance-report-model";

const BATCH_SIZE = 500;
const orderSelect = { ...orderOriginSelect, id: true, number: true, clientId: true, client: { select: { displayName: true } }, priceMinor: true, currency: true, salesStatus: true, paymentStatus: true, shippingStatus: true, requiredDeliveryAt: true, productionSlot: { select: { endsAt: true } } } satisfies Prisma.OrderSelect;
const paymentSelect = { id: true, orderId: true, amountMinor: true, currency: true, receivedAt: true, method: true, notes: true, appliedAmountMinor: true, appliedCurrency: true } satisfies Prisma.PaymentSelect;
const expenseSelect = { id: true, categoryId: true, category: { select: { name: true } }, amountMinor: true, currency: true, incurredAt: true, orderId: true, order: { select: { number: true } }, notes: true, orderShipment: { select: { id: true } } } satisfies Prisma.ExpenseSelect;
const invoiceSelect = { id: true, number: true, orderId: true, order: { select: { number: true, clientId: true, client: { select: { displayName: true } } } }, issueDate: true, dueDate: true, totalMinor: true, currency: true, status: true } satisfies Prisma.InvoiceSelect;

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
  constructor(private readonly prisma: PrismaService) {}

  private async valuation(tx: Prisma.TransactionClient): Promise<FinanceValuation> {
    const settings = await tx.appSetting.findMany({ where: { section: "finance", key: { in: ["exchangeRateProvider", "exchangeRateCache"] } }, select: { key: true, value: true } });
    const selected = settings.find(setting => setting.key === "exchangeRateProvider")?.value, provider = selected === "ECB" ? "ECB" : "NBU";
    let cache: ExchangeRateCache | null = null;
    try { cache = parseExchangeRateCache(settings.find(setting => setting.key === "exchangeRateCache")?.value); } catch { /* Missing/invalid cache is explicit when conversion is needed. */ }
    return { provider, cache: cache?.provider === provider ? cache : null };
  }

  async report(input: FinanceReportQuery, exportAll = false) {
    const now = new Date(), query = normalizeFinanceQuery(input, now), from = financePeriod(query.month, -Math.max(query.range - 1, 1)), end = financePeriod(query.month, 1);
    return this.prisma.$transaction(async tx => {
      const valuation = await this.valuation(tx); assertValuationVersion(query, valuation, now);
      // Cash rows are independent of order archive status; settlement needs every active order payment.
      const orders = await readBatches(cursor => tx.order.findMany({ ...batchArgs(cursor), where: { archivedAt: null }, select: orderSelect }));
      const payments = await readBatches(cursor => tx.payment.findMany({ ...batchArgs(cursor), where: { voidedAt: null, OR: [{ order: { archivedAt: null } }, { receivedAt: { gte: from, lt: end } }] }, select: paymentSelect }));
      const expenses = await readBatches(cursor => tx.expense.findMany({ ...batchArgs(cursor), where: { archivedAt: null, incurredAt: { gte: from, lt: end } }, select: expenseSelect }));
      const invoices = await readBatches(cursor => tx.invoice.findMany({ ...batchArgs(cursor), where: { archivedAt: null, issueDate: { gte: financePeriod(query.month), lt: end } }, select: invoiceSelect }));
      const categories = await readBatches(cursor => tx.expenseCategory.findMany({ ...batchArgs(cursor), where: { OR: [{ active: true }, { expenses: { some: { archivedAt: null, incurredAt: { gte: from, lt: end } } } }] }, select: { id: true, name: true, active: true } }));
      const orderSources=Object.fromEntries(orders.map(order=>[order.id,classifyOrderSource(order)]));
      const missingIds=[...new Set([...payments.map(row=>row.orderId),...invoices.map(row=>row.orderId),...expenses.map(row=>row.orderId)].filter((id):id is string=>Boolean(id)&&!Object.hasOwn(orderSources,id!)))];
      Object.assign(orderSources,await loadOrderSourceMap(tx,missingIds));
      const result = buildFinanceReport({ orderSources, orders, payments, expenses, invoices, categories }, query, valuation, now, exportAll);
      return exportAll ? financeReportCsv(result, query.tab) : result;
    }, { isolationLevel: "RepeatableRead", timeout: 30_000, maxWait: 5_000 });
  }

  async order(id: string, query: FinanceReportQuery) {
    const now = new Date(), normalized = normalizeFinanceQuery(query, now);
    return this.prisma.$transaction(async tx => {
      const valuation = await this.valuation(tx);
      assertValuationVersion(query, valuation, now);
      const order = await tx.order.findFirst({ where: { id }, select: { id: true, number: true, priceMinor: true, depositRequiredMinor: true, currency: true, requiredDeliveryAt: true, archivedAt: true, client: { select: { displayName: true, country: true, language: true } }, payments: { where: { voidedAt: null }, orderBy: [{ receivedAt: "desc" }, { id: "asc" }], select: { ...paymentSelect, reference: true, sourceSystem: true } }, invoices: { where: { archivedAt: null }, orderBy: [{ issueDate: "desc" }, { id: "asc" }] } } });
      if (!order) throw new NotFoundException("Заказ не найден");
      const convert = createReportConverter(normalized.currency, valuation, now);
      return { ...order, displayCurrency: normalized.currency, payments: order.payments.map(payment => ({ ...payment, displayAmountMinor: convert(payment.amountMinor, payment.currency) })) };
    }, { isolationLevel: "RepeatableRead" });
  }

  /** Bounded searchable options, including clients outside the first report page. */
  async options(search = "") {
    const text = search.trim().slice(0, 200);
    const orders = await this.prisma.order.findMany({ where: { archivedAt: null, ...(text ? { OR: [{ number: { contains: text, mode: "insensitive" as const } }, { client: { displayName: { contains: text, mode: "insensitive" as const } } }] } : {}) }, take: 100, orderBy: [{ number: "asc" }, { id: "asc" }], select: { id: true, number: true, currency: true, clientId: true, client: { select: { displayName: true } } } });
    return { orders: orders.map(order => ({ id: order.id, number: order.number, currency: order.currency, clientName: order.client.displayName })), clients: [...new Map(orders.map(order => [order.clientId, { id: order.clientId, name: order.client.displayName }])).values()], limit: 100 };
  }
}
