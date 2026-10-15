import type {Prisma} from '@prisma/client';
import {CompositionError,compositionToken} from './order-composition';
import {lockComposition,readComposition} from './order-composition-write';
import {planOrderDiscount,type DiscountCommand} from './order-discount';
import {updateProductionStatusGraph} from './production-status-graph';
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function applyOrderDiscount(tx:Prisma.TransactionClient,orderId:string,command:DiscountCommand,expectedToken:string,operationKey:string,actorId:string){
  await lockComposition(tx,orderId);
  const requestHash=compositionToken({namespace:'DISCOUNT',command,actorId});
  const previous=await tx.orderCompositionOperation.findUnique({where:{orderId_operationKey:{orderId,operationKey}}});
  if(previous){if(previous.requestHash!==requestHash)throw new CompositionError('Ключ операции уже использован для другого изменения');return {operationId:previous.id,...previous.result as object};}
  const order=await readComposition(tx,orderId);
  if(!order||order.client.archivedAt)throw new CompositionError('Заказ или клиент не найден');
  if(compositionToken(order)!==expectedToken)throw new CompositionError('Заказ изменён другим пользователем. Проверьте новый предварительный расчёт.');
  const plan=planOrderDiscount(order,command);
  if(plan.blockers.length)throw new CompositionError(plan.blockers.join(' '));
  const before={discountMinor:order.discountMinor,priceMinor:order.priceMinor,depositRequiredMinor:order.depositRequiredMinor,paymentStatus:order.paymentStatus,productionStatus:order.productionStatus};
  let after=before;
  if(plan.discountMinor!==order.discountMinor){
    const paid=plan.after.paidMinor!;
    const paymentStatus=paid===0?'UNPAID':paid>=plan.after.totalMinor?'PAID':paid>=plan.after.depositRequiredMinor?'DEPOSIT_PAID':'PARTIALLY_PAID';
    const data={discountMinor:plan.discountMinor,priceMinor:plan.after.totalMinor,depositRequiredMinor:plan.after.depositRequiredMinor,paymentStatus} as const;
    const updated=plan.confirmsProductionSlot&&order.productionStatus==='NOT_SCHEDULED'
      ?await updateProductionStatusGraph(tx,orderId,'SCHEDULED',data,{preserveProgress:true})
      :await tx.order.update({where:{id:orderId},data});
    after={discountMinor:updated.discountMinor,priceMinor:updated.priceMinor,depositRequiredMinor:updated.depositRequiredMinor,paymentStatus:updated.paymentStatus,productionStatus:updated.productionStatus};
    if(plan.confirmsProductionSlot){
      const slot=await tx.productionSlot.update({where:{orderId},data:{tentative:false}});
      await tx.auditLog.create({data:{actorId,action:'UPDATE',entityType:'ProductionSlot',entityId:slot.id,before:json(order.productionSlot),after:json(slot)}});
      await tx.activity.create({data:{actorId,clientId:order.clientId,orderId,type:'PRODUCTION_SLOT_CONFIRMED',summary:'Производственный слот подтверждён после изменения скидки',metadata:{depositRequiredMinor:plan.after.depositRequiredMinor,paidMinor:paid,currency:order.currency}}});
    }
  }
  // An explicit same-value save is still manual intent; retries return before history creation.
  await tx.activity.create({data:{actorId,clientId:order.clientId,orderId,type:'ORDER_DISCOUNT_UPDATED',summary:'Сохранена скидка заказа',metadata:json({manualDiscount:true,command,baseMinor:plan.baseMinor,before:{...plan.before,discountMinor:order.discountMinor},after:{...plan.after,discountMinor:plan.discountMinor},currency:order.currency})}});
  await tx.auditLog.create({data:{actorId,action:'UPDATE',entityType:'Order',entityId:orderId,before:json(before),after:json(after)}});
  const result={discountMinor:plan.discountMinor,totalMinor:plan.after.totalMinor};
  const operation=await tx.orderCompositionOperation.create({data:{orderId,actorId,operationKey,requestHash,result}});
  return {operationId:operation.id,...result};
}
