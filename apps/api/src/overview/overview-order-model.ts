import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { financeBusinessDay, financePeriod } from '../finance/finance-report-model';
import { requiresProduction } from '../orders/production-rules';
import { shippingEvidence, hasManagedEmptyItems } from '../orders/order-shipping-evidence';

export const OVERVIEW_BUCKETS = ['new', 'work', 'ready', 'awaiting', 'completed'] as const;
export type OverviewBucket = typeof OVERVIEW_BUCKETS[number];
export type OverviewOrderFilter = OverviewBucket | 'period' | 'overdue' | 'unpaid';
type Payment = {amountMinor:number;currency:string;appliedAmountMinor:number|null;appliedCurrency:string|null};
type Parcel = {id:string;status:string;carrier:string;trackingNumber:string|null;shippedAt:Date|null;deliveredAt:Date|null;instances?:{id:string}[]};
export type OverviewOrderSource = {
  compositionManaged?:boolean;compositionOperations?:{id:string}[];_count?:{items:number};
  id:string;type:Parameters<typeof requiresProduction>[0];createdAt:Date;sourceSystem:string|null;
  salesStatus:string;productionStatus:string;paymentStatus:string;shippingStatus:string;
  requiredDeliveryAt:Date|null;deliveryTrackingCode:string|null;priceMinor:number;depositRequiredMinor:number;currency:string;
  items:{quantity?:number;productionStatus:string;instances:{id?:string;productionStatus:string}[]}[];payments:Payment[];
  orderShipments:Parcel[];shipment:{trackingNumber:string|null;shippedAt:Date|null;deliveredAt:Date|null;carrier?:string}|null;
  deadlineEvidence:{metadata:unknown}[];archivedAt?:Date|null;
};

/** Narrow private operational projection, never an order detail or provider payload. */
export const overviewOrderSourceSelect = {
  compositionOperations:{take:1,select:{id:true}},_count:{select:{items:{where:{archivedAt:{not:null}}}}},
  id:true,type:true,createdAt:true,sourceSystem:true,salesStatus:true,productionStatus:true,paymentStatus:true,shippingStatus:true,
  requiredDeliveryAt:true,deliveryTrackingCode:true,priceMinor:true,depositRequiredMinor:true,currency:true,
  items:{where:{archivedAt:null},select:{quantity:true,productionStatus:true,instances:{where:{archivedAt:null},select:{id:true,productionStatus:true}}}},
  payments:{where:{voidedAt:null},select:{amountMinor:true,currency:true,appliedAmountMinor:true,appliedCurrency:true}},
  orderShipments:{where:{archivedAt:null},orderBy:[{isPrimary:'desc' as const},{id:'asc' as const}],select:{id:true,status:true,carrier:true,trackingNumber:true,shippedAt:true,deliveredAt:true,instances:{select:{id:true}}}},
  shipment:{select:{carrier:true,trackingNumber:true,shippedAt:true,deliveredAt:true}},
  activities:{where:{type:'ORDER_DEADLINE_UPDATED'},orderBy:[{createdAt:'desc' as const},{id:'desc' as const}],take:1,select:{metadata:true}},
} satisfies Prisma.OrderSelect;

export async function loadOverviewOrderSources(db:Pick<Prisma.TransactionClient,'order'>):Promise<OverviewOrderSource[]> {
  const result:OverviewOrderSource[]=[];
  let cursor:string|undefined;
  for(;;){
    const rows=await db.order.findMany({where:{archivedAt:null},select:overviewOrderSourceSelect,orderBy:{id:'asc'},take:500,...(cursor?{cursor:{id:cursor},skip:1}:{})});
    result.push(...rows.map(({activities,...order})=>({...order,deadlineEvidence:activities})));
    if(rows.length<500)return result;
    cursor=rows[rows.length-1]!.id;
  }
}

const WORK = new Set(['MATERIALS','CUTTING','SEWING','DECORATION','QUALITY_CONTROL']);
const CLOSED_SALES = new Set(['CANCELLED','COMPLETED','DELIVERED','REVIEW_REQUESTED']);
const SENT = new Set(['SHIPPED','IN_TRANSIT','DELIVERED','RETURNED','LOST']);
const day=(value:Date)=>value.toISOString().slice(0,10);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

export function hasTrustedOverviewDeadline(order:OverviewOrderSource) {
  if(!order.requiredDeliveryAt)return false;
  if(order.sourceSystem!=='KEYCRM')return true;
  const expected=order.requiredDeliveryAt.toISOString();
  return order.deadlineEvidence.some(evidence=>{
    const value=object(evidence.metadata).requiredDeliveryAt;
    return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===expected;
  });
}

function settlement(order:OverviewOrderSource):number|null {
  let total=0;
  for(const payment of order.payments){
    const amount=payment.currency===order.currency?payment.amountMinor:payment.appliedCurrency===order.currency?payment.appliedAmountMinor:null;
    if(amount===null||!Number.isSafeInteger(amount)||amount<0)return null;
    total+=amount;if(!Number.isSafeInteger(total))return null;
  }
  return total;
}
function parcelSent(parcel:{status?:string;trackingNumber?:string|null;shippedAt?:Date|null;deliveredAt?:Date|null}) {
  return Boolean((parcel.status&&SENT.has(parcel.status))||parcel.trackingNumber?.trim()||parcel.shippedAt||parcel.deliveredAt);
}

/** One exclusive ring classification, plus independent current operational flags. */
export function classifyOverviewOrder(order:OverviewOrderSource,now=new Date()) {
  const parcels=order.orderShipments;
  const exceptionalParent=['RETURNED','LOST'].includes(order.shippingStatus);
  const exceptionalParcel=parcels.some(parcel=>['RETURNED','LOST'].includes(parcel.status));
  const cancelled=order.salesStatus==='CANCELLED'||order.productionStatus==='CANCELLED'||order.paymentStatus==='REFUNDED'||order.paymentStatus==='CANCELLED';
  const allParcelsDelivered=shippingEvidence(order).complete&&parcels.length>0&&parcels.every(parcel=>parcel.status==='DELIVERED'||Boolean(parcel.deliveredAt));
  const completed=!exceptionalParent&&!exceptionalParcel&&!cancelled&&(['COMPLETED','REVIEW_REQUESTED'].includes(order.salesStatus)||allParcelsDelivered||(!parcels.length&&(order.salesStatus==='DELIVERED'||order.shippingStatus==='DELIVERED'||Boolean(order.shipment?.deliveredAt))));
  // Child-only dispatch requires full item coverage; explicit root tracking/dates
  // retain the approved legacy whole-order meaning across all status consumers.
  const dispatched=shippingEvidence(order).complete;
  const partiallyDispatched=parcels.length>0&&parcels.some(parcelSent)&&!dispatched;
  // A terminal child does not close the other active parcels or their production.
  const open=!order.archivedAt&&!cancelled&&!completed&&!exceptionalParent&&!(exceptionalParcel&&CLOSED_SALES.has(order.salesStatus));
  const leaves=order.items.flatMap(item=>item.instances.length?item.instances.map(instance=>instance.productionStatus):[item.productionStatus]).filter(status=>status!=='CANCELLED');
  const fullReady=leaves.length>0?leaves.every(status=>status==='READY'):order.productionStatus==='READY';
  const work=!hasManagedEmptyItems(order)&&open&&!dispatched&&requiresProduction(order.type)&&!fullReady&&(WORK.has(order.productionStatus)||leaves.some(status=>WORK.has(status)||status==='READY'));
  const ready=!hasManagedEmptyItems(order)&&open&&!dispatched&&!partiallyDispatched&&(order.salesStatus==='READY_TO_SHIP'||(requiresProduction(order.type)?fullReady:order.shippingStatus==='READY'));
  const trusted=order.sourceSystem!=='KEYCRM'||order.salesStatus!=='NEW_LEAD'||work||ready||hasTrustedOverviewDeadline(order);
  const paid=settlement(order);
  const unpaid=open&&!dispatched&&trusted&&paid!==null&&((order.depositRequiredMinor>0&&paid<order.depositRequiredMinor)||(order.salesStatus==='WAITING_FINAL_PAYMENT'&&paid<order.priceMinor));
  const expired=Boolean(order.requiredDeliveryAt&&day(order.requiredDeliveryAt)<financeBusinessDay(now));
  const overdue=!hasManagedEmptyItems(order)&&open&&!dispatched&&expired&&hasTrustedOverviewDeadline(order);
  const requiresVerification=open&&!dispatched&&(exceptionalParcel||!trusted||paid===null||(expired&&!hasTrustedOverviewDeadline(order)));
  let bucket:OverviewBucket|null=null;
  if(!order.archivedAt){
    if(completed)bucket='completed';
    else if(open&&!dispatched&&trusted){bucket=ready?'ready':work?'work':unpaid?'awaiting':paid===null||partiallyDispatched?null:'new';}
  }
  return {bucket,work,ready,overdue,unpaid,requiresVerification,completed,dispatched,partiallyDispatched};
}

export function validateOverviewPeriod(period:string|undefined,now=new Date()) {
  const month=period===undefined?financeBusinessDay(now).slice(0,7):period;
  if(typeof month!=='string'||!/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month))throw new BadRequestException('Некорректный период обзора');
  return {month,start:financePeriod(month),end:financePeriod(month,1)};
}
export function validateOverviewOrderFilter(input:{overviewFilter?:string;period?:string},now=new Date()) {
  const filter=input.overviewFilter??'period';
  if(![...OVERVIEW_BUCKETS,'period','overdue','unpaid'].includes(filter))throw new BadRequestException('Некорректный фильтр обзора');
  return {...validateOverviewPeriod(input.period,now),filter:filter as OverviewOrderFilter};
}
export function matchesOverviewOrderFilter(order:OverviewOrderSource,input:{overviewFilter?:string;period?:string},now=new Date()) {
  const {filter,start,end}=validateOverviewOrderFilter(input,now),state=classifyOverviewOrder(order,now);
  if(order.archivedAt)return false;
  if(filter==='overdue')return state.overdue;
  if(filter==='unpaid')return state.unpaid;
  if(!input.period&&filter==='work')return state.work;
  if(!input.period&&filter==='ready')return state.ready;
  if(order.createdAt<start||order.createdAt>=end)return false;
  return filter==='period'||state.bucket===filter;
}
export async function resolveOverviewOrderIds(db:Pick<Prisma.TransactionClient,'order'>,input:{overviewFilter?:string;period?:string},now=new Date()):Promise<string[]> {
  validateOverviewOrderFilter(input,now);
  return (await loadOverviewOrderSources(db)).filter(order=>matchesOverviewOrderFilter(order,input,now)).map(order=>order.id);
}

export type OverviewUpcomingShipmentRecord={id:string;orderId:string;shipmentId:string|null;carrier:string|null;status:string;expectedAt:string;forecast:true};
export function eligibleUpcomingShipmentRecords(sources:OverviewOrderSource[],input:{horizon?:number}={},now=new Date()):OverviewUpcomingShipmentRecord[] {
  if(input.horizon!==undefined&&input.horizon!==7)throw new BadRequestException('Поддерживается горизонт отправок 7 дней');
  const today=financeBusinessDay(now),until=new Date(today+'T00:00:00Z');until.setUTCDate(until.getUTCDate()+7);
  const result:OverviewUpcomingShipmentRecord[]=[];
  for(const order of sources){
    if(hasManagedEmptyItems(order)||order.archivedAt||CLOSED_SALES.has(order.salesStatus)||order.productionStatus==='CANCELLED'||['REFUNDED','CANCELLED'].includes(order.paymentStatus)||['RETURNED','LOST'].includes(order.shippingStatus)||!hasTrustedOverviewDeadline(order)||!order.requiredDeliveryAt)continue;
    const expectedAt=order.requiredDeliveryAt.toISOString(),expected=day(order.requiredDeliveryAt);
    if(expected<today||(input.horizon&&expected>=day(until)))continue;
    if(order.orderShipments.length){
      for(const parcel of order.orderShipments)if(!parcelSent(parcel))result.push({id:parcel.id,orderId:order.id,shipmentId:parcel.id,carrier:parcel.carrier,status:parcel.status,expectedAt,forecast:true});
    }else if(!SENT.has(order.shippingStatus)&&order.salesStatus!=='SHIPPED'&&!order.deliveryTrackingCode?.trim()&&!(order.shipment&&parcelSent(order.shipment))){
      result.push({id:order.id,orderId:order.id,shipmentId:null,carrier:order.shipment?.carrier??null,status:order.shippingStatus,expectedAt,forecast:true});
    }
  }
  return result.sort((a,b)=>a.expectedAt.localeCompare(b.expectedAt)||a.id.localeCompare(b.id));
}
export async function resolveOverviewShippingOrderIds(db:Pick<Prisma.TransactionClient,'order'>,input:{horizon?:number}={},now=new Date()):Promise<string[]> {
  if(input.horizon!==undefined&&input.horizon!==7)throw new BadRequestException('Поддерживается горизонт отправок 7 дней');
  return [...new Set(eligibleUpcomingShipmentRecords(await loadOverviewOrderSources(db),input,now).map(row=>row.orderId))];
}
