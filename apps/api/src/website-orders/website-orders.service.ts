import { Injectable } from '@nestjs/common';
import { websiteCheckoutMarker, WEBSITE_CHECKOUT_SYSTEM } from '../keycrm/website-checkout-correlation';
import type { Prisma, Client } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TaxesService } from '../taxes/taxes.service';
import { parcelHasDispatchEvidence, shippingEvidence } from '../orders/order-shipping-evidence';
import { appliedPaymentMinor } from '../finance/exchange-rates';
import { parseWebsiteOrder, type WebsiteOrder } from './website-orders-contract';
import { WebsiteOrderError } from './website-orders-errors';
import { nextWebsiteOrderNumber } from './website-order-number';

export const WEBSITE_SYSTEM=WEBSITE_CHECKOUT_SYSTEM;
type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fingerprint=(value:unknown):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function conflict(code='WEBSITE_ORDER_CONFLICT'):never{throw new WebsiteOrderError(code,409);}
const scopes=()=>String(process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
const normalizedTitle=(name:string)=>name.replace(/\\?u201c/g,'“').replace(/\\?u201d/g,'”');

@Injectable()
export class WebsiteOrdersService {
 constructor(private readonly prisma:PrismaService,private readonly taxes:TaxesService,private readonly allowedAccounts=scopes){}
 async ingest(input:unknown,authorizedSourceAccount?:string){
  const p=parseWebsiteOrder(input);
  // Only the authenticated controller supplies this in-process scope. Legacy callers
  // retain the original environment allowlist; payload fields cannot grant access.
  const allowed=authorizedSourceAccount===undefined?this.allowedAccounts():[authorizedSourceAccount];if(!allowed.length)throw new WebsiteOrderError('WEBSITE_DISABLED',503);
  if(!allowed.includes(p.sourceAccount))throw new WebsiteOrderError('WEBSITE_SOURCE_NOT_ALLOWED',403);
  return this.prisma.$transaction(async tx=>{
   // Same lock as canonical client merge and KeyCRM import: no duplicate contacts across writers.
   await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))','client-merge-global');
   await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',`${WEBSITE_SYSTEM}:${p.sourceAccount}:${p.order.externalId}`);
   const identity={sourceSystem:WEBSITE_SYSTEM,sourceAccount:p.sourceAccount,externalId:p.order.externalId};
   let existing=await tx.order.findUnique({where:{sourceSystem_sourceAccount_externalId:identity},include:{shipment:true,orderShipments:{where:{archivedAt:null},include:{instances:{select:{id:true}}}}}});
   if(existing){await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',existing.id);existing=await tx.order.findUnique({where:{id:existing.id},include:{shipment:true,orderShipments:{where:{archivedAt:null},include:{instances:{select:{id:true}}}}}});}
   if(existing&&fingerprint(existing.externalData)===fingerprint(p.raw))return this.result(existing,false);
   const previous=existing?parseWebsiteOrder(existing.externalData):undefined;
   const warnings:string[]=[];
   if(existing&&previous){
    if(shippingEvidence(existing).complete||existing.orderShipments.some(parcelHasDispatchEvidence)||existing.archivedAt||['CANCELLED','COMPLETED','SHIPPED','DELIVERED','REVIEW_REQUESTED'].includes(existing.salesStatus)||['REFUNDED','CANCELLED'].includes(existing.paymentStatus)||['SHIPPED','IN_TRANSIT','DELIVERED','RETURNED','LOST'].includes(existing.shippingStatus))conflict();
    if(existing.currency!==p.order.currency||previous.order.orderedAt!==p.order.orderedAt||existing.type!=='READY_MODEL')conflict();
    if(existing.externalUpdatedAt&&(!p.order.updatedAt||new Date(p.order.updatedAt)<existing.externalUpdatedAt))conflict();
    if(existing.priceMinor!==previous.totals.chargedMinor||existing.deliveryMinor!==previous.totals.deliveryMinor||existing.discountMinor!==previous.totals.discountMinor||existing.depositRequiredMinor!==0)conflict();
    if(existing.externalNumber&&p.order.externalNumber&&existing.externalNumber!==p.order.externalNumber)conflict();
   }
   const clientId=await this.resolveClient(tx,p,existing?.clientId);
   await this.rejectOtherProvider(tx,p);
   const client=await this.client(tx,p,clientId);
   const image=p.items.find(i=>i.imageUrl)?.imageUrl;
   const manualDelivery=existing&&previous&&Object.entries(this.delivery(previous)).some(([k,v])=>((existing as Record<string,unknown>)[k]??null)!==(v??null));
   if(manualDelivery)warnings.push('LOCAL_DELIVERY_PRESERVED');
   const common={priceMinor:p.totals.chargedMinor,depositRequiredMinor:0,deliveryMinor:p.totals.deliveryMinor,discountMinor:p.totals.discountMinor,externalUpdatedAt:p.order.updatedAt?new Date(p.order.updatedAt):null,externalNumber:p.order.externalNumber??existing?.externalNumber,externalData:json(p.raw),externalImageUrl:image,...(manualDelivery?{}:this.delivery(p)),...(!existing||(existing.buyerComment??null)===(previous?.order.notes??null)?{buyerComment:p.order.notes}:{} )};
   const websiteNumber=existing?.number??await nextWebsiteOrderNumber(tx);
   let order=existing?await tx.order.update({where:{id:existing.id},data:common}):await tx.order.create({data:{...identity,...common,number:websiteNumber,clientId:client.id,type:'READY_MODEL',sourceLinkMode:'IMPORTED',taxMinor:0,currency:p.order.currency,createdAt:new Date(p.order.orderedAt),websiteNoticeAt:new Date(),websiteReviewedAt:null}});
   await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',order.id);
   await this.items(tx,order.id,p,previous,warnings);
   const paymentStatus=await this.payment(tx,order.id,p,order.clientId);
   if(paymentStatus!==order.paymentStatus)order=await tx.order.update({where:{id:order.id},data:{paymentStatus}});
   await tx.activity.create({data:{clientId:client.id,orderId:order.id,type:existing?'WEBSITE_ORDER_SYNCED':'WEBSITE_ORDER_IMPORTED',summary:existing?'Обновлён заказ сайта':'Получен заказ с сайта',metadata:{sourceSystem:WEBSITE_SYSTEM,sourceAccount:p.sourceAccount,externalId:p.order.externalId}}});
   await tx.auditLog.create({data:{action:existing?'UPDATE':'CREATE',entityType:'Order',entityId:order.id,...(existing?{before:json(existing)}:{}),after:json(order)}});
   return this.result(order,!existing,[...new Set(warnings)]);
  },{timeout:30000,isolationLevel:'ReadCommitted'});
 }
 private result(order:{id:string;number:string;clientId:string;paymentStatus:string},created:boolean,warnings:string[]=[]){return {ok:true,created,orderId:order.id,orderNumber:order.number,clientId:order.clientId,paymentStatus:order.paymentStatus,warnings};}
 private itemData(p:WebsiteOrder,item:WebsiteOrder['items'][number]){
  return {name:item.name,quantity:item.quantity,priceMinor:item.unitPriceMinor,sku:item.sku,externalImageUrl:item.imageUrl,properties:json({...item.properties as object,originalProperties:item.properties??{},selectedServices:item.selectedServices,reductions:item.reductions,adjustedMeasurements:item.adjustedMeasurements,website:{productId:item.productId,originalPriceMinor:item.originalPriceMinor,discountMinor:item.discountMinor,sourceAccount:p.sourceAccount}}),notes:[item.notes,Array.isArray(item.selectedServices)&&item.selectedServices.length?`Опции сайта: ${JSON.stringify(item.selectedServices)}`:null].filter(Boolean).join('\n')||null};
 }
 private delivery(p:WebsiteOrder){
  return {country:p.customer.country,deliveryAddressSet:!!(p.customer.addressLine1||p.delivery.addressText),deliveryRecipient:p.customer.fullName,deliveryRecipientPhone:p.customer.phone,deliveryEmail:p.customer.email,deliveryAddressLine1:p.customer.addressLine1,deliveryAddressLine2:p.customer.addressLine2,deliveryCity:p.customer.city,deliveryPostalCode:p.customer.postalCode,deliveryAddressText:p.delivery.addressText,deliveryServiceName:p.delivery.serviceName};
 }
 private async items(tx:Tx,orderId:string,p:WebsiteOrder,previous:WebsiteOrder|undefined,warnings:string[]){
  const active=await tx.orderItem.findMany({where:{orderId,sourceSystem:WEBSITE_SYSTEM,sourceAccount:p.sourceAccount}});
  const incoming=new Set(p.items.map(i=>JSON.stringify([p.order.externalId,i.externalId])));
  if(active.some(item=>!incoming.has(item.externalId!)))conflict('WEBSITE_ITEM_CONFLICT'); // Main has no OrderItem archive; never delete historical positions.
  for(const item of p.items){
   const identity={sourceSystem:WEBSITE_SYSTEM,sourceAccount:p.sourceAccount,externalId:JSON.stringify([p.order.externalId,item.externalId])};
   const before=await tx.orderItem.findUnique({where:{sourceSystem_sourceAccount_externalId:identity}});
   if(before&&(before.orderId!==orderId))conflict('WEBSITE_ITEM_CONFLICT');
   const data=this.itemData(p,item),old=previous?.items.find(i=>i.externalId===item.externalId);data.name=normalizedTitle(data.name);
   if(before&&old){const oldData=this.itemData(previous!,old);const manual=Object.entries(oldData).some(([k,v])=>k==='name'?(before.name!==v&&before.name!==normalizedTitle(String(v))):fingerprint((before as Record<string,unknown>)[k]??null)!==fingerprint(v??null));
    if(manual){if(before.quantity!==item.quantity||before.priceMinor!==item.unitPriceMinor)conflict('WEBSITE_ITEM_CONFLICT');warnings.push('LOCAL_ITEM_PRESERVED');continue;}}
   if(before&&item.quantity<before.quantity)await this.shrink(tx,before.id,item.quantity);
   const saved=before?await tx.orderItem.update({where:{id:before.id},data}):await tx.orderItem.create({data:{...data,...identity,orderId}});
   await this.ensureInstances(tx,saved.id,item.quantity);
   await tx.auditLog.create({data:{action:before?'UPDATE':'CREATE',entityType:'OrderItem',entityId:saved.id,...(before?{before:json(before)}:{}),after:json(saved)}});
  }
 }
 private async shrink(tx:Tx,itemId:string,quantity:number){
  const instances=await tx.orderItemInstance.findMany({where:{orderItemId:itemId,archivedAt:null},orderBy:{ordinal:'asc'}});
  const removed=instances.slice(quantity);
  if(removed.some(i=>i.athleteId||i.measurementId||i.orderShipmentId||i.productionStatus!=='NOT_SCHEDULED'||i.startedAt||i.completedAt||i.plannedStartAt||i.plannedEndAt))conflict('WEBSITE_ITEM_CONFLICT');
  for(const instance of removed){await tx.orderItemInstance.update({where:{id:instance.id},data:{archivedAt:new Date()}});await tx.auditLog.create({data:{action:'ARCHIVE',entityType:'OrderItemInstance',entityId:instance.id,after:{sourceSystem:WEBSITE_SYSTEM}}});}
 }
 private async payment(tx:Tx,orderId:string,p:WebsiteOrder,clientId:string){
  const payments=await tx.payment.findMany({where:{orderId}}),active=payments.filter(row=>!row.voidedAt);
  const identity={sourceSystem:WEBSITE_SYSTEM,sourceAccount:p.sourceAccount,externalId:JSON.stringify([p.order.externalId,p.payment?.externalId??'payment'])};
  const before=await tx.payment.findUnique({where:{sourceSystem_sourceAccount_externalId:identity}});
  if(before&&(before.orderId!==orderId||before.voidedAt))conflict('WEBSITE_PAYMENT_CONFLICT');
  if(p.order.paymentStatus==='unpaid'&&active.length)conflict('WEBSITE_PAYMENT_CONFLICT');
  if(p.order.paymentStatus==='paid'){
   const receipt=p.payment!;
   if(before&&(before.amountMinor!==receipt.amountMinor||before.currency!==receipt.currency||new Date(before.receivedAt).toISOString()!==receipt.receivedAt))conflict('WEBSITE_PAYMENT_CONFLICT');
   if(!before&&active.length)conflict('WEBSITE_PAYMENT_CONFLICT');
   if(!before){const saved=await tx.payment.create({data:{...identity,orderId,amountMinor:receipt.amountMinor,currency:receipt.currency,receivedAt:new Date(receipt.receivedAt!),method:'CARD',reference:receipt.reference??null,notes:receipt.notes??null,externalStatus:'paid',appliedAmountMinor:receipt.amountMinor,appliedCurrency:receipt.currency}});
    await this.taxes.capturePayment(tx,saved.id,'WEBSITE_CREATE');
    await tx.activity.create({data:{clientId,orderId,type:'PAYMENT_RECEIVED',summary:'Получена оплата с сайта',metadata:{paymentId:saved.id,amountMinor:saved.amountMinor,currency:saved.currency,sourceSystem:WEBSITE_SYSTEM}}});
    await tx.auditLog.create({data:{action:'CREATE',entityType:'Payment',entityId:saved.id,after:json(saved)}});active.push(saved);
   }else if((receipt.reference&&receipt.reference!==before.reference)||(receipt.notes&&receipt.notes!==before.notes)){
    const updated=await tx.payment.update({where:{id:before.id},data:{...(receipt.reference?{reference:receipt.reference}:{}),...(receipt.notes?{notes:receipt.notes}:{})}});
    await tx.auditLog.create({data:{action:'UPDATE',entityType:'Payment',entityId:before.id,before:json(before),after:json(updated)}});
   }
  }
  let paid=0;try{paid=active.reduce((sum,row)=>sum+appliedPaymentMinor(row,p.order.currency),0);}catch{conflict('WEBSITE_PAYMENT_CONFLICT');}
  if(!Number.isSafeInteger(paid)||paid>2147483647)conflict('WEBSITE_PAYMENT_CONFLICT');
  return paid>0&&paid>=p.totals.chargedMinor?'PAID':paid>0?'PARTIALLY_PAID':'UNPAID';
 }
 private async resolveClient(tx:Tx,p:WebsiteOrder,pinnedId?:string){
  const email=p.customer.email??null,phone=p.customer.phone?.replace(/\D/g,'')??null;
  // Country is optional in the website contract. Permit the Ukrainian national
  // and +380 forms when absent, but never override an explicit foreign country.
  const country=(p.customer.country??'').trim().toLowerCase();
  const ua=!country||['ua','ukraine','україна','украина'].includes(country);
  const uaPhone=ua&&phone?.length===10&&phone.startsWith('0')?`38${phone}`:null;
  const localPhone=ua&&phone?.length===12&&phone.startsWith('380')?phone.slice(2):null;
  const phones=new Set([phone,uaPhone,localPhone].filter((value):value is string=>!!value));
  const candidates=await tx.$queryRawUnsafe<{id:string;email:string|null;phone:string|null}[]>('SELECT id, email, phone FROM "Client" WHERE ($1::text IS NOT NULL AND lower(trim(coalesce(email,\'\')))=$1) OR ($2::text IS NOT NULL AND regexp_replace(coalesce(phone,\'\'),\'[^0-9]\',\'\',\'g\')=$2) OR ($3::text IS NOT NULL AND regexp_replace(coalesce(phone,\'\'),\'[^0-9]\',\'\',\'g\')=$3) OR ($4::text IS NOT NULL AND regexp_replace(coalesce(phone,\'\'),\'[^0-9]\',\'\',\'g\')=$4) ORDER BY id',email,phone,uaPhone,localPhone);
  const matches=new Map<string,{email:boolean;phone:boolean}>();
  for(const candidate of candidates){let id=candidate.id;const seen=new Set<string>();for(;;){if(seen.has(id))conflict('WEBSITE_CLIENT_CONFLICT');seen.add(id);const redirect=await tx.clientMergeRedirect.findUnique({where:{sourceClientId:id}});if(!redirect)break;id=redirect.targetClientId;}const found=matches.get(id)??{email:false,phone:false};found.email||=!!email&&candidate.email?.trim().toLowerCase()===email;found.phone||=!!candidate.phone&&phones.has(candidate.phone.replace(/\D/g,''));matches.set(id,found);}
  const full=[...matches].filter(([,found])=>(!email||found.email)&&(!phone||found.phone)).map(([id])=>id);
  if(full.length>1)conflict('WEBSITE_CLIENT_CONFLICT');
  if(pinnedId){if(full.length!==1||full[0]!==pinnedId)conflict('WEBSITE_CLIENT_CONFLICT');return pinnedId;}
  // Partial contacts identify no person. Import a fresh website snapshot so no
  // customer's history is assigned to another person sharing email or phone.
  return full[0];
 }
 private async client(tx:Tx,p:WebsiteOrder,clientId?:string){
  const fields={firstName:p.customer.fullName,displayName:p.customer.fullName,email:p.customer.email,phone:p.customer.phone,country:p.customer.country,city:p.customer.city,address:[p.customer.addressLine1,p.customer.addressLine2].filter(Boolean).join('\n')||undefined,postalCode:p.customer.postalCode};
  let client:Client;
  if(clientId){const found=await tx.client.findUnique({where:{id:clientId}});if(!found||found.archivedAt)conflict('WEBSITE_CLIENT_CONFLICT');client=found;const fill=Object.fromEntries(Object.entries(fields).filter(([key,value])=>value&&!(client as Record<string,unknown>)[key]));if(Object.keys(fill).length){const before=client;client=await tx.client.update({where:{id:client.id},data:fill});await tx.auditLog.create({data:{action:'UPDATE',entityType:'Client',entityId:client.id,before:json(before),after:json(client)}});}}
  else{client=await tx.client.create({data:{...fields,source:'WEBSITE'}});await tx.auditLog.create({data:{action:'CREATE',entityType:'Client',entityId:client.id,after:json(client)}});}
  return client;
 }
 private async ensureInstances(tx:Tx,itemId:string,quantity:number){
  const rows=await tx.orderItemInstance.findMany({where:{orderItemId:itemId},orderBy:{ordinal:'asc'}});
  const active=rows.filter(row=>!row.archivedAt);let ordinal=Math.max(0,...rows.map(row=>row.ordinal));
  for(let i=active.length;i<quantity;i++)await tx.orderItemInstance.create({data:{orderItemId:itemId,ordinal:++ordinal,productionStatus:'NOT_SCHEDULED'}});
 }
 private async rejectOtherProvider(tx:Tx,p:WebsiteOrder){
  const sourceUuid=websiteCheckoutMarker(p.sourceAccount,p.order.externalId);
  const collision=await tx.order.findFirst({where:{sourceSystem:'KEYCRM',externalData:{path:['source_uuid'],equals:sourceUuid}}});
  if(collision)conflict('WEBSITE_CROSS_PROVIDER_CONFLICT');
 }
}
