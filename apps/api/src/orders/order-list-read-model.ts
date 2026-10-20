import {shippingEvidence,hasManagedEmptyItems,type ShippingEvidence} from './order-shipping-evidence';
import {BadRequestException} from '@nestjs/common';
import {ORDER_SOURCES,normalizeOrderSourceFilter,matchesOrderSource,type OrderSource} from './order-source';

type DateValue=Date|string;
export type OrderListReadQuery={focusId?:string;source?:string;page?:string|number;pageSize?:string|number;quick?:string;status?:string;discipline?:string;sort?:string;direction?:string;overviewFilter?:string;period?:string};
type Row=ShippingEvidence&{compositionManaged?:boolean;compositionOperations?:{id:string}[];_count?:{items:number};id:string;number:string;orderSource?:OrderSource;createdAt:DateValue;requiredDeliveryAt?:DateValue|null;discipline?:string|null;notes?:string|null;country?:string|null;deliveryAddressSet?:boolean;deliveryAddressText?:string|null;deliveryAddressLine1?:string|null;deliveryAddressLine2?:string|null;deliveryCity?:string|null;deliveryRegion?:string|null;deliveryPostalCode?:string|null;deliveryTrackingCode?:string|null;client:{displayName:string;country?:string|null;city?:string|null;address?:string|null;postalCode?:string|null};items:{name?:string;quantity:number}[];payments:{amountMinor:number;currency:string;appliedAmountMinor?:number|null;appliedCurrency?:string|null;voidedAt?:DateValue|null}[];currency:string;priceMinor:number;depositRequiredMinor:number;salesStatus:string;productionStatus:string;shippingStatus:string;productionSlot?:{startsAt:DateValue}|null;shipment?:{trackingNumber?:string|null;shippedAt?:DateValue|null;deliveredAt?:DateValue|null}|null};
const SALES_LABELS:Record<string,string>={NEW_LEAD:"Новый заказ",WAITING_CLIENT_REPLY:"Ожидается ответ",NEEDS_ESTIMATE:"Нужен расчёт",ESTIMATE_SENT:"Расчёт отправлен",DESIGN_DISCUSSION:"Обсуждение дизайна",WAITING_COACH_APPROVAL:"Согласование тренера",WAITING_DEPOSIT:"Ожидается предоплата",DEPOSIT_RECEIVED:"Предоплата получена",ORDER_CONFIRMED:"Заказ подтверждён",MEASUREMENTS_REQUIRED:"Нужны замеры",MEASUREMENTS_RECEIVED:"Замеры получены",READY_FOR_PRODUCTION:"Готов к производству",IN_PRODUCTION:"В производстве",FINAL_DECORATION:"Финальный декор",QUALITY_CONTROL:"Контроль качества",PHOTO_SENT:"Фото отправлено",WAITING_FINAL_PAYMENT:"Ожидается доплата",PAID:"Оплачено",READY_TO_SHIP:"Готов к отправке",SHIPPED:"Отправлено",DELIVERED:"Доставлено",REVIEW_REQUESTED:"Запрошен отзыв",COMPLETED:"Завершено",CANCELLED:"Отменено"};
const SHIPPING_LABELS:Record<string,string>={NOT_READY:'Не готов к отправке',READY:'Готов к отправке',LABEL_CREATED:'Накладная создана',SHIPPED:'Отправлен',IN_TRANSIT:'В пути',DELIVERED:'Доставлен',RETURNED:'Возвращён',LOST:'Утерян'};
const DISCIPLINES:Record<string,string>={RHYTHMIC_GYMNASTICS:'Художественная гимнастика',ACROBATIC_GYMNASTICS:'Акробатика',FIGURE_SKATING:'Фигурное катание',AEROBIC_GYMNASTICS:'Спортивная аэробика',BATON_TWIRLING_MAJORETTE:'Twirling',OTHER:'Другое'};
const QUICK=['all','active','urgent','deposit','depositShortfall','work','ready','completed','overdue'];
const SORT=['source','client','model','quantity','deadline','payment','production','delivery','status','created'];
const WORK=['SCHEDULED','MATERIALS','CUTTING','SEWING','DECORATION','QUALITY_CONTROL'];
const day=(value:DateValue)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
function paid(row:Row):number|null {let total=0n;for(const p of row.payments){if(p.voidedAt)continue;const value=p.currency===row.currency?p.amountMinor:p.appliedCurrency===row.currency?p.appliedAmountMinor:null;if(value==null||!Number.isSafeInteger(value)||value<0)return null;total+=BigInt(value);}return total<=BigInt(Number.MAX_SAFE_INTEGER)?Number(total):null;}
const active=(row:Row)=>!['COMPLETED','CANCELLED'].includes(row.salesStatus);
const operational=(row:Row)=>!hasManagedEmptyItems(row)&&active(row)&&!['LOST','RETURNED'].includes(row.shippingStatus)&&!['DELIVERED','REVIEW_REQUESTED'].includes(row.salesStatus)&&!shippingEvidence(row).complete;
const ready=(row:Row)=>operational(row)&&!shippingEvidence(row).hasChildDispatch&&!['SHIPPED','DELIVERED'].includes(row.salesStatus)&&!['SHIPPED','IN_TRANSIT','DELIVERED','RETURNED','LOST'].includes(row.shippingStatus)&&!row.shipment?.trackingNumber?.trim()&&!row.deliveryTrackingCode?.trim()&&!row.shipment?.shippedAt&&!row.shipment?.deliveredAt&&(row.salesStatus==='READY_TO_SHIP'||row.shippingStatus==='READY'||row.productionStatus==='READY');
export function normalizeOrderListRead(input:OrderListReadQuery){
 const source=normalizeOrderSourceFilter(input.source),page=Number(input.page??1),pageSize=Number(input.pageSize??20),quick=input.quick||'all',status=input.status||'all',discipline=input.discipline||'all',sort=input.sort||'created',direction=input.direction||'desc';
 if(!Number.isSafeInteger(page)||page<1||page>100000||![20,50,100].includes(pageSize)||!QUICK.includes(quick)||!SORT.includes(sort)||!['asc','desc'].includes(direction)||(status!=='all'&&status!=='active'&&!Object.hasOwn(SALES_LABELS,status))||(discipline!=='all'&&!Object.hasOwn(DISCIPLINES,discipline)))throw new BadRequestException('Некорректные фильтры или страница заказов');
 if(input.focusId&&(typeof input.focusId!=='string'||input.focusId.length>200))throw new BadRequestException('Некорректный заказ');
 return {focusId:input.focusId,source,page,pageSize,quick,status,discipline,sort,direction};
}
export function buildOrderListPage<T extends Row>(records:T[],input:OrderListReadQuery,now=new Date()) {
 const q=normalizeOrderListRead(input),unique=[...new Map(records.map(row=>[row.id,row])).values()],base=unique.filter(row=>matchesOrderSource(row.orderSource??'UNKNOWN',q.source));
 const days=(row:T)=>row.requiredDeliveryAt?Math.round((Date.parse(day(row.requiredDeliveryAt))-Date.parse(day(now)))/86400000):9999;
 const test=(row:T,key:string)=>key==='all'||key==='active'&&active(row)||key==='urgent'&&operational(row)&&days(row)>=0&&days(row)<=7||key==='deposit'&&active(row)&&paid(row)===0||key==='depositShortfall'&&active(row)&&paid(row)!==null&&paid(row)!<row.depositRequiredMinor||key==='work'&&operational(row)&&WORK.includes(row.productionStatus)||key==='ready'&&ready(row)||key==='completed'&&row.salesStatus==='COMPLETED'||key==='overdue'&&operational(row)&&days(row)<0;
 const metrics={total:base.length,active:base.filter(active).length,unpaid:base.filter(row=>test(row,'deposit')).length,deposit:base.filter(row=>test(row,'depositShortfall')).length,urgent:base.filter(row=>test(row,'urgent')).length,overdue:base.filter(row=>test(row,'overdue')).length,ready:base.filter(ready).length,completed:base.filter(row=>test(row,'completed')).length,work:base.filter(row=>test(row,'work')).length};
 const sourceCounts=ORDER_SOURCES.map(source=>({source,count:unique.filter(row=>(row.orderSource??'UNKNOWN')===source).length}));
 const rows=base.filter(row=>test(row,q.quick)&&(q.status==='all'||q.status==='active'&&active(row)||q.status===row.salesStatus)&&(q.discipline==='all'||row.discipline===q.discipline));
 const collator=new Intl.Collator('ru',{numeric:true,sensitivity:'base'}),text=(value:DateValue|null|undefined)=>value?new Date(value).toISOString():'';
 const value=(row:T):string|number|null=>{
  if(q.sort==='client')return row.client.displayName;
  if(q.sort==='model')return `${row.items[0]?.name||row.notes||'Дизайн не указан'}|${DISCIPLINES[row.discipline||'']||'Не указан'}`;
  if(q.sort==='quantity')return row.items.reduce((n,item)=>n+(item.quantity??0),0);
  if(q.sort==='deadline')return row.requiredDeliveryAt?new Date(row.requiredDeliveryAt).getTime():null;
  if(q.sort==='payment'){const amount=paid(row);return amount===null?null:Math.max(0,row.priceMinor-amount);}
  if(q.sort==='source')return row.orderSource??'UNKNOWN';
  if(q.sort==='production')return `${text(row.productionSlot?.startsAt)}|${row.productionStatus}`;
  if(q.sort==='status')return SALES_LABELS[row.salesStatus]||row.salesStatus;
  if(q.sort==='delivery'){const country=(row.deliveryAddressSet?row.country:row.country||row.client.country)||'',place=row.deliveryAddressSet?row.deliveryAddressText||[row.deliveryAddressLine1,row.deliveryAddressLine2,row.deliveryCity,row.deliveryRegion,row.deliveryPostalCode,row.country].filter(Boolean).join(', '):[row.client.address,row.client.city,row.client.postalCode,row.country||row.client.country].filter(Boolean).join(', ');return `${country.trim().replace(/^[A-Z]{2}\s+/i,'')||'Адрес не указан'}|${place||'Адрес не указан'}|${SHIPPING_LABELS[row.shippingStatus]||row.shippingStatus}`;}
  return new Date(row.createdAt).getTime();
 };
 rows.sort((a,b)=>{const x=value(a),y=value(b),missing=(z:unknown)=>z===null||z===undefined||z==='';if(missing(x)!==missing(y))return missing(x)?1:-1;const compare=typeof x==='number'&&typeof y==='number'?x-y:collator.compare(String(x??''),String(y??''));return compare*(q.direction==='asc'?1:-1)||collator.compare(a.number,b.number)||collator.compare(a.id,b.id);});
 const total=rows.length,focusIndex=q.focusId?rows.findIndex(row=>row.id===q.focusId):-1,page=focusIndex>=0?Math.floor(focusIndex/q.pageSize)+1:Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize)));
 return {focusFound:!q.focusId||focusIndex>=0,items:rows.slice((page-1)*q.pageSize,page*q.pageSize),total,page,pageSize:q.pageSize,metrics,sources:{total:unique.length,websiteCount:sourceCounts.find(row=>row.source==='WEBSITE')!.count,breakdown:sourceCounts},disciplines:[...new Set(unique.map(row=>row.discipline).filter((x):x is string=>Boolean(x)))]};
}

/** Only fields needed for aggregate facets, eligibility and sorting. No files, measurement values or history. */
export const orderListCandidateSelect={
 compositionOperations:{take:1,select:{id:true}},_count:{select:{items:{where:{archivedAt:{not:null}}}}},
 id:true,number:true,createdAt:true,requiredDeliveryAt:true,discipline:true,notes:true,country:true,deliveryAddressSet:true,deliveryAddressText:true,deliveryAddressLine1:true,deliveryAddressLine2:true,deliveryCity:true,deliveryRegion:true,deliveryPostalCode:true,deliveryTrackingCode:true,
 currency:true,priceMinor:true,depositRequiredMinor:true,salesStatus:true,productionStatus:true,shippingStatus:true,
 client:{select:{displayName:true,country:true,city:true,address:true,postalCode:true}},
 items:{where:{archivedAt:null},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{name:true,quantity:true,instances:{where:{archivedAt:null},select:{id:true,productionStatus:true}}}},
 payments:{where:{voidedAt:null},select:{amountMinor:true,currency:true,appliedAmountMinor:true,appliedCurrency:true}},
 orderShipments:{where:{archivedAt:null},select:{status:true,trackingNumber:true,shippedAt:true,deliveredAt:true,instances:{select:{id:true}}}},
 productionSlot:{select:{startsAt:true}},shipment:{select:{trackingNumber:true,shippedAt:true,deliveredAt:true}},
} satisfies import('@prisma/client').Prisma.OrderSelect;
