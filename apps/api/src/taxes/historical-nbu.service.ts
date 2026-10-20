import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { randomUUID } from 'node:crypto';
import { HistoricalNbuCache, storageUnavailable, type NbuCacheRow } from './historical-nbu-cache';
import { decimalRational, dateOnly, type Rational } from './tax-math';
export type HistoricalRate=Rational&{provider:'NBU';currency:string;incomeDate:string;effectiveDate:string;url:string;fetchedAt:string;raw:string};
export function parseHistoricalRate(raw:string,currency:string,incomeDate:string,url:string):HistoricalRate {
 const data=strictNbuJson(raw);if(!Array.isArray(data)||data.length!==1)throw new Error('Неполный ответ НБУ');const row=data[0] as {cc:string;exchangedate:string};
 if(row.cc!==currency||typeof row.exchangedate!=='string'||row.exchangedate.split('.').reverse().join('-')!==incomeDate)throw new Error('Дата или валюта НБУ не совпадает');
 // Keep the exact decimal lexeme; parsing into Number first loses rational evidence.
 const matches=[...raw.matchAll(/"rate"\s*:\s*(\d+(?:\.\d+)?)(?=\s*[,}])/g)];if(matches.length!==1)throw new Error('Неоднозначный курс НБУ');
 return {...decimalRational(matches[0]![1]!),provider:'NBU',currency,incomeDate,effectiveDate:incomeDate,url,fetchedAt:new Date().toISOString(),raw};
}
export type FxEvidenceCode='FX_EVIDENCE_INVALID'|'FX_EVIDENCE_CONFLICT';
function evidenceError(code:FxEvidenceCode){return Object.assign(new ServiceUnavailableException('Исторический курс НБУ недоступен. Источник остаётся на сверке'),{code});}
function storedRate(row:NbuCacheRow,currency:string,incomeDate:string,url:string):HistoricalRate {
 if(row.currency!==currency||row.incomeDate!==incomeDate||row.effectiveDate!==incomeDate)throw evidenceError('FX_EVIDENCE_CONFLICT');
 if(row.provider!=='NBU'||row.url!==url||typeof row.raw!=='string'||typeof row.numerator!=='string'||typeof row.denominator!=='string'||!/^0*[1-9]\d*$/.test(row.numerator)||!/^0*[1-9]\d*$/.test(row.denominator))throw evidenceError('FX_EVIDENCE_INVALID');
 let parsed:HistoricalRate;
 try {parsed=parseHistoricalRate(row.raw,currency,incomeDate,url);}catch{throw evidenceError('FX_EVIDENCE_INVALID');}
 if(parsed.numerator!==row.numerator||parsed.denominator!==row.denominator)throw evidenceError('FX_EVIDENCE_CONFLICT');
 if(row.fetchedAt instanceof Date&&!Number.isFinite(row.fetchedAt.getTime()))throw evidenceError('FX_EVIDENCE_INVALID');
 const fetchedAt=row.fetchedAt instanceof Date?row.fetchedAt.toISOString():row.fetchedAt;
 if(typeof fetchedAt!=='string'||!Number.isFinite(Date.parse(fetchedAt))||new Date(fetchedAt).toISOString()!==fetchedAt||Date.parse(fetchedAt)>Date.now()+60000)throw evidenceError('FX_EVIDENCE_INVALID');
 return {...parsed,fetchedAt};
}
@Injectable()
export class HistoricalNbuService {
 private readonly inflight=new Map<string,Promise<HistoricalRate>>();
 constructor(@Optional() @Inject(PrismaService) private readonly prisma?:PrismaService){}
 async rate(currency:string,incomeDate:string):Promise<HistoricalRate>{
  dateOnly(incomeDate);if(!/^[A-Z]{3}$/.test(currency))throw new ServiceUnavailableException('Неверная валюта источника');
  if(currency==='UAH')return {numerator:'1',denominator:'1',provider:'NBU',currency,incomeDate,effectiveDate:incomeDate,url:'UAH',fetchedAt:new Date().toISOString(),raw:'UAH=1'};
  const key=currency+':'+incomeDate,existing=this.inflight.get(key);if(existing)return existing;
  const lookup=this.resolve(currency,incomeDate).catch(error=>{
   if(['FX_EVIDENCE_INVALID','FX_EVIDENCE_CONFLICT','FX_STORAGE_UNAVAILABLE'].includes((error as {code?:string})?.code??''))throw error;
   throw new ServiceUnavailableException('Исторический курс НБУ недоступен. Источник остаётся на сверке');
  });
  this.inflight.set(key,lookup);
  try {return await lookup;}finally{if(this.inflight.get(key)===lookup)this.inflight.delete(key);}

 }
 private async resolve(currency:string,incomeDate:string):Promise<HistoricalRate>{
  if(!this.prisma)throw storageUnavailable();
  const cache=new HistoricalNbuCache(this.prisma),url=`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${currency}&date=${incomeDate.replaceAll('-','')}&json`;
  const stored=await cache.read(currency,incomeDate);
  if(stored?.status==='READY')return storedRate(stored,currency,incomeDate,url);
  const token=randomUUID(),claimed=await cache.claim(currency,incomeDate,token);
  if(!claimed){const winner=await cache.read(currency,incomeDate);if(winner?.status==='READY')return storedRate(winner,currency,incomeDate,url);throw new Error('LOOKUP_NOT_DUE_OR_BUSY');}
  let rate:HistoricalRate;
  try {
   const response=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)throw new Error('NBU_UNAVAILABLE');
   const raw=await response.text();if(raw.length>32000)throw new Error('NBU_RESPONSE_TOO_LARGE');rate=parseHistoricalRate(raw,currency,incomeDate,url);
  }catch{
   await cache.fail(currency,incomeDate,token);
   const winner=await cache.read(currency,incomeDate);if(winner?.status==='READY')return storedRate(winner,currency,incomeDate,url);
   throw new Error('NBU_UNAVAILABLE');
  }
  const winner=await cache.save(currency,incomeDate,token,rate)??await cache.read(currency,incomeDate);
  if(winner?.status!=='READY')throw new Error('LOOKUP_LEASE_LOST');
  const persisted=storedRate(winner,currency,incomeDate,url);
  if(BigInt(rate.numerator)*BigInt(persisted.denominator)!==BigInt(persisted.numerator)*BigInt(rate.denominator))throw evidenceError('FX_EVIDENCE_CONFLICT');
  return persisted;
 }
}

// Reject duplicate evidence keys, excessive depth and oversized response before valuation.
export function strictNbuJson(raw:string):unknown {
 if(raw.length>32000)throw new Error('Ответ НБУ слишком велик');
 let i=0;
 const ws=()=>{while(/\s/.test(raw[i]??'')&&i<raw.length)i++;};
 const str=():string=>{const start=i++;while(i<raw.length){if(raw[i]==='\\'){i+=2;continue;}if(raw[i++]==='"')return JSON.parse(raw.slice(start,i));}throw new Error('Незавершённая строка');};
 const walk=(depth:number):void=>{
  if(depth>16)throw new Error('Глубокий JSON');ws();
  if(raw[i]==='{'){i++;ws();const keys=new Set<string>();if(raw[i]==='}'){i++;return;}while(i<raw.length){ws();if(raw[i]!=='"')throw new Error('Ключ JSON');const k=str();if(keys.has(k))throw new Error('Повторный ключ JSON');keys.add(k);ws();if(raw[i++]!==':')throw new Error('JSON');walk(depth+1);ws();const c=raw[i++];if(c==='}')return;if(c!==',')throw new Error('JSON');}throw new Error('JSON');}
  if(raw[i]==='['){i++;ws();if(raw[i]===']'){i++;return;}while(i<raw.length){walk(depth+1);ws();const c=raw[i++];if(c===']')return;if(c!==',')throw new Error('JSON');}throw new Error('JSON');}
  if(raw[i]==='"'){str();return;}
  const m=/^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(raw.slice(i));if(!m)throw new Error('JSON');i+=m[0].length;
 };walk(0);ws();if(i!==raw.length)throw new Error('JSON');return JSON.parse(raw);
}
