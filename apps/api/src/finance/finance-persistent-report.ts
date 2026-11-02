import type { Prisma } from '@prisma/client';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { assertExchangeRateCacheFresh } from './exchange-rates';
import type { PrismaService } from '../prisma.service';
import { FinancePeriodCache, FinancePeriodCacheBusyError } from './finance-period-cache';
import { readRetryableFinanceSnapshot } from './finance-cache-retry';
import type { FinancePeriodRequest,FinancePeriodProjection } from './finance-period-cache';
import { prepareCacheRows, readFinanceCacheRows } from './finance-period-rows';
import { assertValuationVersion, buildFinanceReport, financeBusinessDay, financePeriod, financeReportCsv, normalizeFinanceQuery, valuationVersion, type FinanceReportQuery, type FinanceReportSources, type FinanceValuation } from './finance-report-model';
import { fiscalPeriodDependencies, projectFiscalReport, unavailableFiscalReport, type FiscalSources } from './finance-fiscal-model';
import { appendFiscalCsv, fiscalTaxCsv } from './finance-fiscal-csv';
import type { FiscalReport } from './finance-fiscal.types';
import type { HistoricalRate } from '../taxes/historical-nbu.service';
import { createHash } from 'node:crypto';
import { monthsBetween } from '../taxes/tax-math';

export type FinanceDeferredSnapshot={request:FinancePeriodRequest;projection:FinancePeriodProjection<unknown>};
type Sources = FinanceReportSources & { data: FiscalSources;deferredSnapshots?:FinanceDeferredSnapshot[] };
type Summary = ReturnType<typeof buildFinanceReport> & { fiscal: FiscalReport; receiptConfirmationCount: number; cacheRequiresCurrentFx?:boolean;cacheRetryable?:boolean;evidenceProjection?:'page' };
type ReportView=Omit<Summary,'table'>&{table:Awaited<ReturnType<typeof readFinanceCacheRows>>;projection?:'summary'};
type Query = ReturnType<typeof normalizeFinanceQuery>;
type ReadSources = (tx: Prisma.TransactionClient, query: Query, from: Date, end: Date,purpose?:'full'|'cash'|'fiscal') => Promise<Sources>;
const CALCULATION_VERSION = 'finance-projection-v1';
const TAX_POLICY_VERSION = 'fop-ledger-projection-v1';
class FinanceCacheBypass extends Error {}
const cacheRows=(rows:Record<string,unknown>[])=>rows.map(row=>{
  if(typeof row.id!=='string')throw new Error('Invalid financial projection identity');
  return {...row,id:row.id};
});

/** A report cache contains only unfiltered derived views. Session, role, search,
 * sort and page never enter shared payloads. Guards still run on every route.
 * The original report remains the fallback when coverage/storage is unavailable.
 */
export class FinancePersistentReport {
  readonly cache: FinancePeriodCache;
  constructor(private readonly prisma: PrismaService, private readonly readSources: ReadSources,
    private readonly readValuation: (tx: Prisma.TransactionClient) => Promise<FinanceValuation>,
    private readonly readRate: ((currency:string,date:string)=>Promise<HistoricalRate>) | undefined) {
    this.cache = new FinancePeriodCache(prisma);
  }
  private async publishDeferred(snapshots:FinanceDeferredSnapshot[]=[]){
    for(const snapshot of snapshots)await this.cache.read(snapshot.request,async()=>null,async()=>snapshot.projection);
  }

  async report(query: Query, exportAll: boolean, now: Date, repairAttempt=0):Promise<ReportView|string|null> {
    // This deliberately runs on every request, including a cache hit. An old
    // valuation token is never made valid by a stored report.
    const valuation = await this.prisma.$transaction(tx=>this.readValuation(tx),{isolationLevel:'RepeatableRead'});
    assertValuationVersion(query,valuation,now);
    const from = financePeriod(query.month,-Math.max(query.range-1,1)), end=financePeriod(query.month,1);
    const months=monthsBetween(from.toISOString().slice(0,7),query.month);
    const canonical = normalizeFinanceQuery({month:query.month,currency:query.currency,range:query.range,tab:'payments'},now);
    const cached = await readRetryableFinanceSnapshot(this.cache,{period:query.month,scope:`finance:${query.currency}:${query.range}:${financeBusinessDay(now)}:${query.tab==='invoices'?'invoices':'standard'}`,
      dependencies:['epoch','orders','metadata','settings','tax-global','fx-global',...months.flatMap(m=>[`month:${m}`,`tax:${m}`,`fx:${m}`])],
      calculationVersion:CALCULATION_VERSION,taxPolicyVersion:TAX_POLICY_VERSION,fxVersion:valuationVersion(valuation,now)},
      async tx=>{
        const current=await this.readValuation(tx);
        assertValuationVersion({...query,valuationVersion:valuationVersion(valuation,now)},current,now);
        const cashPeriods:NonNullable<FinanceReportSources['cashPeriods']>={};
        const deferredSnapshots:FinanceDeferredSnapshot[]=[];
        let cashRequiresCurrentFx=false;
        const cashFx=createHash('sha256').update(JSON.stringify(valuation)).digest('hex');
        for(const month of months){
          const monthQuery={...canonical,month};
          const request:FinancePeriodRequest={period:month,scope:`cash-month:${query.currency}`,dependencies:['epoch','settings',`month:${month}`],
            calculationVersion:'cash-period-v1',taxPolicyVersion:'not-applicable',fxVersion:cashFx};
          type Cash=NonNullable<FinanceReportSources['cashPeriods']>[string]&{requiresCurrentFx:boolean};
          const probe=await this.cache.peekIn<Cash>(tx,request);
          let payload=probe.result?.payload;
          if(!payload){
            const source=await this.readSources(tx,monthQuery,financePeriod(month),financePeriod(month,1),'cash');
            let requiresCurrentFx=false;
            const r=buildFinanceReport(source,monthQuery,{...valuation,onConversion:()=>{requiresCurrentFx=true;}},now,true,true,true);
            payload={...r.current,breakdown:r.sourceAnalytics.breakdown,requiresCurrentFx};
            if(probe.revision)deferredSnapshots.push({request:{...request,expectedSourceRevision:probe.revision},projection:{payload}});
          }
          cashPeriods[month]=payload;cashRequiresCurrentFx ||= payload.requiresCurrentFx;
        }
        const raw={...await this.readSources(tx,canonical,from,end),cashPeriods};
        const periodVersions:Record<string,{dependencies:string[];signature:string;clock:string;revision:string|null}>={};
        for(const month of months){
          const dependency=fiscalPeriodDependencies(raw.data,month,query.currency,now);
          periodVersions[month]={...dependency,revision:await this.cache.revisionIn(tx,dependency.dependencies)};
        }
        return {...raw,periodVersions,cashRequiresCurrentFx,deferredSnapshots:[...deferredSnapshots,...(raw.deferredSnapshots??[])]};
      },async raw=>{
        // No database transaction/connection is held while publishing child
        // snapshots. This remains safe even with a single-connection pool.
        await this.publishDeferred(raw.deferredSnapshots);
        let requiresCurrentFx=raw.cashRequiresCurrentFx;
        const observedValuation={...valuation,onConversion:()=>{requiresCurrentFx=true;}};
        const payments=buildFinanceReport(raw,canonical,observedValuation,now,true,true);
        const expenses=buildFinanceReport(raw,{...canonical,tab:'expenses'},observedValuation,now,true,true);
        const invoices=query.tab==='invoices'?buildFinanceReport(raw,{...canonical,tab:'invoices'},observedValuation,now,true,true):null;
        let fiscal=unavailableFiscalReport(canonical);
        const evidence:Record<string,unknown>[]=[];
        if (!raw.data.ledger.unavailable && this.readRate) {
          try { fiscal=await projectFiscalReport(raw.data,{...canonical,tab:'expenses'},this.readRate,now,e=>evidence.push(e),true,
            async(month,calculate)=>{
              const version=raw.periodVersions[month];
              if(!version?.revision)throw new FinanceCacheBypass();
              let computed:Awaited<ReturnType<typeof calculate>>|undefined;
              const saved=await readRetryableFinanceSnapshot(this.cache,{period:month,scope:`fiscal-period:${query.currency}:${month===query.month?'current':'trend'}:${version.clock}:${version.signature}`,
                dependencies:version.dependencies,expectedSourceRevision:version.revision,
                calculationVersion:'fiscal-period-v1',taxPolicyVersion:TAX_POLICY_VERSION,fxVersion:version.signature},
                async periodTx=>{
                  const source=await this.readSources(periodTx,{...canonical,month},financePeriod(month),financePeriod(month,1),'fiscal');
                  return {payments:source.data.payments,expenses:source.data.expenses,deferredSnapshots:source.deferredSnapshots};
                },async inputs=>{await this.publishDeferred(inputs.deferredSnapshots);computed=await calculate(inputs);return {payload:computed};},p=>p.missing.some(m=>['HISTORICAL_FX_UNAVAILABLE','FX_STORAGE_UNAVAILABLE','FX_LOOKUP_BUDGET_EXCEEDED'].includes(m.code)));
              if(!saved&&!computed)throw new FinanceCacheBypass();
              return saved?.payload??computed!;
            },true); }
          catch(error){if(error instanceof BadRequestException||error instanceof FinanceCacheBypass||error instanceof FinancePeriodCacheBusyError)throw error;evidence.length=0;}
        }
        // SQL-unavailable reads must be retried, not made into durable zeros.
        const retryableFx=fiscal.missing.some(m=>['HISTORICAL_FX_UNAVAILABLE','FX_STORAGE_UNAVAILABLE','FX_LOOKUP_BUDGET_EXCEEDED','FISCAL_UNAVAILABLE'].includes(m.code));
        const cacheable=(!this.readRate || !raw.data.ledger.unavailable);
        const receiptConfirmationCount=fiscal.current.incomplete?new Set(fiscal.rows.filter(r=>r.period===query.month&&r.source==='PENDING'&&r.status==='RECEIPT_CONFIRMATION_REQUIRED'&&r.paymentId).map(r=>r.paymentId)).size:0;
        const payload:Summary={...payments,receiptConfirmationCount,cacheRequiresCurrentFx:requiresCurrentFx,cacheRetryable:retryableFx,
          table:{...payments.table,rows:[],total:0},
          fiscal:{...fiscal,rows:[],expenseValues:[],expenseTable:{...fiscal.expenseTable,rows:[],total:0}}};
        return {payload,cacheable,rows:[
          ...prepareCacheRows('payments',cacheRows(payments.table.rows),'legacy'),
          ...prepareCacheRows('expenses',cacheRows(expenses.table.rows),'legacy'),
          ...prepareCacheRows('invoices',cacheRows(invoices?.table.rows??[]),'legacy'),
          ...prepareCacheRows('taxes',fiscal.rows,'tax'),
          ...prepareCacheRows('fiscalExpenses',fiscal.expenseTable.rows,'fiscalExpense'),
          ...fiscal.rows.map((value,index)=>({kind:'taxEvidence',id:String(index),payload:{value},ordinal:index})),
          ...fiscal.expenseValues.map((value,index)=>({kind:'expenseValues',id:String(index),payload:{value},ordinal:index})),
          ...evidence.map((value,index)=>({kind:'cashEvidence',id:String(index),payload:{value},ordinal:index})),
        ]};
      },p=>p.cacheRetryable===true).catch(error=>{if(error instanceof FinanceCacheBypass)return null;throw error;});
    if(!cached?.key)return null;
    const result:Summary=structuredClone(cached.payload);
    if(result.cacheRequiresCurrentFx){
      try{if(!valuation.cache)throw Error('Нет официального курса для конвертации отчёта');assertExchangeRateCacheFresh(valuation.cache,now);}
      catch(error){throw new ServiceUnavailableException((error as Error).message);}
    }
    delete result.cacheRequiresCurrentFx;
    delete result.cacheRetryable;
    const fiscal=result.fiscal;
    fiscal.taxScope={...fiscal.taxScope,requestedSource:query.source||'ALL'};
    if(!exportAll&&query.projection==='summary')return {...result,projection:'summary' as const,
      table:{...result.table,tab:query.tab,rows:[],total:0},options:{clients:[],categories:[],orders:[]},recentExpenses:[],upcoming:[],
      fiscal:{...fiscal,rows:[],expenseValues:[],recentExpenses:[],taxExpenseIds:[],expenseTable:{...fiscal.expenseTable,rows:[],total:0}}};
    // Detail queries read only the matching rows. Aggregate calculation is never
    // repeated for a table filter, sorting change or another page.
    const detailed=await this.prisma.$transaction(async tx=>{
      if(await this.cache.verifyRows(tx,cached.key!,cached)!==true)return null;
      const pageEvidence=!exportAll&&query.evidence==='page';
      const table=await readFinanceCacheRows(tx,cached.key!,query.tab,query,query.tab==='taxes'?'tax':'legacy',exportAll);
      const expenseTable=pageEvidence&&query.tab!=='expenses'?{tab:'expenses',rows:[],total:0,page:query.page,pageSize:query.pageSize}:await readFinanceCacheRows(tx,cached.key!,'fiscalExpenses',query,'fiscalExpense',exportAll&&query.tab==='expenses');
      const readValues=async<T>(kind:string,expenseIds?:string[])=>{
        const rows=await tx.$queryRawUnsafe<{payload:{value:T}}[]>(`SELECT payload FROM "FinanceReportCacheRow" WHERE "snapshotKey"=$1 AND kind=$2${expenseIds?' AND payload->\'value\'->>\'expenseId\'=ANY($3::text[])':''} ORDER BY ordinal`,cached.key,kind,...(expenseIds?[expenseIds]:[]));
        return rows.map(r=>r.payload.value);
      };
      // The web opts into bounded evidence. Omitted/full keeps the established
      // full-report contract; CSV always retains complete matching evidence.
      const expenseIds=[...new Set([...expenseTable.rows,...fiscal.recentExpenses,...result.recentExpenses].map(row=>String(row.id)))];
      fiscal.rows=pageEvidence?(query.tab==='taxes'?table.rows as FiscalReport['rows']:[]):await readValues<FiscalReport['rows'][number]>('taxEvidence');
      fiscal.expenseValues=await readValues<FiscalReport['expenseValues'][number]>('expenseValues',pageEvidence?expenseIds:undefined);
      if(pageEvidence){
        result.evidenceProjection='page';
        fiscal.taxExpenseIds=fiscal.taxExpenseIds.filter(id=>expenseIds.includes(id));
        fiscal.missing=[...new Map(fiscal.missing.map(m=>{const value={...m,rowId:null};return [JSON.stringify([m.code,m.month,m.currency,m.date]),value];})).values()];
      }
      fiscal.expenseTable=expenseTable as FiscalReport['expenseTable'];
      if(query.tab==='taxes'){
        if(exportAll)return appendFiscalCsv(fiscalTaxCsv(table.rows as FiscalReport['rows']),fiscal,await readValues<Record<string,unknown>>('cashEvidence'));
        return {...result,fiscal,table};
      }
      const full={...result,table};
      if(!exportAll)return full;
      const csv=financeReportCsv(full,query.tab,fiscal.expenseValues);
      return this.readRate?appendFiscalCsv(csv,fiscal,await readValues<Record<string,unknown>>('cashEvidence'),query.tab==='expenses'):csv;
    },{isolationLevel:'RepeatableRead',timeout:30000});
    if(detailed===null){
      await this.cache.expire(cached);
      if(repairAttempt===0)return this.report(query,exportAll,now,1);
    }
    return detailed;
  }
}
