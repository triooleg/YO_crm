export const ACCOUNTING_START = '2026-05-01';
export const COMPONENTS = ['UNIFIED', 'MILITARY', 'ESV'] as const;
export type Component = typeof COMPONENTS[number];
export type Rational = { numerator: string; denominator: string };
export function safeMinor(value: bigint): number {
 const n=Number(value); if(!Number.isSafeInteger(n)) throw new Error('Сумма выходит за безопасный диапазон'); return n;
}
export function integer(value:number,allowNegative=false):number {
 if(!Number.isSafeInteger(value)||(!allowNegative&&value<0))throw new Error('Ожидается сумма в целых копейках');return value;
}
export function roundRatio(n:bigint,d:bigint):bigint {
 if(d<=0n)throw new Error('Неверный знаменатель');return n<0n?-((-n+d/2n)/d):(n+d/2n)/d;
}
export function convertMinor(amount:number,rate:Rational):number {
 integer(amount,true);const n=BigInt(rate.numerator),d=BigInt(rate.denominator);if(n<=0n||d<=0n)throw new Error('Неверный курс');return safeMinor(roundRatio(BigInt(amount)*n,d));
}
export function percentMinor(base:number,bps:number):number {
 integer(base,true);integer(bps);if(bps>10000)throw new Error('Ставка больше100%');return safeMinor(roundRatio(BigInt(base)*BigInt(bps),10000n));
}
export function dateOnly(value:string):string {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new Error('Неверная дата');return value;
}
export function monthKey(value:string):string {if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw new Error('Неверный месяц');return value;}
export function kyivDate(value:Date|string):string {
 const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new Error('Неверная дата');
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
 return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');
}
export function monthsBetween(from:string,to:string):string[] {
 monthKey(from);monthKey(to);if(to<from||Number(to.slice(0,4))-Number(from.slice(0,4))>20)throw new Error('Неверный интервал');
 const result:string[]=[];let current=from;while(current<=to){result.push(current);const d=new Date(current+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);current=d.toISOString().slice(0,7);}return result;
}
export type Wage={version:string;from:string;to:string;minor:number;source:string;verifiedAt:string};
export const WAGE_CATALOG:readonly Wage[]=[{version:'UA-MIN-WAGE-2026-v1',from:'2026-01-01',to:'2027-01-01',minor:864700,source:'https://tax.gov.ua/media-tsentr/novini/999526.html',verifiedAt:'2026-10-19'}];
export function wageFor(date:string):Wage|null {dateOnly(date);return WAGE_CATALOG.find(w=>w.from<=date&&date<w.to)??null;}
export type PolicyRules={group:2|3;unifiedMode:'PERCENT'|'FIXED';unifiedRateBps:number;fixedUnifiedMinor:number|null;fixedUnifiedWageRateBps?:number|null;militaryRateBps:number;esvRateBps:number};
export function monthlyAmount(component:Component,month:string,policy:PolicyRules):{amountMinor:number|null;basis:unknown} {
 monthKey(month);const wage=wageFor(month+'-01');const january=wageFor(month.slice(0,4)+'-01-01');
 if(component==='ESV')return {amountMinor:wage?percentMinor(wage.minor,policy.esvRateBps):null,basis:{wage,formula:'monthly minimum wage * esvRateBps /10000'}};
 if(component==='UNIFIED'&&policy.fixedUnifiedWageRateBps!=null){
  const bps=policy.fixedUnifiedWageRateBps;
  const valid=policy.group===2&&policy.unifiedMode==='FIXED'&&policy.unifiedRateBps===0&&policy.fixedUnifiedMinor==null&&Number.isSafeInteger(bps)&&bps>=1&&bps<=2000;
  return {amountMinor:valid&&january?percentMinor(january.minor,bps):null,basis:{wage:january,fixedUnifiedWageRateBps:bps,formula:'January1 minimum wage * fixedUnifiedWageRateBps /10000'}};
 }
 if(component==='UNIFIED')return {amountMinor:policy.unifiedMode==='FIXED'&&january&&policy.fixedUnifiedMinor!==null&&policy.fixedUnifiedMinor<=percentMinor(january.minor,2000)?policy.fixedUnifiedMinor:null,basis:{wage:january,formula:'confirmed fixed monthly UAH; <=20% January minimum wage'}};
 return {amountMinor:policy.group===2&&january?percentMinor(january.minor,policy.militaryRateBps):null,basis:{wage:january,formula:'January1 minimum wage * militaryRateBps /10000'}};
}
export function decimalRational(value:string):Rational {
 if(!/^\d+(\.\d{1,12})?$/.test(value))throw new Error('Неверный десятичный курс');const [whole,fraction='']=value.split('.');const numerator=BigInt(whole!+fraction),denominator=10n**BigInt(fraction.length);if(numerator<=0n)throw new Error('Курс должен быть положительным');return {numerator:String(numerator),denominator:String(denominator)};
}
