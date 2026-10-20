import type { Prisma } from '@prisma/client';

export const WEBSITE_CHECKOUT_SYSTEM='YOLEOTARD_WEBSITE';
export type WebsiteCheckoutIdentity={sourceAccount:string;externalId:string};
export type WebsiteCheckoutSource={connectionKey:string;orderedAt:Date;raw:unknown};
type Db=Pick<Prisma.TransactionClient,'order'|'keycrmSyncIssue'>;
type RecordValue=Record<string,unknown>;
export type WebsiteCheckoutCohort={connectionKey:string;sourceId:string;sourceAccount:string;effectiveFrom:string};

export class WebsiteCheckoutCorrelationError extends Error {
 constructor(){super('Некорректная идентичность заказа сайта');}
}

/** Proposed sender contract, not evidence that Checkout already transmits this marker. */
export function websiteCheckoutMarker(sourceAccount:string,externalId:string):string {
 const account=sourceAccount.trim().toLowerCase();
 if(account.length>253||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(account)||!/^[1-9][0-9]{0,19}$/.test(externalId))throw new WebsiteCheckoutCorrelationError();
 return `yo-checkout:v1:${account}:${externalId}`;
}

export function parseWebsiteCheckoutMarker(value:unknown):WebsiteCheckoutIdentity|null {
 if(value==null||typeof value==='number'&&Number.isSafeInteger(value))return null;
 if(typeof value!=='string')throw new WebsiteCheckoutCorrelationError();
 if(!/^yo-checkout(?::|$)/i.test(value.trim()))return null;
 const match=/^yo-checkout:v1:([^:]+):([^:]+)$/.exec(value);
 if(!match||websiteCheckoutMarker(match[1]!,match[2]!)!==value)throw new WebsiteCheckoutCorrelationError();
 return {sourceAccount:match[1]!,externalId:match[2]!};
}

/** Bounded flat JSON schema; reject duplicate keys instead of JSON.parse's last-key-wins. */
export function parseWebsiteOrdersKeycrmSourceMap(text:string|undefined):WebsiteCheckoutCohort[] {
 if(text===undefined||/^[ \t\r\n]*$/.test(text))return [];
 if(Buffer.byteLength(text)>16384)throw new Error('Invalid website source map');
 let pos=0;const invalid=():never=>{throw new Error('Invalid website source map');};
 const whitespace=()=>{while(/[ \t\r\n]/.test(text[pos]??'')&&pos<text.length)pos++;};
 const take=(char:string)=>{whitespace();if(text[pos]!==char)return false;pos++;return true;};
 const expect=(char:string)=>{if(!take(char))invalid();};
 const string=():string=>{whitespace();const start=pos;if(text[pos++]!=='"')return invalid();while(pos<text.length){if(text[pos]==='\\'){pos+=2;continue;}if(text[pos++]==='"')return JSON.parse(text.slice(start,pos)) as string;}return invalid();};
 const values:RecordValue[]=[];expect('[');
 if(!take(']'))for(;;){
  if(values.length>=64)invalid();expect('{');const row:RecordValue=Object.create(null);
  if(!take('}'))for(;;){
   const key=string();if(!['connectionKey','sourceId','sourceAccount','effectiveFrom'].includes(key)||Object.hasOwn(row,key))invalid();expect(':');whitespace();
   if(text[pos]==='"')row[key]=string();else{const number=/^[1-9][0-9]*/.exec(text.slice(pos));if(!number)return invalid();pos+=number[0].length;row[key]=Number(number[0]);}
   if(take('}'))break;expect(',');
  }
  values.push(row);if(take(']'))break;expect(',');
 }
 whitespace();if(pos!==text.length)invalid();const seen=new Set<string>();
 return values.map(row=>{
  if(Object.keys(row).length!==4||typeof row.connectionKey!=='string'||!row.connectionKey||row.connectionKey.length>200||row.connectionKey.trim()!==row.connectionKey||/[\x00-\x1f]/.test(row.connectionKey)||typeof row.sourceAccount!=='string'||typeof row.effectiveFrom!=='string')return invalid();
  const sourceId=typeof row.sourceId==='number'&&Number.isSafeInteger(row.sourceId)?String(row.sourceId):row.sourceId;
  if(typeof sourceId!=='string'||!/^[1-9][0-9]{0,19}$/.test(sourceId))return invalid();
  const sourceAccount=websiteCheckoutMarker(row.sourceAccount,'1').split(':')[2]!;
  const date=row.effectiveFrom,calendar=new Date(date.slice(0,10)+'T00:00:00Z');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(date)||!Number.isFinite(Date.parse(date))||!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==date.slice(0,10)||Number(date.slice(11,13))>23||Number(date.slice(14,16))>59||Number(date.slice(17,19))>59)return invalid();
  const key=JSON.stringify([row.connectionKey,sourceId]);if(seen.has(key))return invalid();seen.add(key);
  return {connectionKey:row.connectionKey,sourceId,sourceAccount,effectiveFrom:new Date(date).toISOString()};
 });
}

/** Fast preflight only for the legacy out-of-transaction image download. */
export function websiteCheckoutReviewMayApply(input:WebsiteCheckoutSource,sourceMapText=process.env.WEBSITE_ORDERS_KEYCRM_SOURCE_MAP):boolean {
 try{if(parseWebsiteOrdersKeycrmSourceMap(sourceMapText).length)return true;}catch{return true;}
 const raw=input.raw&&typeof input.raw==='object'&&!Array.isArray(input.raw)?input.raw as RecordValue:{};
 try{return parseWebsiteCheckoutMarker(raw.source_uuid)!==null;}catch{return true;}
}

/** APPLY holds client-merge-global. No provider calls, adoption, or financial writes. */
export async function rejectWebsiteCheckoutCorrelation(db:Db,input:WebsiteCheckoutSource,runId:string,externalOrderId:string,sourceMapText=process.env.WEBSITE_ORDERS_KEYCRM_SOURCE_MAP):Promise<boolean> {
 const raw=input.raw&&typeof input.raw==='object'&&!Array.isArray(input.raw)?input.raw as RecordValue:{};
 let identity:WebsiteCheckoutIdentity|null=null;
 const hold=async(code:string,canonicalOrderId:string|null=null)=>{
  // Do not let a Prisma failure echo the stored raw payload through processStep's error message.
  try{await db.keycrmSyncIssue.create({data:{runId,externalOrderId,code,message:'Заказ KeyCRM удержан для канонического заказа сайта. Автоматическое создание и изменение заказа и оплат запрещено; требуется проверка источника.',details:JSON.parse(JSON.stringify({kind:'WEBSITE_CHECKOUT_HOLD',version:1,canonicalOrderId,websiteIdentity:identity??null,connectionKey:input.connectionKey,orderedAt:input.orderedAt.toISOString(),keycrmPayload:raw})) as Prisma.InputJsonValue}});}catch{throw new Error('Не удалось сохранить закрытую сверку источника заказа сайта');}
  return true;
 };
 let cohorts:WebsiteCheckoutCohort[];
 try{cohorts=parseWebsiteOrdersKeycrmSourceMap(sourceMapText);}catch{return hold('WEBSITE_CHECKOUT_CONFIG_INVALID');}
 const sourceId=typeof raw.source_id==='string'||typeof raw.source_id==='number'?String(raw.source_id):null;
 if(raw.source_id!=null&&(!sourceId||!/^[1-9][0-9]{0,19}$/.test(sourceId))&&cohorts.some(row=>row.connectionKey===input.connectionKey&&input.orderedAt>=new Date(row.effectiveFrom)))return hold('WEBSITE_CHECKOUT_SOURCE_MISMATCH');
 const cohort=cohorts.find(row=>row.connectionKey===input.connectionKey&&row.sourceId===sourceId&&input.orderedAt>=new Date(row.effectiveFrom));
 try{identity=parseWebsiteCheckoutMarker(raw.source_uuid);}catch{return hold('WEBSITE_CHECKOUT_MARKER_INVALID');}
 if(!identity)return cohort?hold('WEBSITE_CHECKOUT_MARKER_REQUIRED'):false;
 if(cohort&&cohort.sourceAccount!==identity.sourceAccount)return hold('WEBSITE_CHECKOUT_SOURCE_MISMATCH');
 const matches=await db.order.findMany({where:{sourceSystem:WEBSITE_CHECKOUT_SYSTEM,...identity},select:{id:true},take:2});
 if(matches.length>1)return hold('WEBSITE_CHECKOUT_AMBIGUOUS');
 return matches[0]?hold('WEBSITE_CHECKOUT_DUPLICATE',matches[0].id):hold('WEBSITE_CHECKOUT_AWAITING_DIRECT');
}
