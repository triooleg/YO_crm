import { PaymentStatus, type Prisma } from "@prisma/client";
import { updateProductionStatusGraph } from "./production-status-graph";

type InstanceRow = { id:string; ordinal:number; athleteId?:string|null; measurementId?:string|null; productionStatus:string; orderShipmentId?:string|null; plannedStartAt?:Date|null; plannedEndAt?:Date|null; startedAt?:Date|null; completedAt?:Date|null; archivedAt?:Date|null };
type InstanceItem = { id:string; athleteId?:string|null; measurementId?:string|null; productionStatus:string };
type InstanceTransaction = { orderItemInstance:{ findMany(input:unknown):Promise<InstanceRow[]>; create(input:unknown):Promise<unknown>; update(input:unknown):Promise<unknown> } };

export class OrderItemInstanceConflictError extends Error {
  constructor(){super("Нельзя уменьшить количество: экземпляр уже участвует в производстве или доставке")}
}

function hasOperationalHistory(instance:InstanceRow){return Boolean(instance.athleteId||instance.measurementId||instance.orderShipmentId||instance.plannedStartAt||instance.plannedEndAt||instance.startedAt||instance.completedAt||!["NOT_SCHEDULED","TENTATIVE"].includes(instance.productionStatus))}

export async function reconcileOrderItemInstances(tx:InstanceTransaction,item:InstanceItem,quantity:number,now=new Date()){
  if(!Number.isInteger(quantity)||quantity<1)throw new OrderItemInstanceConflictError();
  const existing=await tx.orderItemInstance.findMany({where:{orderItemId:item.id},orderBy:{ordinal:"asc"}});
  const byOrdinal=new Map(existing.map(instance=>[instance.ordinal,instance]));
  const surplus=existing.filter(instance=>instance.ordinal>quantity&&!instance.archivedAt);
  if(surplus.some(hasOperationalHistory))throw new OrderItemInstanceConflictError();
  for(let ordinal=1;ordinal<=quantity;ordinal+=1){
    const current=byOrdinal.get(ordinal);
    if(current){if(current.archivedAt)await tx.orderItemInstance.update({where:{id:current.id},data:{archivedAt:null}});continue}
    await tx.orderItemInstance.create({data:{orderItemId:item.id,ordinal,athleteId:item.athleteId??null,measurementId:item.measurementId??null,productionStatus:item.productionStatus}});
  }
  for(const instance of surplus)await tx.orderItemInstance.update({where:{id:instance.id},data:{archivedAt:now}});
}

export const ORDER_ITEM_DETAILS_ERROR = {
  orderNotFound: "ORDER_ITEM_DETAILS_ORDER_NOT_FOUND",
  itemNotFound: "ORDER_ITEM_DETAILS_ITEM_NOT_FOUND",
  changed: "ORDER_ITEM_DETAILS_CHANGED",
  depositWouldUnconfirmProduction: "ORDER_ITEM_DETAILS_DEPOSIT_WOULD_UNCONFIRM_PRODUCTION",
  totalTooLarge: "ORDER_ITEM_DETAILS_TOTAL_TOO_LARGE",
  athleteNotFound: "ORDER_ITEM_DETAILS_ATHLETE_NOT_FOUND",
  instanceInUse: "ORDER_ITEM_DETAILS_INSTANCE_IN_USE",
} as const;

type Input={name:string;quantity:number;priceMinor:number;expectedName:string;expectedQuantity:number;expectedPriceMinor:number;modelImagePath?:string;expectedModelImagePath:string|null;designNumber?:number|null;expectedDesignNumber?:number|null};
type AddInput={name:string;quantity:number;priceMinor:number;modelImagePath?:string;designNumber?:number|null;athleteId?:string};
export class OrderItemDetailsError extends Error { readonly code:(typeof ORDER_ITEM_DETAILS_ERROR)[keyof typeof ORDER_ITEM_DETAILS_ERROR]; constructor(code:(typeof ORDER_ITEM_DETAILS_ERROR)[keyof typeof ORDER_ITEM_DETAILS_ERROR]){super(code);this.code=code} }
function paidMinor(payment:{amountMinor:number;currency:string;appliedAmountMinor?:number|null;appliedCurrency?:string|null},currency:string){return payment.appliedCurrency===currency&&payment.appliedAmountMinor!=null?payment.appliedAmountMinor:payment.currency===currency?payment.amountMinor:0}
function proportionalDeposit(total:number,deposit:number,next:number){if(total<=0)return Math.min(next,Math.max(deposit,Math.round(next/2)));return Math.min(next,Number((BigInt(next)*BigInt(deposit)+BigInt(Math.floor(total/2)))/BigInt(total)))}
function itemRequiresProduction(type:string){return !["READY_MODEL","ACCESSORY","WEBSITE_SALE","STOCK_SALE"].includes(type)}

export async function persistOrderItemDetails(tx:Prisma.TransactionClient,orderId:string,itemId:string,input:Input,actorId:string){
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",orderId);
  const order=await tx.order.findFirst({where:{id:orderId,archivedAt:null},include:{items:{orderBy:[{createdAt:"asc"},{id:"asc"}]},payments:{where:{voidedAt:null}},productionSlot:true}});
  if(!order)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.orderNotFound);
  const item=order.items.find(candidate=>candidate.id===itemId);
  if(!item)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.itemNotFound);
  if(input.designNumber!==undefined&&input.expectedDesignNumber===undefined)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.changed);
  if(item.name!==input.expectedName||item.quantity!==input.expectedQuantity||item.priceMinor!==input.expectedPriceMinor||(item.modelImagePath??null)!==input.expectedModelImagePath||(input.expectedDesignNumber!==undefined&&(item.designNumber??null)!==input.expectedDesignNumber))throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.changed);
  const name=input.name.trim();
  if(!name)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.changed);
  const oldLine=item.priceMinor*item.quantity,nextLine=input.priceMinor*input.quantity,nextTotal=Math.max(0,order.priceMinor-oldLine+nextLine);
  if(!Number.isSafeInteger(nextLine)||nextTotal>2_147_483_647)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.totalTooLarge);
  const depositRequiredMinor=proportionalDeposit(order.priceMinor,order.depositRequiredMinor,nextTotal),paid=order.payments.reduce((sum,payment)=>sum+paidMinor(payment,order.currency),0);
  if(itemRequiresProduction(order.type)&&order.productionSlot&&!order.productionSlot.tentative&&nextTotal>order.priceMinor&&paid<depositRequiredMinor)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.depositWouldUnconfirmProduction);
  const paymentStatus=order.paymentStatus===PaymentStatus.REFUNDED||order.paymentStatus===PaymentStatus.CANCELLED?order.paymentStatus:paid===0?PaymentStatus.UNPAID:paid>=nextTotal?PaymentStatus.PAID:paid>=depositRequiredMinor?PaymentStatus.DEPOSIT_PAID:PaymentStatus.PARTIALLY_PAID;
  const terminalPaymentStatus=order.paymentStatus===PaymentStatus.REFUNDED||order.paymentStatus===PaymentStatus.CANCELLED;
  const confirmsProductionSlot=Boolean(itemRequiresProduction(order.type)&&!terminalPaymentStatus&&order.productionSlot?.tentative&&depositRequiredMinor>0&&paid>=depositRequiredMinor);
  try {
    await reconcileOrderItemInstances(tx, item, input.quantity);
  } catch (error) {
    if (error instanceof OrderItemInstanceConflictError) throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.instanceInUse);
    throw error;
  }
  const updatedItem=await tx.orderItem.update({where:{id:itemId},data:{name,quantity:input.quantity,priceMinor:input.priceMinor,...(input.modelImagePath?{modelImagePath:input.modelImagePath}:{}),...(input.designNumber!==undefined?{designNumber:input.designNumber}:{})}});
  const isPrimary=order.items[0]?.id===itemId;
  const orderData={priceMinor:nextTotal,depositRequiredMinor,paymentStatus,...(isPrimary&&input.modelImagePath?{modelImagePath:input.modelImagePath}:{})};
  const updatedOrder=confirmsProductionSlot&&order.productionStatus==="NOT_SCHEDULED"
    ?await updateProductionStatusGraph(tx,orderId,"SCHEDULED",orderData,{preserveProgress:true})
    :await tx.order.update({where:{id:orderId},data:orderData});
  if(confirmsProductionSlot&&order.productionSlot){const slot=await tx.productionSlot.update({where:{orderId},data:{tentative:false}});await tx.auditLog.create({data:{actorId,action:"UPDATE",entityType:"ProductionSlot",entityId:slot.id,before:order.productionSlot,after:slot}});await tx.activity.create({data:{clientId:order.clientId,orderId,type:"PRODUCTION_SLOT_CONFIRMED",summary:"Производственный слот подтверждён после изменения дизайна",metadata:{itemId,depositRequiredMinor,paidMinor:paid,currency:order.currency}}})}
  await tx.activity.create({data:{clientId:order.clientId,orderId,type:"ORDER_ITEM_DETAILS_UPDATED",summary:`Изменён дизайн «${name}»`,metadata:{itemId,name,quantity:input.quantity,priceMinor:input.priceMinor,designNumber:input.designNumber,orderPriceMinor:nextTotal,manualOverride:true}}});
  await tx.auditLog.create({data:{actorId,action:"UPDATE",entityType:"OrderItem",entityId:itemId,before:item,after:updatedItem}});
  await tx.auditLog.create({data:{actorId,action:"UPDATE",entityType:"Order",entityId:orderId,before:{priceMinor:order.priceMinor,depositRequiredMinor:order.depositRequiredMinor,paymentStatus:order.paymentStatus,modelImagePath:order.modelImagePath},after:{priceMinor:updatedOrder.priceMinor,depositRequiredMinor:updatedOrder.depositRequiredMinor,paymentStatus:updatedOrder.paymentStatus,modelImagePath:updatedOrder.modelImagePath}}});
  return updatedItem;
}

export async function persistAddedOrderItem(tx:Prisma.TransactionClient,orderId:string,input:AddInput,actorId:string){
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",orderId);
  const order=await tx.order.findFirst({where:{id:orderId,archivedAt:null},include:{items:{select:{athleteId:true}},payments:{where:{voidedAt:null}},productionSlot:true}});
  if(!order)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.orderNotFound);
  const name=input.name.trim();
  if(!name)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.changed);
  const existingAthleteIds=[...new Set(order.items.map(item=>item.athleteId).filter((value):value is string=>Boolean(value)))];
  const athleteId=input.athleteId??(existingAthleteIds.length===1?existingAthleteIds[0]:undefined);
  if(athleteId&&!await tx.athlete.findFirst({where:{id:athleteId,clientId:order.clientId,archivedAt:null},select:{id:true}}))throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.athleteNotFound);
  const line=input.priceMinor*input.quantity,nextTotal=order.priceMinor+line;
  if(!Number.isSafeInteger(line)||nextTotal>2_147_483_647)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.totalTooLarge);
  const depositRequiredMinor=itemRequiresProduction(order.type)?proportionalDeposit(order.priceMinor,order.depositRequiredMinor,nextTotal):Math.min(order.depositRequiredMinor,nextTotal),paid=order.payments.reduce((sum,payment)=>sum+paidMinor(payment,order.currency),0);
  if(itemRequiresProduction(order.type)&&order.productionSlot&&!order.productionSlot.tentative&&paid<depositRequiredMinor)throw new OrderItemDetailsError(ORDER_ITEM_DETAILS_ERROR.depositWouldUnconfirmProduction);
  const paymentStatus=order.paymentStatus===PaymentStatus.REFUNDED||order.paymentStatus===PaymentStatus.CANCELLED?order.paymentStatus:paid===0?PaymentStatus.UNPAID:paid>=nextTotal?PaymentStatus.PAID:paid>=depositRequiredMinor?PaymentStatus.DEPOSIT_PAID:PaymentStatus.PARTIALLY_PAID;
  const item=await tx.orderItem.create({data:{orderId,name,quantity:input.quantity,priceMinor:input.priceMinor,modelImagePath:input.modelImagePath,designNumber:input.designNumber,athleteId}});
  await reconcileOrderItemInstances(tx, item, item.quantity);
  const updatedOrder=await tx.order.update({where:{id:orderId},data:{priceMinor:nextTotal,depositRequiredMinor,paymentStatus}});
  await tx.activity.create({data:{clientId:order.clientId,orderId,type:"ORDER_ITEM_CREATED",summary:`Добавлен дизайн «${item.name}»`,metadata:{itemId:item.id,quantity:item.quantity,priceMinor:item.priceMinor,designNumber:item.designNumber,orderPriceMinor:nextTotal}}});
  await tx.auditLog.create({data:{actorId,action:"CREATE",entityType:"OrderItem",entityId:item.id,after:item}});
  await tx.auditLog.create({data:{actorId,action:"UPDATE",entityType:"Order",entityId:orderId,before:{priceMinor:order.priceMinor,depositRequiredMinor:order.depositRequiredMinor,paymentStatus:order.paymentStatus},after:{priceMinor:updatedOrder.priceMinor,depositRequiredMinor:updatedOrder.depositRequiredMinor,paymentStatus:updatedOrder.paymentStatus}}});
  return item;
}
