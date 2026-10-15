import { CompositionError, compositionToken, type CompositionOrder } from './order-composition';
import { shippingEvidence } from './order-shipping-evidence';

export type DiscountCommand = { mode:'FIXED'|'PERCENT'; value:number };
type DiscountOrder = CompositionOrder & {discountMinor:number};
const nonProduction = new Set(['READY_MODEL','ACCESSORY','WEBSITE_SALE','STOCK_SALE']);
export function planOrderDiscount(order:DiscountOrder,command:DiscountCommand){
  if(!['FIXED','PERCENT'].includes(command.mode)||!Number.isSafeInteger(command.value)||command.value<0)throw new CompositionError('Некорректное значение скидки');
  if(!Number.isSafeInteger(order.priceMinor)||order.priceMinor<0||!Number.isSafeInteger(order.discountMinor)||order.discountMinor<0)throw new CompositionError('Не удалось подтвердить исходную стоимость заказа');
  const base=BigInt(order.priceMinor)+BigInt(order.discountMinor);
  if(command.mode==='PERCENT'&&command.value>10000)throw new CompositionError('Процент скидки должен быть от 0 до 100');
  const discount=command.mode==='FIXED'?BigInt(command.value):(base*BigInt(command.value)+5000n)/10000n;
  const total=base-discount;
  if(discount>base||discount>2147483647n||total<0n||total>2147483647n||base>BigInt(Number.MAX_SAFE_INTEGER))throw new CompositionError('Скидка или итог заказа выходит за допустимый диапазон');
  const totalMinor=Number(total),discountMinor=Number(discount),baseMinor=Number(base);
  const depositRequiredMinor=nonProduction.has(order.type)?Math.min(totalMinor,order.depositRequiredMinor):order.priceMinor<=0?Math.min(totalMinor,Math.max(order.depositRequiredMinor,Math.round(totalMinor/2))):Math.min(totalMinor,Number((total*BigInt(order.depositRequiredMinor)+BigInt(Math.floor(order.priceMinor/2)))/BigInt(order.priceMinor)));
  let paidMinor:number|null=0;
  for(const payment of order.payments.filter(p=>!p.voidedAt)){
    const value=payment.currency===order.currency?payment.amountMinor:payment.appliedCurrency===order.currency?payment.appliedAmountMinor:null;
    if(!Number.isSafeInteger(value)||(value??-1)<0||paidMinor+value!>2147483647){paidMinor=null;break;}paidMinor+=value!;
  }
  const blockers:string[]=[],warnings:string[]=[];
  const dispatch=shippingEvidence({...order,items:order.items.filter(item=>!item.archivedAt).map(item=>({quantity:item.quantity,instances:item.instances.filter(instance=>!instance.archivedAt).map(instance=>({id:instance.id,productionStatus:instance.productionStatus}))}))});
  if(['COMPLETED','CANCELLED','SHIPPED','DELIVERED','REVIEW_REQUESTED'].includes(order.salesStatus)||['SHIPPED','DELIVERED','RETURNED','LOST'].includes(order.shippingStatus)||dispatch.complete)blockers.push('Закрытый или отправленный заказ нельзя изменять через скидку.');
  if(['REFUNDED','CANCELLED'].includes(order.paymentStatus))blockers.push('Изменение скидки недоступно для отменённых или возвращённых оплат.');
  if(paidMinor===null)blockers.push('Не удалось подтвердить сумму полученных оплат в валюте заказа.');
  if(!nonProduction.has(order.type)&&order.productionSlot&&!order.productionSlot.tentative&&totalMinor>order.priceMinor&&(paidMinor===null||paidMinor<depositRequiredMinor))blockers.push('Новая предоплата не покрывает уже подтверждённый производственный слот.');
  const confirmsProductionSlot=Boolean(!nonProduction.has(order.type)&&order.productionSlot?.tentative&&depositRequiredMinor>0&&paidMinor!==null&&paidMinor>=depositRequiredMinor);
  if(order.invoices?.length)warnings.push('Сохранённые инвойсы и документы не пересчитываются задним числом.');
  if(paidMinor!==null&&paidMinor>totalMinor)warnings.push('Возникнет переплата. Автоматический возврат не выполняется.');
  if(order.productionSlot)warnings.push(confirmsProductionSlot?'Предоплата подтвердит предварительный слот по существующим правилам; даты сохраняются.':'Производственный слот и обещанные даты сохраняются.');
  const summary=(totalMinor:number,depositRequiredMinor:number)=>({totalMinor,depositRequiredMinor,paidMinor,balanceMinor:paidMinor===null?null:Math.max(0,totalMinor-paidMinor),overpaymentMinor:paidMinor===null?null:Math.max(0,paidMinor-totalMinor)});
  return {token:compositionToken(order),currency:order.currency,baseMinor,discountMinor,before:summary(order.priceMinor,order.depositRequiredMinor),after:summary(totalMinor,depositRequiredMinor),blockers,warnings,confirmsProductionSlot};
}
