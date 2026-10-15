import { parseSource } from './order-source-values.mjs';
import type { OrderSource, OrderSourceFilter, SourceAmount } from './order-source';
import type { FinanceInvoice } from '../components/invoice-editor';

export type DisplayCurrency = 'EUR' | 'USD' | 'UAH';
export type FinanceTab = 'payments' | 'expenses' | 'invoices';
export type FinanceFilters = {
  source?:OrderSourceFilter; month:string; currency:DisplayCurrency; range:number; tab:FinanceTab; page:number; pageSize:number;
  search:string; status:string; clientId:string; categoryId:string; orderId:string; from:string; to:string;
  sort:'date'|'number'|'client'|'amount'|'paid'|'balance'|'category'|'status'; direction:'asc'|'desc'; scope:'all'|'forecast';
};
export type PaymentRow = {orderSource?:OrderSource;id:string;orderId:string;number:string;clientId:string;clientName:string;date:string|null;amountMinor:number;paidMinor:number;balanceMinor:number;status:'UNPAID'|'PARTIAL'|'PAID';method:string|null;notes:string|null;originalCurrency:string;originalAmountMinor:number;originalPaidMinor:number;originalBalanceMinor:number;roundingDifferenceMinor:number;forecastDate:string|null;forecastSource:'deadline'|'production'|null};
export type ExpenseRow = {orderSource?:OrderSource;id:string;date:string;categoryId:string;categoryName:string;orderId:string|null;number:string|null;notes:string|null;amountMinor:number;originalAmountMinor:number;originalCurrency:string;shipmentId:string|null};
export type InvoiceRow = {orderSource?:OrderSource;id:string;orderId:string;number:string;orderNumber:string;clientId:string;clientName:string;date:string;dueDate:string|null;status:string;amountMinor:number;paidMinor:number|null;balanceMinor:number|null;originalCurrency:string;originalAmountMinor:number};
export type FinanceOrder = {id:string;number:string;archivedAt?:string|null;displayCurrency:string;priceMinor:number;depositRequiredMinor:number;currency:string;requiredDeliveryAt?:string;client:{displayName:string;country?:string;language?:string};payments:{id?:string;displayAmountMinor:number;amountMinor:number;currency:string;appliedAmountMinor?:number;appliedCurrency?:string;receivedAt?:string;method?:string;reference?:string;notes?:string}[];invoices:FinanceInvoice[]};
export type FinanceReport = {
 sourceAnalytics?:{websiteReceivedMinor:number;totalReceivedMinor:number;breakdown:SourceAmount[];trend:{month:string;breakdown:SourceAmount[]}[]};
  month:string;currency:DisplayCurrency;valuationVersion:string;valuation:{provider:string|null;effectiveDate:string|null;fetchedAt:string|null;officialUrl:string|null};today:string;forecastUntil:string;
  current:{receivedMinor:number;expensesMinor:number;resultMinor:number};previous:{receivedMinor:number;expensesMinor:number;resultMinor:number};
  debtMinor:number;forecastMinor:number;forecastCount:number;invoiceCount:number;invoiceTotalMinor:number;unpaidInvoiceCount:number;
  monthlyTrend:{month:string;receivedMinor:number;expensesMinor:number;resultMinor:number}[];
  categoryBreakdown:{id:string;name:string;amountMinor:number}[];recentExpenses:ExpenseRow[];upcoming:PaymentRow[];
  table:{tab:FinanceTab;rows:(PaymentRow|ExpenseRow|InvoiceRow)[];total:number;page:number;pageSize:number};
  options:{clients:{id:string;name:string}[];categories:{id:string;name:string;active?:boolean}[];orders:{id:string;number:string;clientName:string;currency:string}[]};
};
export function moveFinanceMonth(month:string, delta:number){const [year,value]=month.split('-').map(Number);const next=new Date(Date.UTC(year!,value!-1+delta,1));return `${next.getUTCFullYear()}-${String(next.getUTCMonth()+1).padStart(2,'0')}`;}
export function financeReportQuery(filters:FinanceFilters, valuationVersion?:string){const query=new URLSearchParams();for(const [key,value] of Object.entries(filters))if(value!==''&&value!==undefined)query.set(key,String(value));if(valuationVersion)query.set('valuationVersion',valuationVersion);return query;}
export const FINANCE_PAGE_SIZES = [10,25,50,100] as const;
export function patchFinanceFilters(current:FinanceFilters,next:Partial<FinanceFilters>):FinanceFilters{
  const result={...current,...next,page:next.page??1};
  if(next.tab&&next.tab!==current.tab){
    result.status='';
    if(next.tab==='expenses')result.clientId='';
    if(current.tab==='expenses')result.categoryId='';
  }
  return result;
}
export type FinanceMoneyField = 'amount'|'paid'|'balance';
export function originalMinor(row:PaymentRow|ExpenseRow|InvoiceRow,field:FinanceMoneyField='amount'):number|null{
  if(field==='amount')return row.originalAmountMinor;
  if('originalPaidMinor' in row)return field==='paid'?row.originalPaidMinor:row.originalBalanceMinor;
  if('status' in row&&row.status==='PAID')return field==='paid'?row.originalAmountMinor:0;
  return null;
}
export function moneyLabel(value:number|null|undefined,currency:string){
  if(value==null)return '—';
  if(!Number.isSafeInteger(value))throw new RangeError('Invalid integer minor amount');
  const minor=BigInt(value),whole=minor/100n,fraction=(minor<0n?-minor:minor)%100n;
  return new Intl.NumberFormat('ru-RU',{style:'currency',currency,currencyDisplay:'narrowSymbol',minimumFractionDigits:2,maximumFractionDigits:2})
    .formatToParts(minor<0n&&whole===0n?-0:whole).map(part=>part.type==='fraction'?fraction.toString().padStart(2,'0'):part.value).join('');
}
export function comparisonPercent(current:number,previous:number){return previous===0?(current===0?0:null):Math.round((current-previous)/Math.abs(previous)*100);}
export function financeDate(value:string|null|undefined){return value?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value)).replace(/\s?г\.$/,''):'—';}
export function financeMonth(value:string){return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}-01T12:00:00Z`)).replace(/\s?г\.$/,'').replace(/^./,letter=>letter.toUpperCase());}
export class FinanceRequestError extends Error { status:number; constructor(message:string,status:number){super(message);this.status=status;} }

/** Russian date entry must not fall back to the browser's US month/day parser. */
export function parseFinanceDateInput(value:string):string|null{
 const parts=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
 if(!parts)return null;
 const iso=`${parts[3]}-${parts[2]}-${parts[1]}`;
 const date=new Date(`${iso}T12:00:00Z`);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;
}

export function readFinanceRoute(base:FinanceFilters,query:string):FinanceFilters{
 const params=new URLSearchParams(query),result={...base,source:parseSource(params.get('source'))};
 const period=params.get('period');if(period&&/^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(period))result.month=period;
 const currency=params.get('currency');if(currency&&['EUR','USD','UAH'].includes(currency))result.currency=currency as DisplayCurrency;
 const tab=params.get('tab');if(tab&&['payments','expenses','invoices'].includes(tab))result.tab=tab as FinanceTab;
 for(const key of ['search','status','clientId','categoryId','orderId','from','to'] as const)result[key]=params.get(key)||'';
 const page=Number(params.get('page'));if(Number.isSafeInteger(page)&&page>0&&page<=100000)result.page=page;
 const size=Number(params.get('pageSize'));if(FINANCE_PAGE_SIZES.includes(size as 10))result.pageSize=size;
 const range=Number(params.get('range'));if([3,6,12].includes(range))result.range=range;
 const sort=params.get('sort');if(sort&&['date','number','client','amount','paid','balance','category','status'].includes(sort))result.sort=sort as FinanceFilters['sort'];
 result.direction=params.get('direction')==='asc'?'asc':'desc';result.scope=params.get('scope')==='forecast'?'forecast':'all';
 return result;
}
export function writeFinanceRoute(filters:FinanceFilters,url:URL){
 for(const [key,value] of Object.entries(filters)){const name=key==='month'?'period':key;if(value===''||value===undefined)url.searchParams.delete(name);else url.searchParams.set(name,String(value));}
 return `${url.pathname}${url.search}${url.hash}`;
}
