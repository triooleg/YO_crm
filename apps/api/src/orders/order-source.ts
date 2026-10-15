import {BadRequestException} from '@nestjs/common';
import type {Prisma} from '@prisma/client';

export const ORDER_SOURCES=['WEBSITE','MANUAL','INSTAGRAM','OTHER','UNKNOWN'] as const;
export type OrderSource=typeof ORDER_SOURCES[number];
export type OrderSourceFilter=OrderSource|'NON_WEBSITE'|'';
type Evidence={type:string;metadata?:unknown};
type OriginRecord={sourceSystem?:string|null;sourceAccount?:string|null;sourceLinkMode?:string|null;externalId?:string|null;externalData?:unknown;activities?:Evidence[]};
// Owner-confirmed on 2026-10-15. This is a nonsecret import account identity, not an API token.
export const CONFIRMED_WEBSITE_SOURCE={account:'f8bb8fb0-fcc8-4a25-b1c3-afe699b27e3d',sourceId:'12',name:'Вебсайт'} as const;
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** Order provenance only. Never inspect client channels, payment methods or fulfilment type. */
export function classifyOrderSource(order:OriginRecord):OrderSource {
 if(order.sourceSystem==='KEYCRM'&&order.externalId&&order.sourceAccount){
  if(order.activities?.some(event=>event.type==='ORDER_CREATED')||order.sourceLinkMode==='MATCHED_EXISTING'||(order.activities?.length??0)>100)return 'UNKNOWN';
  const events=order.activities?.filter(event=>['KEYCRM_ORDER_IMPORTED','KEYCRM_ORDER_SYNCED'].includes(event.type))??[];
  if(!events.length||events.some(event=>String(object(event.metadata).keycrmOrderId??'')!==order.externalId))return 'UNKNOWN';
  const names=events.map(event=>object(event.metadata).sourceName);
  if(names.some(name=>typeof name!=='string'||!name.trim()))return 'UNKNOWN';
  const normalized=(names as string[]).map(name=>name.trim().toLocaleLowerCase('en'));
  if(new Set(normalized).size!==1)return 'UNKNOWN';
  const name=normalized[0]!;
  if(/^(?:https?:\/\/)?(?:www\.)?yoleotard\.com(?:\/[^\s]*)?$/i.test(name))return 'WEBSITE';
  if(order.sourceAccount===CONFIRMED_WEBSITE_SOURCE.account&&String(object(order.externalData).source_id??'')===CONFIRMED_WEBSITE_SOURCE.sourceId&&name===CONFIRMED_WEBSITE_SOURCE.name.toLocaleLowerCase('en'))return 'WEBSITE';
  if(/^(?:instagram|инстаграм)$/.test(name))return 'INSTAGRAM';
  if(/^(?:manual|crm|ручной(?: заказ)?|вручную)$/.test(name))return 'MANUAL';
  if(['facebook','whatsapp','viber','telegram','gmail','chat keycrm','chatway','chatwoot'].includes(name))return 'OTHER';
  return 'UNKNOWN';
 }
 if(!order.sourceSystem&&!order.sourceAccount&&!order.externalId&&order.activities?.some(event=>event.type==='ORDER_CREATED'))return 'MANUAL';
 return 'UNKNOWN';
}
export function normalizeOrderSourceFilter(value?:string):OrderSourceFilter {
 if(value===undefined||value===''||value==='ALL')return '';
 if(value==='NON_WEBSITE'||ORDER_SOURCES.includes(value as OrderSource))return value as OrderSourceFilter;
 throw new BadRequestException('Некорректный источник заказа');
}
export function matchesOrderSource(source:OrderSource,filter:OrderSourceFilter){return !filter||(filter==='NON_WEBSITE'?source!=='WEBSITE':source===filter);}

export const orderOriginSelect={id:true,sourceSystem:true,sourceAccount:true,sourceLinkMode:true,externalId:true,externalData:true,activities:{where:{type:{in:['KEYCRM_ORDER_IMPORTED','KEYCRM_ORDER_SYNCED','ORDER_CREATED']}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:101,select:{type:true,metadata:true}}} satisfies Prisma.OrderSelect;

/** Narrow server-only projection. Provider payloads/names never enter public read DTOs. */
export async function loadOrderSourceMap(db:Pick<Prisma.TransactionClient,'order'>,ids?:string[]) {
 const result:Record<string,OrderSource>={};let cursor:string|undefined;
 if(ids?.length===0)return result;
 for(;;){
  const rows=await db.order.findMany({where:ids?{id:{in:ids}}:{},select:orderOriginSelect,orderBy:{id:'asc'},take:500,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  for(const row of rows)result[row.id]=classifyOrderSource(row);
  if(rows.length<500)return result;cursor=rows[rows.length-1]!.id;
 }
}

export function countOrderSources(rows:{id:string;createdAt:Date}[],origins:Record<string,OrderSource>,from:Date,to:Date) {
 const unique=[...new Map(rows.map(row=>[row.id,row])).values()].filter(row=>row.createdAt>=from&&row.createdAt<to);
 return ORDER_SOURCES.map(source=>({source,count:unique.filter(row=>(origins[row.id]??'UNKNOWN')===source).length}));
}
