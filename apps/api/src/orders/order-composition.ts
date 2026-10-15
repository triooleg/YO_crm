import { createHash } from 'node:crypto';
import { shippingEvidence, type ShippingEvidence } from './order-shipping-evidence';

export type CompositionCommand = {
  action: 'ADD'|'EDIT'|'DUPLICATE'|'QUANTITY'|'ARCHIVE'; itemId?:string;
  name?:string; quantity?:number; priceMinor?:number; modelImagePath?:string;
  sku?:string|null; notes?:string|null; discipline?:string|null; designNumber?:number|null;
  standardHeight?:number|null; archiveInstanceIds?:string[]; copyAssignments?:boolean;
};
export type CompositionInstance = {
  id:string;ordinal:number;archivedAt?:Date|string|null;athleteId?:string|null;
  measurementId?:string|null;standardHeight?:number|null;productionStatus:string;
  orderShipmentId?:string|null;startedAt?:Date|string|null;completedAt?:Date|string|null;
  plannedStartAt?:Date|string|null;plannedEndAt?:Date|string|null;
};
export type CompositionItem = {
  id:string;name:string;quantity:number;priceMinor:number;archivedAt?:Date|string|null;
  modelImagePath?:string|null;externalImageUrl?:string|null;sku?:string|null;notes?:string|null;
  discipline?:string|null;designNumber?:number|null;instances:CompositionInstance[];
};
export type CompositionOrder = {
  id:string;clientId:string;type:string;currency:string;priceMinor:number;depositRequiredMinor:number;
  salesStatus:string;shippingStatus:string;paymentStatus:string;productionStatus?:string;items:CompositionItem[];
  payments:Array<{id?:string;amountMinor:number;currency:string;appliedAmountMinor?:number|null;appliedCurrency?:string|null;voidedAt?:Date|null}>;
  productionSlot?:{tentative:boolean;locked?:boolean}|null;
  shipment?:{trackingNumber?:string|null;shippedAt?:Date|null;status?:string}|null;
  deliveryTrackingCode?:string|null;invoices?:unknown[];
  orderShipments?:ShippingEvidence['orderShipments'];
};
function canonical(value:unknown):unknown {
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export function compositionToken(value:unknown){return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
export class CompositionError extends Error {}
const productionTypes=new Set(['READY_MODEL','ACCESSORY','WEBSITE_SALE','STOCK_SALE']);
const terminalSales=new Set(['COMPLETED','CANCELLED','SHIPPED','DELIVERED','REVIEW_REQUESTED']);
export function instanceCannotLeaveComposition(instance:CompositionInstance){return Boolean(instance.orderShipmentId||instance.startedAt||instance.completedAt||!['NOT_SCHEDULED','TENTATIVE','SCHEDULED','CANCELLED'].includes(instance.productionStatus));}
function totalPaid(order:CompositionOrder){
  let paid=0;
  for(const p of order.payments.filter(p=>!p.voidedAt)){
    const amount=p.currency===order.currency?p.amountMinor:p.appliedCurrency===order.currency?p.appliedAmountMinor:null;
    if(!Number.isSafeInteger(amount)||(amount??-1)<0)return null;
    paid+=amount!;if(!Number.isSafeInteger(paid)||paid>2_147_483_647)return null;
  }
  return paid;
}
function requiredDeposit(order:CompositionOrder,total:number){
  if(productionTypes.has(order.type))return Math.min(total,order.depositRequiredMinor);
  if(order.priceMinor<=0)return Math.min(total,Math.max(order.depositRequiredMinor,Math.round(total/2)));
  return Math.min(total,Number((BigInt(total)*BigInt(order.depositRequiredMinor)+BigInt(Math.floor(order.priceMinor/2)))/BigInt(order.priceMinor)));
}
export function planOrderComposition(order:CompositionOrder,command:CompositionCommand){
  const blockers:string[]=[],warnings:string[]=[];
  const activeItems=order.items.filter(i=>!i.archivedAt),item=activeItems.find(i=>i.id===command.itemId);
  if(!['ADD','EDIT','DUPLICATE','QUANTITY','ARCHIVE'].includes(command.action))throw new CompositionError('Неизвестная операция состава заказа');
  if(command.action!=='ADD'&&!item)throw new CompositionError('Дизайн не найден в активном составе заказа');
  const creates=command.action==='ADD'||command.action==='DUPLICATE';
  const quantity=command.action==='ARCHIVE'?0:command.quantity??(command.action==='ADD'?1:item!.quantity);
  const priceMinor=command.priceMinor??item?.priceMinor;
  if(!Number.isInteger(quantity)||quantity<0||quantity>1000||(quantity===0&&command.action!=='ARCHIVE'))throw new CompositionError('Количество должно быть от 1 до 1000');
  if(!Number.isSafeInteger(priceMinor)||(priceMinor??-1)<0||priceMinor!>2_147_483_647)throw new CompositionError('Некорректная цена дизайна');
  const name=command.name?.trim()??item?.name;
  if(!name||name.length>300)throw new CompositionError('Укажите название дизайна');
  if(command.action==='QUANTITY'&&command.priceMinor!==undefined&&command.priceMinor!==item!.priceMinor)throw new CompositionError('Изменение количества не должно изменять цену');
  if(command.action==='EDIT'&&quantity!==item!.quantity)throw new CompositionError('Для изменения количества выберите конкретные экземпляры');
  const activeInstances=item?.instances.filter(i=>!i.archivedAt)??[];
  if(item&&activeInstances.length!==item.quantity)blockers.push('Состав экземпляров отличается от количества дизайна. Требуется отдельная проверка данных.');
  let archiveInstanceIds=command.action==='ARCHIVE'?activeInstances.map(i=>i.id):[...(command.archiveInstanceIds??[])];
  const removing=creates?0:Math.max(0,activeInstances.length-quantity);
  if(archiveInstanceIds.length!==new Set(archiveInstanceIds).size||archiveInstanceIds.length!==removing||archiveInstanceIds.some(id=>!activeInstances.some(i=>i.id===id)))blockers.push('Выберите ровно те экземпляры, которые нужно исключить из заказа.');
  if(archiveInstanceIds.some(id=>{const instance=activeInstances.find(i=>i.id===id);return instance&&instanceCannotLeaveComposition(instance);}))blockers.push('Изготовленные, начатые или связанные с отправлением экземпляры нельзя исключить. Сначала используйте процесс отмены.');
  const oldLine=creates?0:item!.quantity*item!.priceMinor,newLine=command.action==='ARCHIVE'?0:quantity*priceMinor!;
  const nextTotal=order.priceMinor-oldLine+newLine;
  if(!Number.isSafeInteger(newLine)||!Number.isSafeInteger(nextTotal)||nextTotal<0||nextTotal>2_147_483_647)throw new CompositionError('Итог заказа выходит за допустимый денежный диапазон');
  const paid=totalPaid(order),nextDeposit=requiredDeposit(order,nextTotal);
  const summary=(total:number,deposit:number,qty:number)=>({quantity:qty,totalMinor:total,depositRequiredMinor:deposit,paidMinor:paid,balanceMinor:paid===null?null:Math.max(0,total-paid),overpaymentMinor:paid===null?null:Math.max(0,paid-total)});
  const quantityBefore=activeItems.reduce((sum,i)=>sum+i.quantity,0),quantityAfter=quantityBefore+(creates?quantity:quantity-item!.quantity);
  const dispatch=shippingEvidence({...order,items:activeItems.map(item=>({quantity:item.quantity,instances:item.instances.filter(instance=>!instance.archivedAt).map(instance=>({id:instance.id,productionStatus:instance.productionStatus}))}))});
  if(terminalSales.has(order.salesStatus)||['SHIPPED','DELIVERED','RETURNED','LOST'].includes(order.shippingStatus)||dispatch.complete)blockers.push('Закрытый или отправленный заказ нельзя изменять через состав.');
  if(['REFUNDED','CANCELLED'].includes(order.paymentStatus))blockers.push('Изменение состава недоступно для отменённых или возвращённых оплат.');
  if(paid===null)blockers.push('Не удалось подтвердить сумму полученных оплат в валюте заказа. Изменение заблокировано.');
  if(order.productionSlot?.locked&&quantityBefore!==quantityAfter)blockers.push('Количество нельзя изменить при закреплённом производственном слоте.');
  if(!productionTypes.has(order.type)&&order.productionSlot&&!order.productionSlot.tentative&&nextTotal>order.priceMinor&&(paid===null||paid<nextDeposit))blockers.push('Новая предоплата не покрывает уже подтверждённый производственный слот.');
  const confirmsProductionSlot=Boolean(!productionTypes.has(order.type)&&order.productionSlot?.tentative&&nextDeposit>0&&paid!==null&&paid>=nextDeposit);
  if(order.productionSlot)warnings.push(confirmsProductionSlot?'Полученная предоплата подтвердит предварительный слот по существующим правилам. Даты и вместимость сохраняются.':'Производственный слот, его вместимость и обещанные даты сохраняются.');
  if(order.invoices?.length)warnings.push('Сохранённые инвойсы и документы не пересчитываются задним числом. Проверьте необходимость нового документа.');
  if(archiveInstanceIds.some(id=>{const i=activeInstances.find(i=>i.id===id);return i?.athleteId||i?.measurementId||i?.plannedStartAt||i?.plannedEndAt;}))warnings.push('Связи исключённых экземпляров со спортсменками, мерками и историей сохранятся в архиве.');
  if(paid!==null&&paid>nextTotal)warnings.push('Возникнет переплата. Автоматический возврат не выполняется.');
  if(command.copyAssignments&&command.action==='DUPLICATE')warnings.push('Назначения копируются только по вашему явному выбору; производство и отправления не копируются.');
  return {token:compositionToken(order),currency:order.currency,before:summary(order.priceMinor,order.depositRequiredMinor,quantityBefore),after:summary(nextTotal,nextDeposit,quantityAfter),blockers,warnings,
    archiveInstanceIds,confirmsProductionSlot,createCount:creates?quantity:Math.max(0,quantity-activeInstances.length),nextOrdinal:(item?.instances??[]).reduce((max,i)=>Math.max(max,i.ordinal),0)+1,
    item,nextItem:{name,quantity,priceMinor:priceMinor!,...(command.sku!==undefined?{sku:command.sku}:{}),...(command.notes!==undefined?{notes:command.notes}:{}),...(command.discipline!==undefined?{discipline:command.discipline}:{}),...(command.designNumber!==undefined?{designNumber:command.designNumber}:{}),...(command.modelImagePath!==undefined?{modelImagePath:command.modelImagePath}:{})}};
}
