import type { SalesQuery, SalesGroup, SalesCurrency, SalesMetric, SalesMonth, SalesDrillRow } from './sales-statistics-types';

export function salesRecordTarget(row:Pick<SalesDrillRow,'orderId'|'clientId'|'orderArchived'>,canOpenRecords:boolean){
  if(!canOpenRecords)return null;
  if(row.orderId&&!row.orderArchived)return {section:'orders' as const,id:row.orderId};
  if(row.clientId)return {section:'clients' as const,id:row.clientId};
  return null;
}

const urlKeys: Record<keyof SalesQuery,string> = {
  from:'from',to:'to',currency:'currency',source:'source',status:'status',clientId:'clientId',country:'country',orderType:'orderType',discipline:'discipline',
  tab:'statTab',months:'statMonths',metric:'statMetric',customerMetric:'statCustomerMetric',revenueMetric:'statRevenueMetric',ranking:'statRanking',scope:'statScope',repeat:'statRepeat',drill:'statDrill',page:'statPage',pageSize:'statPageSize',sort:'statSort',direction:'statDirection',
};
function iso(date:Date){return date.toISOString().slice(0,10)}
function validDate(value:string|null):value is string{return !!value&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2000-01-01'&&value<='2100-12-31'&&!Number.isNaN(Date.parse(value))&&iso(new Date(value))===value}
function pick<T extends string>(value:string|null,allowed:readonly T[],fallback:T):T{return allowed.includes(value as T)?value as T:fallback}
function integer(value:string|null,fallback:number,max:number){const n=Number(value);return value&&Number.isSafeInteger(n)&&n>0?Math.min(n,max):fallback}
export function parseSalesSelection(search:string,now=new Date()):SalesQuery{
  const params=new URLSearchParams(search.startsWith('?')?search.slice(1):search);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit'}).formatToParts(now);
  const year=Number(parts.find(p=>p.type==='year')!.value),month=Number(parts.find(p=>p.type==='month')!.value);
  const defaultFrom=iso(new Date(Date.UTC(year,month-12,1))),defaultTo=iso(new Date(Date.UTC(year,month,0)));
  let from=validDate(params.get('from'))?params.get('from')!:defaultFrom,to=validDate(params.get('to'))?params.get('to')!:defaultTo;
  if(from>to){from=defaultFrom;to=defaultTo}
  const text=(key:string)=>(params.get(key)||'').slice(0,200);
  return {from,to,currency:pick(params.get('currency'),['EUR','USD','UAH'],'EUR'),source:text('source'),status:text('status'),clientId:text('clientId'),country:text('country'),orderType:text('orderType'),discipline:text('discipline'),
    tab:pick(params.get('statTab'),['countries','sources','clients','sports','types'],'countries'),months:Number(pick(params.get('statMonths'),['3','6','12'],'6')) as 3|6|12,
    metric:pick(params.get('statMetric'),['orders','pieces','amount'],'orders'),customerMetric:pick(params.get('statCustomerMetric'),['clients','orders'],'clients'),revenueMetric:pick(params.get('statRevenueMetric'),['orders','payments'],'orders'),ranking:pick(params.get('statRanking'),['amount','received','orders','pieces'],'amount'),scope:pick(params.get('statScope'),['sales','all'],'sales'),repeat:pick(params.get('statRepeat'),['','new','repeat','new-client','returning-client'],''),drill:pick(params.get('statDrill'),['','orders','pieces','countries','clients','payments'],''),page:integer(params.get('statPage'),1,100000),pageSize:Number(pick(params.get('statPageSize'),['10','25','50','100'],'25')),sort:pick(params.get('statSort'),['label','orders','pieces','amount','received','average','clients'],'orders'),direction:pick(params.get('statDirection'),['asc','desc'],'desc')};
}
/** Map URL names explicitly: backend accepts only the shared SalesQueryInput names. */
export function salesApiQuery(query:SalesQuery,valuationVersion?:string){
  const params=new URLSearchParams();
  for(const key of Object.keys(urlKeys) as (keyof SalesQuery)[]){const value=query[key];if(value!=='')params.set(key,String(value))}
  if(valuationVersion)params.set('valuationVersion',valuationVersion);
  return params;
}
export function salesUrl(href:string,query:SalesQuery){
  const url=new URL(href,'https://crm.local');url.searchParams.set('section','overview');url.searchParams.set('view','statistics');
  for(const key of Object.keys(urlKeys) as (keyof SalesQuery)[]){const value=query[key];if(value==='')url.searchParams.delete(urlKeys[key]);else url.searchParams.set(urlKeys[key],String(value))}
  return `${url.pathname}${url.search}${url.hash}`;
}
function moveDate(value:string,months:number,end:boolean){const date=new Date(`${value}T00:00:00Z`),day=date.getUTCDate();const oldEnd=day===new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();const target=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+months,1)),last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(end&&oldEnd?last:Math.min(day,last));return iso(target)}
export function shiftSalesPeriod(query:Pick<SalesQuery,'from'|'to'>,direction:1|-1){const from=new Date(query.from),to=new Date(query.to),span=(to.getUTCFullYear()-from.getUTCFullYear())*12+to.getUTCMonth()-from.getUTCMonth()+1;return {from:moveDate(query.from,span*direction,false),to:moveDate(query.to,span*direction,true)}}
export function salesMoney(value:number|null|undefined,currency:SalesCurrency){return value==null?'—':new Intl.NumberFormat('ru-RU',{style:'currency',currency,maximumFractionDigits:2}).format(value/100)}
export function salesCount(value:number|null|undefined){return value==null?'—':new Intl.NumberFormat('ru-RU').format(value)}
export function salesComparison(current:number|null|undefined,previous:number|null|undefined){
  if(current==null||previous==null||previous===0)return null;
  return Math.round((current-previous)/previous*100)||0;
}
export function salesGroupValue(group:SalesGroup,metric:SalesMetric){return metric==='amount'?group.amountMinor:group[metric]}
export function salesExportFilename(query:Pick<SalesQuery,'from'|'to'|'currency'>){return `sales-statistics_${query.from}_${query.to}_${query.currency}.csv`.replace(/[^a-zA-Z0-9_.-]/g,'_')}
export function salesMonthRange(month:string,query:Pick<SalesQuery,'from'|'to'>){const start=`${month}-01`,date=new Date(`${start}T00:00:00Z`),end=iso(new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)));return {from:start<query.from?query.from:start,to:end>query.to?query.to:end}}
/** The complementary predicate pins the original period's top five, not each month's top five. */
export function salesCountrySeries(groups:SalesGroup[],months:SalesMonth[],metric:SalesMetric){
  const ranked=[...groups].sort((a,b)=>b.orders-a.orders||a.key.localeCompare(b.key)),top=ranked.slice(0,5),keys=new Set(top.map(g=>g.key));
  const series=top.map(group=>({key:group.key,values:months.map(month=>{const row=month.countries.find(g=>g.key===group.key);return row?salesGroupValue(row,metric):0})}));
  if(ranked.length>5)series.push({key:`OTHERS:${top.map(g=>g.key).join(',')}`,values:months.map(month=>{const values=month.countries.filter(g=>!keys.has(g.key)).map(g=>salesGroupValue(g,metric));return values.some(v=>v===null)?null:values.reduce<number>((total,v)=>total+v!,0)})});
  return series;
}

/** Cash-only groups remain in the DTO for receipts; sales tables use their order cohort. */
export function salesTableGroups<T extends Pick<SalesGroup,'orders'|'receiptCount'>>(groups:T[], includeReceipts:boolean){
  return groups.filter(group=>group.orders>0 || (includeReceipts && (group.receiptCount??0)>0));
}
/** An unallocated overhead is normal bookkeeping, not a corrupt business record. */
export function salesWarningTone(code:string):'blue'|'orange'{
  return code==='UNALLOCATED_EXPENSES_INCLUDED'||code==='UNALLOCATED_EXPENSES_EXCLUDED'?'blue':'orange';
}
