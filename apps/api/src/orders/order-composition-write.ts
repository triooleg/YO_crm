import type { Discipline, Prisma } from '@prisma/client';
import { CompositionError, compositionToken, planOrderComposition, type CompositionCommand } from './order-composition';
import { isOrderImageName } from './order-image-name';
import { aggregateProductionStatus, updateProductionStatusGraph } from './production-status-graph';

// All commands, including retries, follow the existing client-merge/order lock protocol.
export async function readComposition(tx:Prisma.TransactionClient,orderId:string){
  return tx.order.findFirst({where:{id:orderId,archivedAt:null},include:{
    client:{select:{id:true,archivedAt:true,updatedAt:true}},
    items:{orderBy:[{createdAt:'asc'},{id:'asc'}],include:{instances:{orderBy:{ordinal:'asc'}},files:{select:{id:true}},structuredNotes:{select:{id:true,updatedAt:true}}}},
    payments:{where:{voidedAt:null},orderBy:{id:'asc'}},productionSlot:true,shipment:true,
    orderShipments:{where:{archivedAt:null},orderBy:{id:'asc'},include:{instances:{select:{id:true,updatedAt:true}}}},
    invoices:{orderBy:{id:'asc'},select:{id:true,status:true,updatedAt:true}}
  }});
}
export async function lockComposition(tx:Prisma.TransactionClient,orderId:string){
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge-global"},0))`;
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',orderId);
  const owner=await tx.order.findFirst({where:{id:orderId,archivedAt:null},select:{clientId:true}});
  if(!owner)throw new CompositionError('Заказ не найден');
  await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${owner.clientId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
}
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function applyOrderComposition(tx:Prisma.TransactionClient,orderId:string,command:CompositionCommand,expectedToken:string,operationKey:string,actorId:string){
  await lockComposition(tx,orderId);
  const hash=compositionToken({command,actorId});
  const previous=await tx.orderCompositionOperation.findUnique({where:{orderId_operationKey:{orderId,operationKey}}});
  if(previous){if(previous.requestHash!==hash)throw new CompositionError('Ключ операции уже использован для другого изменения');return {operationId:previous.id,...previous.result as object};}
  const order=await readComposition(tx,orderId);
  if(!order||order.client.archivedAt)throw new CompositionError('Заказ или клиент не найден');
  if(compositionToken(order)!==expectedToken)throw new CompositionError('Заказ изменён другим пользователем. Проверьте новый предварительный расчёт.');
  const plan=planOrderComposition(order,command);
  if(plan.blockers.length)throw new CompositionError(plan.blockers.join(' '));
  if(command.modelImagePath&&!isOrderImageName(command.modelImagePath))throw new CompositionError('Недопустимое изображение дизайна');
  let itemId=plan.item?.id;
  const creates=command.action==='ADD'||command.action==='DUPLICATE';
  if(creates){
    const source=command.action==='DUPLICATE'?plan.item:undefined;
    const created=await tx.orderItem.create({data:{orderId,
      ...(source?{modelImagePath:source.modelImagePath,externalImageUrl:source.externalImageUrl,sku:source.sku,notes:source.notes,discipline:source.discipline as Discipline|null,designNumber:source.designNumber}:{}),
      ...plan.nextItem,discipline:(plan.nextItem.discipline!==undefined?plan.nextItem.discipline:source?.discipline) as Discipline|null|undefined,
      athleteId:null,measurementId:null,productionStatus:'NOT_SCHEDULED'
    }});itemId=created.id;
  }else if(command.action==='ARCHIVE'){
    await tx.orderItem.update({where:{id:itemId!},data:{archivedAt:new Date()}});
  }else{
    await tx.orderItem.update({where:{id:itemId!},data:{...plan.nextItem,discipline:plan.nextItem.discipline as Discipline|undefined}});
  }
  if(plan.archiveInstanceIds.length)await tx.orderItemInstance.updateMany({where:{id:{in:plan.archiveInstanceIds},orderItemId:itemId,archivedAt:null},data:{archivedAt:new Date()}});
  const copied=command.action==='DUPLICATE'&&command.copyAssignments?plan.item!.instances.filter(i=>!i.archivedAt):[];
  if(copied.length){
    for(const instance of copied){
      if(instance.athleteId&&!await tx.athlete.findFirst({where:{id:instance.athleteId,clientId:order.clientId,archivedAt:null},select:{id:true}}))throw new CompositionError('Нельзя скопировать назначение архивной или чужой спортсменки');
      if(instance.measurementId&&(!instance.athleteId||!await tx.measurement.findFirst({where:{id:instance.measurementId,athleteId:instance.athleteId,archivedAt:null},select:{id:true}})))throw new CompositionError('Нельзя скопировать архивную или чужую версию мерок');
    }
  }
  if(plan.createCount)await tx.orderItemInstance.createMany({data:Array.from({length:plan.createCount},(_,index)=>({
    orderItemId:itemId!,ordinal:creates?index+1:plan.nextOrdinal+index,productionStatus:'NOT_SCHEDULED',
    athleteId:copied[index]?.athleteId??null,measurementId:copied[index]?.measurementId??null,
    standardHeight:command.standardHeight??copied[index]?.standardHeight??null
  }))});
  let productionBeforeConfirmation=order.productionStatus;
  if(plan.createCount||plan.archiveInstanceIds.length){
    const fresh=await readComposition(tx,orderId);
    if(!fresh)throw new CompositionError('Заказ не найден');
    const active=fresh.items.filter(i=>!i.archivedAt);
    for(const current of active.filter(i=>i.id===itemId)){
      if(!['ON_HOLD','CANCELLED'].includes(current.productionStatus))await tx.orderItem.update({where:{id:current.id},data:{productionStatus:aggregateProductionStatus(current.instances.filter(i=>!i.archivedAt).map(i=>i.productionStatus))}});
    }
    if(!['ON_HOLD','CANCELLED'].includes(order.productionStatus)){
      productionBeforeConfirmation=aggregateProductionStatus(active.flatMap(item=>{const instances=item.instances.filter(instance=>!instance.archivedAt);return instances.length?instances.map(instance=>instance.productionStatus):[item.productionStatus];}));
      await tx.order.update({where:{id:orderId},data:{productionStatus:productionBeforeConfirmation}});
    }
  }
  const paid=plan.after.paidMinor!;
  const paymentStatus=paid===0?'UNPAID':paid>=plan.after.totalMinor?'PAID':paid>=plan.after.depositRequiredMinor?'DEPOSIT_PAID':'PARTIALLY_PAID';
  const oldPrimary=order.items.find(item=>!item.archivedAt);
  const imageChange=command.action==='EDIT'&&oldPrimary?.id===itemId&&command.modelImagePath!==undefined
    ?{modelImagePath:command.modelImagePath}
    :command.action==='ARCHIVE'&&oldPrimary?.id===itemId
      ?{modelImagePath:order.items.find(item=>!item.archivedAt&&item.id!==itemId)?.modelImagePath??null,externalImageUrl:order.items.find(item=>!item.archivedAt&&item.id!==itemId)?.externalImageUrl??null}
      :creates&&!oldPrimary?{modelImagePath:plan.nextItem.modelImagePath??null,externalImageUrl:null}:{};
  const orderData={priceMinor:plan.after.totalMinor,depositRequiredMinor:plan.after.depositRequiredMinor,paymentStatus,...imageChange} as const;
  const updatedOrder=plan.confirmsProductionSlot&&productionBeforeConfirmation==='NOT_SCHEDULED'
    ?await updateProductionStatusGraph(tx,orderId,'SCHEDULED',orderData,{preserveProgress:true})
    :await tx.order.update({where:{id:orderId},data:orderData});
  if(plan.confirmsProductionSlot){
    const slot=await tx.productionSlot.update({where:{orderId},data:{tentative:false}});
    await tx.auditLog.create({data:{actorId,action:'UPDATE',entityType:'ProductionSlot',entityId:slot.id,before:json(order.productionSlot),after:json(slot)}});
    await tx.activity.create({data:{clientId:order.clientId,orderId,actorId,type:'PRODUCTION_SLOT_CONFIRMED',summary:'Производственный слот подтверждён после изменения состава',metadata:json({itemId,depositRequiredMinor:plan.after.depositRequiredMinor,paidMinor:paid,currency:order.currency})}});
  }
  // Never clear/reseed slots, change promised dates, or rewrite invoices/payments.
  const afterItem=await tx.orderItem.findUniqueOrThrow({where:{id:itemId!},include:{instances:{orderBy:{ordinal:'asc'}}}});
  await tx.activity.create({data:{clientId:order.clientId,orderId,actorId,type:'ORDER_ITEM_DETAILS_UPDATED',summary:`Изменён состав заказа: ${afterItem.name}`,metadata:json({itemId,manualOverride:true,composition:true,action:command.action,before:plan.before,after:plan.after,archivedInstanceIds:plan.archiveInstanceIds,copyAssignments:command.copyAssignments===true})}});
  await tx.auditLog.create({data:{actorId,action:command.action==='ARCHIVE'?'ARCHIVE':creates?'CREATE':'UPDATE',entityType:'OrderItem',entityId:itemId!,before:plan.item?json(plan.item):undefined,after:json(afterItem)}});
  await tx.auditLog.create({data:{actorId,action:'UPDATE',entityType:'Order',entityId:orderId,before:json({...plan.before,productionStatus:order.productionStatus,modelImagePath:order.modelImagePath}),after:json({...plan.after,paymentStatus,productionStatus:updatedOrder.productionStatus,modelImagePath:updatedOrder.modelImagePath})}});
  const result={itemId:itemId!,action:command.action,archivedInstanceIds:plan.archiveInstanceIds};
  const operation=await tx.orderCompositionOperation.create({data:{orderId,actorId,operationKey,requestHash:hash,result}});
  return {operationId:operation.id,...result};
}
