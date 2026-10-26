import type { Prisma } from '@prisma/client';
import { isIP } from 'node:net';
import { websiteCheckoutMarker } from '../keycrm/website-checkout-correlation';
import { WebsiteOrderError } from './website-orders-errors';

type Json=Prisma.InputJsonValue;
type RecordValue=Record<string,unknown>;
export type WebsiteOrder={
 raw:Json;sourceAccount:string;
 order:{externalId:string;externalNumber?:string;orderedAt:string;updatedAt?:string;checkoutMode:'card'|'bank_invoice';paymentStatus:'paid'|'unpaid';currency:string;notes?:string;sourceUrl?:string};
 customer:{fullName:string;email?:string;phone?:string;country?:string;city?:string;addressLine1?:string;addressLine2?:string;postalCode?:string};
 delivery:{amountMinor:number;serviceName?:string;addressText?:string};
 totals:{itemsMinor:number;discountMinor:number;deliveryMinor:number;cardFeeMinor:number;chargedMinor:number};
 items:{externalId:string;productId?:string;sku?:string;name:string;quantity:number;unitPriceMinor:number;originalPriceMinor?:number;discountMinor?:number;imageUrl?:string;selectedServices?:Json;reductions?:Json;adjustedMeasurements?:Json;properties?:Json;notes?:string}[];
 payment?:{externalId?:string;provider?:string;reference?:string;amountMinor:number;currency:string;status:'paid'|'unpaid';receivedAt?:string;notes?:string};
};
function invalid():never{throw new WebsiteOrderError('WEBSITE_INVALID_PAYLOAD');}
const object=(value:unknown):RecordValue=>value&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:invalid();
function fields(value:RecordValue,allowed:string[]){if(Object.keys(value).some(k=>!allowed.includes(k)))invalid();}
function text(value:unknown,max=300,required=false):string|undefined {
 if(value==null&&!required)return undefined;
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))invalid();
 const result=value.trim();if(required&&!result)invalid();return result||undefined;
}
function id(value:unknown,required=true){const v=typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):text(value,500,required);if(v&&(!/^[A-Za-z0-9_:.~-]+$/.test(v)||v.length>500))invalid();return v;}
function minor(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>2147483647)invalid();return value;}
function date(value:unknown){const v=text(value,40,true)!;if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))invalid();const day=v.slice(0,10),calendar=new Date(day+'T00:00:00Z');if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==day||Number(v.slice(11,13))>23||Number(v.slice(14,16))>59||Number(v.slice(17,19))>59)invalid();return new Date(v).toISOString();}
function currency(value:unknown){const v=text(value,3,true)!.toUpperCase();if(!['EUR','USD','UAH'].includes(v))invalid();return v;}
function publicUrl(value:unknown){const v=text(value,2048);if(!v)return undefined;let u:URL;try{u=new URL(v);}catch{return invalid();}if(u.protocol!=='https:'||u.username||u.password||isIP(u.hostname.replace(/^\[|\]$/g,''))||!u.hostname.includes('.')||/\.(?:local|localhost|internal)$/i.test(u.hostname))invalid();return u.href;}
function jsonText(value:string){
 if(value.includes('\u0000'))invalid();
 for(let i=0;i<value.length;i++){
  const code=value.charCodeAt(i);
  if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))invalid();}
  else if(code>=0xdc00&&code<=0xdfff)invalid();
 }
 return value;
}
function json(value:unknown,depth=0):Json|undefined {
 if(value===undefined)return undefined;if(depth>8)invalid();
 if(typeof value==='string')return jsonText(value);
 if(value===null||typeof value==='boolean')return value as Json;
 if(typeof value==='number'){if(!Number.isFinite(value))invalid();return value;}
 if(Array.isArray(value))return value.map(v=>json(v,depth+1) as Json);
 const v=object(value);if(Object.keys(v).some(k=>['__proto__','constructor','prototype'].includes(jsonText(k))))invalid();
 return Object.fromEntries(Object.entries(v).map(([k,v])=>[k,json(v,depth+1)])) as Json;
}

/** One canonical account grammar for ingestion and scoped website credentials. */
export function normalizeWebsiteSourceAccount(value:unknown):string {
 const account=text(value,253,true)!.toLowerCase();
 if(!/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,63}$/.test(account))invalid();
 return account;
}

/** Checkout v1 sends net item prices; discountMinor is informational. Charge includes delivery and card surcharge. */
export function parseWebsiteOrder(input:unknown):WebsiteOrder {
 const p=object(input);fields(p,['contractVersion','sourceAccount','order','customer','delivery','totals','items','payment']);
 const raw=json(p)!;
 if(p.contractVersion!==1||Buffer.byteLength(JSON.stringify(raw))>262144)invalid();
 const sourceAccount=normalizeWebsiteSourceAccount(p.sourceAccount);
 const o=object(p.order);fields(o,['externalId','externalNumber','orderedAt','updatedAt','checkoutMode','paymentStatus','currency','notes','sourceUrl']);
 if(typeof o.checkoutMode!=='string'||typeof o.paymentStatus!=='string'||!['card','bank_invoice'].includes(o.checkoutMode)||!['paid','unpaid'].includes(o.paymentStatus))invalid();
 const order:WebsiteOrder['order']={externalId:id(o.externalId)!,externalNumber:text(o.externalNumber,100),orderedAt:date(o.orderedAt),updatedAt:o.updatedAt==null?undefined:date(o.updatedAt),checkoutMode:o.checkoutMode as 'card'|'bank_invoice',paymentStatus:o.paymentStatus as 'paid'|'unpaid',currency:currency(o.currency),notes:text(o.notes,8000),sourceUrl:publicUrl(o.sourceUrl)};
 try{websiteCheckoutMarker(sourceAccount,order.externalId);}catch{invalid();}
 const c=object(p.customer);fields(c,['fullName','email','phone','country','city','addressLine1','addressLine2','postalCode']);
 const customer:WebsiteOrder['customer']={fullName:text(c.fullName,200,true)!};
 for(const key of ['country','city','addressLine1','addressLine2','postalCode'] as const)customer[key]=text(c[key],500);
 customer.email=text(c.email,320)?.toLowerCase();if(customer.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))invalid();
 const phone=text(c.phone,100);if(phone){const compact=phone.replace(/[ ().-]/g,'');const international=compact.startsWith('00');const digits=(international?compact.slice(2):compact).replace(/[^0-9]/g,'');if(!/^[0-9+ ().-]+$/.test(phone)||digits.length<7||digits.length>15)invalid();customer.phone=(phone.startsWith('+')||international?'+':'')+digits;}
 if(!customer.email&&!customer.phone)invalid();
 const d=object(p.delivery);fields(d,['amountMinor','serviceName','addressText']);
 const delivery={amountMinor:minor(d.amountMinor),serviceName:text(d.serviceName,200),addressText:text(d.addressText,2000)};
 const t=object(p.totals);fields(t,['itemsMinor','discountMinor','deliveryMinor','cardFeeMinor','chargedMinor']);
 const totals:WebsiteOrder['totals']={itemsMinor:minor(t.itemsMinor),discountMinor:minor(t.discountMinor),deliveryMinor:minor(t.deliveryMinor),cardFeeMinor:minor(t.cardFeeMinor),chargedMinor:minor(t.chargedMinor)};
 if(!Array.isArray(p.items)||p.items.length<1||p.items.length>100)invalid();
 const items=p.items.map(value=>{
  const i=object(value);fields(i,['externalId','productId','sku','name','quantity','unitPriceMinor','originalPriceMinor','discountMinor','imageUrl','selectedServices','reductions','adjustedMeasurements','properties','notes']);
  const externalId=id(i.externalId??i.productId)!;
  const quantity=minor(i.quantity);if(quantity<1||quantity>100)invalid();
  for(const key of ['properties','reductions','adjustedMeasurements'])if(i[key]!=null&&!(Array.isArray(i[key])&&i[key].length===0))object(i[key]);
  if(i.selectedServices!=null&&!Array.isArray(i.selectedServices))invalid();
  return {externalId,productId:text(i.productId,150),sku:text(i.sku,150),name:text(i.name,500,true)!,quantity,unitPriceMinor:minor(i.unitPriceMinor),originalPriceMinor:i.originalPriceMinor==null?undefined:minor(i.originalPriceMinor),discountMinor:i.discountMinor==null?undefined:minor(i.discountMinor),imageUrl:publicUrl(i.imageUrl),selectedServices:json(i.selectedServices),reductions:json(i.reductions),adjustedMeasurements:json(i.adjustedMeasurements),properties:json(i.properties),notes:text(i.notes,4000)};
 });
 if(new Set(items.map(i=>i.externalId)).size!==items.length||items.reduce((n,i)=>n+i.quantity,0)>500)invalid();
 const lineSum=items.reduce((n,i)=>n+BigInt(i.quantity)*BigInt(i.unitPriceMinor),0n);
 if(lineSum!==BigInt(totals.itemsMinor)||delivery.amountMinor!==totals.deliveryMinor||BigInt(totals.chargedMinor)!==lineSum+BigInt(totals.deliveryMinor)+BigInt(totals.cardFeeMinor))throw new WebsiteOrderError('WEBSITE_TOTALS_MISMATCH');
 let payment:WebsiteOrder['payment'];
 if(p.payment!=null){const q=object(p.payment);fields(q,['externalId','provider','reference','amountMinor','currency','status','receivedAt','notes']);if(typeof q.status!=='string'||!['paid','unpaid'].includes(q.status))invalid();payment={externalId:id(q.externalId,false),provider:text(q.provider,100),reference:text(q.reference,300),amountMinor:minor(q.amountMinor),currency:currency(q.currency),status:q.status as 'paid'|'unpaid',receivedAt:q.receivedAt==null?undefined:date(q.receivedAt),notes:text(q.notes,4000)};}
 if(order.checkoutMode==='bank_invoice'&&(order.paymentStatus!=='unpaid'||totals.cardFeeMinor!==0))invalid();
 if(payment&&(payment.currency!==order.currency||payment.status!==order.paymentStatus))invalid();
 if(order.paymentStatus==='paid'&&(!payment||!payment.receivedAt||payment.amountMinor!==totals.chargedMinor||payment.amountMinor<1))invalid();
 return {raw,sourceAccount,order,customer,delivery,totals,items,payment};
}
