import { PaymentStatus, type Prisma } from "@prisma/client";

export const ORDER_ITEM_DETAILS_ERROR = {
  orderNotFound: "ORDER_ITEM_DETAILS_ORDER_NOT_FOUND",
  itemNotFound: "ORDER_ITEM_DETAILS_ITEM_NOT_FOUND",
  changed: "ORDER_ITEM_DETAILS_CHANGED",
  depositWouldUnconfirmProduction: "ORDER_ITEM_DETAILS_DEPOSIT_WOULD_UNCONFIRM_PRODUCTION",
  totalTooLarge: "ORDER_ITEM_DETAILS_TOTAL_TOO_LARGE",
} as const;

type Input={name:string;quantity:number;priceMinor:number;expectedName:string;expectedQuantity:number;expectedPriceMinor:number;modelImagePath?:string;expectedModelImagePath:string|null};
export class OrderItemDetailsError extends Error { readonly code:(typeof ORDER_ITEM_DETAILS_ERROR)[keyof typeof ORDER_ITEM_DETAILS_ERROR]; constructor(code:(typeof ORDER_ITEM_DETAILS_ERROR)[keyof typeof ORDER_ITEM_DETAILS_ERROR]){super(code);this.code=code} }
function paidMinor(payment:{amountMinor:number;currency:string;appliedAmountMinor?:number|null;appliedCurrency?:string|null},currency:string){return payment.appliedCurrency===currency&&payment.appliedAmountMinor!=null?payment.appliedAmountMinor:payment.currency===currency?payment.amountMinor:0}
function proportionalDeposit(total:number,deposit:number,next:number){if(total<=0)return Math.min(deposit,next);return Math.min(next,Number((BigInt(next)*BigInt(deposit)+BigInt(Math.floor(total/2)))/BigInt(total)))}
function itemRequiresProduction(type:string){return !["READY_MODEL","ACCESSORY","WEBSITE_SALE","STOCK_SALE"].includes(type)}

export async function persistOrderItemDetails(tx:Prisma.TransactionClient,orderId:string,itemId:string,input:Input,actorId:string){
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",orderId);
  const order=await tx.order.findFirst({where:{id:orderId,archivedAt:null},include:{items:{orderBy:[{createdAt:"asc"},{id:"asc"}]},payments:{where:{voidedAt:null}},productionSlot:true}});
  if(!order)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.orderNotFound);
  const item=order.items.find(candidate=>candidate.id===itemId);
  if(!item)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.itemNotFound);
  if(item.name!==input.expectedName||item.quantity!==input.expectedQuantity||item.priceMinor!==input.expectedPriceMinor||(item.modelImagePath??null)!==input.expectedModelImagePath)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.changed);
  const name=input.name.trim();
  if(!name)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.changed);
  const oldLine=item.priceMinor*item.quantity,nextLine=input.priceMinor*input.quantity,nextTotal=Math.max(0,order.priceMinor-oldLine+nextLine);
  if(!Number.isSafeInteger(nextLine)||nextTotal>2_147_483_647)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.totalTooLarge);
  const depositRequiredMinor=proportionalDeposit(order.priceMinor,order.depositRequiredMinor,nextTotal),paid=order.payments.reduce((sum,payment)=>sum+paidMinor(payment,order.currency),0);
  if(itemRequiresProduction(order.type)&&order.productionSlot&&!order.productionSlot.tentative&&nextTotal>order.priceMinor&&paid<depositRequiredMinor)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.depositWouldUnconfirmProduction);
  const paymentStatus=order.paymentStatus===PaymentStatus.REFUNDED||order.paymentStatus===PaymentStatus.CANCELLED?order.paymentStatus:paid===0?PaymentStatus.UNPAID:paid>=nextTotal?PaymentStatus.PAID:paid>=depositRequiredMinor?PaymentStatus.DEPOSIT_PAID:PaymentStatus.PARTIALLY_PAID;
  const terminalPaymentStatus=order.paymentStatus===PaymentStatus.REFUNDED||order.paymentStatus===PaymentStatus.CANCELLED;
  const confirmsProductionSlot=Boolean(itemRequiresProduction(order.type)&&!terminalPaymentStatus&&order.productionSlot?.tentative&&depositRequiredMinor>0&&paid>=depositRequiredMinor);
  const updatedItem=await tx.orderItem.update({where:{id:itemId},data:{name,quantity:input.quantity,priceMinor:input.priceMinor,...(input.modelImagePath?{modelImagePath:input.modelImagePath}:{})}});
  const isPrimary=order.items[0]?.id===itemId;
  const updatedOrder=await tx.order.update({where:{id:orderId},data:{priceMinor:nextTotal,depositRequiredMinor,paymentStatus,...(confirmsProductionSlot&&order.productionStatus==="NOT_SCHEDULED"?{productionStatus:"SCHEDULED"}:{}),...(isPrimary&&input.modelImagePath?{modelImagePath:input.modelImagePath}:{})}});
  if(confirmsProductionSlot&&order.productionSlot){const slot=await tx.productionSlot.update({where:{orderId},data:{tentative:false}});await tx.auditLog.create({data:{actorId,action:"UPDATE",entityType:"ProductionSlot",entityId:slot.id,before:order.productionSlot,after:slot}});await tx.activity.create({data:{clientId:order.clientId,orderId,type:"PRODUCTION_SLOT_CONFIRMED",summary:"Производственный слот подтверждён после изменения дизайна",metadata:{itemId,depositRequiredMinor,paidMinor:paid,currency:order.currency}}})}
  await tx.activity.create({data:{clientId:order.clientId,orderId,type:"ORDER_ITEM_DETAILS_UPDATED",summary:`Изменён дизайн «${name}»`,metadata:{itemId,name,quantity:input.quantity,priceMinor:input.priceMinor,orderPriceMinor:nextTotal,manualOverride:true}}});
  await tx.auditLog.create({data:{actorId,action:"UPDATE",entityType:"OrderItem",entityId:itemId,before:item,after:updatedItem}});
  await tx.auditLog.create({data:{actorId,action:"UPDATE",entityType:"Order",entityId:orderId,before:{priceMinor:order.priceMinor,depositRequiredMinor:order.depositRequiredMinor,paymentStatus:order.paymentStatus,modelImagePath:order.modelImagePath},after:{priceMinor:updatedOrder.priceMinor,depositRequiredMinor:updatedOrder.depositRequiredMinor,paymentStatus:updatedOrder.paymentStatus,modelImagePath:updatedOrder.modelImagePath}}});
  return updatedItem;
}
