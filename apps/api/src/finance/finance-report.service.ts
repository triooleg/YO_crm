import { FinanceSourceCache } from "./finance-source-cache";
import { legacyOrderNumberAlias } from '../website-orders/website-order-number';
import {classifyOrderSource,orderOriginSelect,loadOrderSourceMap} from '../orders/order-source';
import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
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
import { readFinancePaymentFacts } from './finance-payment-facts';
import { FinancePersistentReport, type FinanceDeferredSnapshot } from './finance-persistent-report';

const BATCH_SIZE = 500;
const orderSelect = { ...orderOriginSelect, id: true, number: true, clientId: true, client: { select: { displayName: true } }, priceMinor: true, currency: true, salesStatus: true, paymentStatus: true, shippingStatus: true, requiredDeliveryAt: true, archivedAt: true, productionSlot: { select: { endsAt: true } } } satisfies Prisma.OrderSelect;
const paymentSelect = { id: true, orderId: true, amountMinor: true, currency: true, receivedAt: true, method: true, notes: true, appliedAmountMinor: true, appliedCurrency: true, sourceSystem: true, externalStatus: true, reference: true } satisfies Prisma.PaymentSelect;
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
  private readonly sourceCache = new FinanceSourceCache<Awaited<ReturnType<FinanceReportService["readSources"]>>>();
  private readonly persistent: FinancePersistentReport;
  constructor(private readonly prisma: PrismaService, private readonly taxes?: TaxesService) {
    this.persistent=new FinancePersistentReport(prisma,
      async(tx,query,from,end,purpose)=>{const raw=await this.readSources(tx,query,from,end,true,purpose);return {...raw,invoices:raw.invoices.map(presentInvoice)};},
      tx=>this.valuation(tx),taxes?(c,d)=>taxes.historicalRate(c,d):undefined);
  }

  /** Aggregate process diagnostics only; no database keys, customer data or HTTP route. */
  sourceCacheStats() { return this.sourceCache.stats(); }
  persistentCacheStats() { return this.persistent.cache.diagnostics(); }
  async cacheDiagnostics() {
    const process=this.persistentCacheStats();
    try{
      const coverage=await this.prisma.$queryRawUnsafe<{covered:boolean}[]>('SELECT yo_finance_cache_coverage() AS covered');
      const rows=await this.prisma.$queryRawUnsafe<{status:string;count:string}[]>('SELECT status,count(*)::text AS count FROM "FinancePeriodSnapshot" GROUP BY status ORDER BY status');
      return {available:coverage[0]?.covered===true,process,snapshots:rows.map(r=>({status:r.status,count:Number(r.count)}))};
    }catch{return {available:false,process,snapshots:[]};}
  }
  async rebuildCache(month:string|undefined,actor:{id:string;role:string}) {
    if(!['OWNER','ADMIN'].includes(actor.role))throw new ForbiddenException('Недостаточно прав');
    const query=normalizeFinanceQuery({month,projection:'summary'});
    // The cache revision/audit are atomic. Business records are never edited.
    await this.prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe('UPDATE "FinanceReportRevision" SET revision=revision+1 WHERE key=ANY($1::text[])',[`month:${query.month}`,`tax:${query.month}`]);
      await tx.auditLog.create({data:{actorId:actor.id,action:'REBUILD_CACHE',entityType:'FinanceReportCache',entityId:query.month,after:{month:query.month}}});
    });
    return this.report(query);
  }

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

  private async readSources(tx: Prisma.TransactionClient, query: ReturnType<typeof normalizeFinanceQuery>, from: Date, end: Date, bounded = false, purpose:'full'|'cash'|'fiscal'='full') {
    const deferredSnapshots:FinanceDeferredSnapshot[]=[];
    const detailFrom=bounded&&purpose==='full'?financePeriod(query.month):from;
    // Archived orders retain immutable history but are outside every active finance projection.
    const orders = await readBatches(cursor => tx.order.findMany({ ...batchArgs(cursor), where: { archivedAt: null }, select: orderSelect }));
    const payments = await readBatches(cursor => tx.payment.findMany({ ...batchArgs(cursor), where: { voidedAt: null, order: { archivedAt: null }, ...(bounded ? { receivedAt: {gte: detailFrom,lt:end} } : {}) }, select: paymentSelect }));
    const paymentFacts = bounded&&purpose==='full' ? await readFinancePaymentFacts(tx) : undefined;
    const expenses = await readBatches(cursor => tx.expense.findMany({ ...batchArgs(cursor), where: { archivedAt: null, incurredAt: { gte: detailFrom, lt: end }, OR: [{ orderId: null }, { order: { archivedAt: null } }] }, select: expenseSelect }));
    const invoices = await readBatches(cursor => tx.invoice.findMany({ ...batchArgs(cursor), where: { archivedAt: null, order: { archivedAt: null }, issueDate: { gte: financePeriod(query.month), lt: end } }, select: invoiceSelect }));
    const categories = await readBatches(cursor => tx.expenseCategory.findMany({ ...batchArgs(cursor), where: { OR: [{ active: true }, { expenses: { some: { archivedAt: null, incurredAt: { gte: from, lt: end }, OR: [{ orderId: null }, { order: { archivedAt: null } }] } } }] }, select: { id: true, name: true, active: true } }));
    const orderSources=Object.fromEntries(orders.map(order=>[order.id,classifyOrderSource(order)]));
    const missingIds=[...new Set([...payments.map(row=>row.orderId),...invoices.map(row=>row.orderId),...expenses.map(row=>row.orderId)].filter((id):id is string=>Boolean(id)&&!Object.hasOwn(orderSources,id!)))];
    Object.assign(orderSources,await loadOrderSourceMap(tx,missingIds));
    let ledger: FiscalLedger = { months: [], links: [], unavailable: true };
    let fiscalOrders = orders;
    let fiscalPayments = payments, fiscalExpenses = expenses;
    if (this.taxes&&purpose!=='cash') {
      // Recover from a failed tax SQL read without aborting the working legacy cash snapshot.
      await tx.$executeRawUnsafe('SAVEPOINT fiscal_read');
      try {
        const months = [];
        for (const m of monthsBetween(from.toISOString().slice(0, 7), query.month)) {
          // Root-wide ledger dependencies are tracked by DB triggers, including
          // RESOLVE/worker/import writes. A November receipt does not reread a
          // verified unchanged June ledger. Parent publication rechecks the
          // complete dependency vector after these independent RR reads.
          const request={period:m,scope:'tax-ledger',dependencies:['epoch','metadata','tax-global',`month:${m}`,`tax:${m}`],calculationVersion:'tax-read-model-v1',taxPolicyVersion:'fop-ledger-projection-v1',fxVersion:'native-uah'};
          const probe=bounded?await this.persistent.cache.peekIn<Awaited<ReturnType<TaxesService['readReportIn']>>>(tx,request):null;
          const payload=probe?.result?.payload??await this.taxes.readReportIn(tx,m);
          if(bounded&&!probe?.result&&probe?.revision)deferredSnapshots.push({request:{...request,expectedSourceRevision:probe.revision},projection:{payload:JSON.parse(JSON.stringify(payload))}});
          months.push(payload);
        }
        const links = [...new Map(months.flatMap(m => m.settlementOptions).map(l => [l.expenseId, { expenseId: l.expenseId, component: l.component }])).values()];
        ledger = { months, links };
        // Extra Kyiv boundary reads belong only to the new fiscal projection.
        const boundaryFrom=bounded?detailFrom:from,fiscalFrom = new Date(boundaryFrom.getTime() - 86400000);
        const precedingPayments = await readBatches(cursor => tx.payment.findMany({ ...batchArgs(cursor), where: { voidedAt: null, order: { archivedAt: null }, receivedAt: { gte: fiscalFrom, lt: boundaryFrom } }, select: paymentSelect }));
        const precedingExpenses = await readBatches(cursor => tx.expense.findMany({ ...batchArgs(cursor), where: { archivedAt: null, incurredAt: { gte: fiscalFrom, lt: boundaryFrom }, OR: [{ orderId: null }, { order: { archivedAt: null } }] }, select: expenseSelect }));
        fiscalPayments = [...payments, ...precedingPayments]; fiscalExpenses = [...expenses, ...precedingExpenses];
        if (bounded) {
          // A moved receipt may still be referenced by an earlier tax root.
          const known = new Set(fiscalPayments.map(p=>p.id));
          const referenced = [...new Set(months.filter(m=>m.month===query.month).flatMap(m=>[...m.entries.map(e=>e.paymentId),...m.pendingStatuses.map(p=>p.paymentId as string | undefined)]).filter((id):id is string=>Boolean(id)&&!known.has(id!)))];
          if (referenced.length) fiscalPayments.push(...await readBatches(cursor=>tx.payment.findMany({...batchArgs(cursor),where:{id:{in:referenced},voidedAt:null,order:{archivedAt:null}},select:paymentSelect})));
        }
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
    return { orders, payments, expenses, invoices, categories, orderSources, deferredSnapshots, ...(paymentFacts ? {paymentFacts} : {}),
      data: { orders: fiscalOrders, orderSources, payments: fiscalPayments, expenses: fiscalExpenses, ledger } };
  }

  private async sourceKey(tx: Prisma.TransactionClient, from: Date, end: Date, now: Date): Promise<string | null> {
    if (typeof tx.$queryRaw !== 'function') return null;
    await tx.$executeRawUnsafe('SAVEPOINT finance_snapshot_key');
    try {
      const rows = await tx.$queryRaw<{ snapshot: string; database: string; schema: string; server: string }[]>`SELECT txid_current_snapshot()::text AS snapshot, current_database() AS database, current_schema() AS schema, pg_postmaster_start_time()::text AS server`;
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT finance_snapshot_key');
      const row = rows[0];
      if (!row || typeof row.database !== 'string' || typeof row.schema !== 'string' || typeof row.server !== 'string' || !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(row.snapshot)) return null;
      return JSON.stringify([row.database, row.schema, row.server, row.snapshot, from.toISOString(), end.toISOString(), Math.floor(now.getTime() / 10_000)]);
    } catch {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT finance_snapshot_key');
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT finance_snapshot_key');
      return null;
    }
  }

  async report(input: FinanceReportQuery, exportAll = false) {
    const now = new Date(), query = normalizeFinanceQuery(input, now), from = financePeriod(query.month, -Math.max(query.range - 1, 1)), end = financePeriod(query.month, 1);
    // Missing migration/disabled coverage has a safe legacy fallback. The cache
    // never controls authorization or makes an old valuation token acceptable.
    if(typeof this.prisma.$queryRawUnsafe==='function'){
      const persisted=await this.persistent.report(query,exportAll,now);
      if(persisted!==null)return persisted;
    }
    let commit!: () => void, abort!: (error: unknown) => void;
    const committed = new Promise<void>((resolve, reject) => { commit = resolve; abort = reject; });
    void committed.catch(() => {});
    const snapshot = await this.prisma.$transaction(async tx => {
      const valuation = await this.valuation(tx); assertValuationVersion(query, valuation, now);
      const key = await this.sourceKey(tx, from, end, now);
      const raw = await this.sourceCache.read(key, () => this.readSources(tx, query, from, end), committed,
        raw => !this.taxes || !raw.data.ledger.unavailable);
      // Query-dependent calculations, valuation and time always belong to this request.
      const legacyQuery = query.tab === 'taxes' ? { ...query, tab: 'payments', status: undefined } : query;
      const result = buildFinanceReport({ ...raw, invoices: raw.invoices.map(presentInvoice) }, legacyQuery, valuation, now, query.tab === 'taxes' ? false : exportAll);
      return { result, data: raw.data };
    }, { isolationLevel: "RepeatableRead", timeout: 30_000, maxWait: 5_000 }).then(value => { commit(); return value; }, error => { abort(error); throw error; });
    let fiscal = unavailableFiscalReport(query);
    const cashEvidence: Record<string,unknown>[] = [];
    if (!snapshot.data.ledger.unavailable && this.taxes) {
      try { fiscal = await projectFiscalReport(snapshot.data, query, (c, d) => this.historicalRate(c, d), now, evidence => cashEvidence.push(evidence), exportAll && query.tab === 'expenses'); }
      catch (error) { if(error instanceof BadRequestException)throw error; cashEvidence.length = 0; /* The fiscal namespace remains explicitly unavailable; legacy cash is still readable. */ }
    }
    if (!exportAll && query.projection === 'summary') {
      return { ...snapshot.result, projection: 'summary' as const,
        receiptConfirmationCount: fiscal.current.incomplete ? new Set(fiscal.rows
          .filter(row => row.period === fiscal.current.month && row.source === 'PENDING' && row.status === 'RECEIPT_CONFIRMATION_REQUIRED' && row.paymentId)
          .map(row => row.paymentId)).size : 0,
        table: { ...snapshot.result.table, tab: query.tab, rows: [], total: 0 },
        options: { clients: [], categories: [], orders: [] }, recentExpenses: [], upcoming: [],
        fiscal: { ...fiscal, rows: [], expenseValues: [], recentExpenses: [], taxExpenseIds: [],
          expenseTable: { ...fiscal.expenseTable, rows: [], total: 0 } } };
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
      const order = await tx.order.findFirst({ where: { id }, select: { id: true, number: true, priceMinor: true, depositRequiredMinor: true, currency: true, requiredDeliveryAt: true, archivedAt: true, client: { select: { displayName: true, country: true, language: true } }, payments: { where: { voidedAt: null }, orderBy: [{ receivedAt: "desc" }, { id: "asc" }], select: paymentSelect }, invoices: { where: { archivedAt: null }, orderBy: [{ issueDate: "desc" }, { id: "asc" }] } } });
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
