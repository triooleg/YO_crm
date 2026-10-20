import { ConflictException } from '@nestjs/common';
import { PARENT_BODY_DEFINITION } from '../clients/measurement-data';
import type { Prisma } from '@prisma/client';
import { parcelHasDispatchEvidence, shippingEvidence, type ShippingEvidence } from './order-shipping-evidence';

// A parent partial-dispatch aggregate does not freeze the pending child cohort.
export const assignmentOrderSelect = {
  clientId:true,salesStatus:true,shippingStatus:true,deliveryTrackingCode:true,
  shipment:{select:{trackingNumber:true,shippedAt:true,deliveredAt:true}},
  orderShipments:{where:{archivedAt:null},take:1,select:{id:true}},
} as const satisfies Prisma.OrderSelect;
type AssignmentTarget={productionStatus?:string;startedAt?:Date|null;completedAt?:Date|null;orderShipment?:ShippingEvidence['shipment']};
export function assertAssignmentMutable(order:ShippingEvidence,target:AssignmentTarget){
  if(shippingEvidence(order).complete||['COMPLETED','CANCELLED','REVIEW_REQUESTED'].includes(order.salesStatus??'')||['READY','CANCELLED'].includes(target.productionStatus??'')||target.completedAt||target.orderShipment&&parcelHasDispatchEvidence(target.orderShipment))throw new ConflictException('Нельзя менять назначение изготовленного, отправленного или завершённого изделия');
}
/** Validate the exact legacy propagation cohort before creating a new snapshot or any write. */
export async function assertItemAssignmentMutable(tx:Prisma.TransactionClient,orderId:string,item:{id:string;athleteId:string|null;measurementId:string|null;productionStatus:string;startedAt?:Date|null},newDefinition?:string|null){
  const order=await tx.order.findFirst({where:{id:orderId,archivedAt:null},select:assignmentOrderSelect});
  if(!order)throw new ConflictException('Заказ не найден');
  assertAssignmentMutable(order,item);
  const targets=await tx.orderItemInstance.findMany({where:{orderItemId:item.id,archivedAt:null,athleteId:item.athleteId,measurementId:item.measurementId,orderItem:{archivedAt:null}},include:{orderShipment:true}});
  for(const target of targets)assertAssignmentMutable(order,target);
  await assertParentBodyProductionChange(tx,item,newDefinition,true);
  for(const target of targets)await assertParentBodyProductionChange(tx,target,newDefinition,true);
}

/** Semantics come from persisted snapshots; status is always the pre-mutation state. */
export async function assertParentBodyProductionChange(
  tx: Prisma.TransactionClient,
  target: AssignmentTarget & {measurementId?:string|null},
  newDefinition: string|null|undefined,
  linkageChanged: boolean,
  confirmation?: {confirmProduction?:boolean;reason?:string},
) {
  if (!linkageChanged || !(target.startedAt || !['NOT_SCHEDULED','TENTATIVE','SCHEDULED'].includes(target.productionStatus ?? 'NOT_SCHEDULED'))) return null;
  const oldSnapshot = target.measurementId ? await tx.measurement.findFirst({where:{id:target.measurementId},select:{definitionVersion:true}}) : null;
  if (oldSnapshot?.definitionVersion !== PARENT_BODY_DEFINITION && newDefinition !== PARENT_BODY_DEFINITION) return null;
  if (!confirmation) throw new ConflictException('Мерки начатого производства меняются только через явное назначение экземпляров с подтверждением и причиной');
  if (confirmation.confirmProduction !== true || typeof confirmation.reason !== 'string' || !confirmation.reason.trim() || confirmation.reason.length > 2000) throw new ConflictException('Подтвердите изменение мерок начатого производства и укажите причину (до 2000 символов)');
  return {confirmProduction:true,reason:confirmation.reason.trim()};
}
