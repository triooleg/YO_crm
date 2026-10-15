import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { parcelHasDispatchEvidence, shippingEvidence, type ShippingEvidence } from './order-shipping-evidence';

// A parent partial-dispatch aggregate does not freeze the pending child cohort.
export const assignmentOrderSelect = {
  clientId:true,salesStatus:true,shippingStatus:true,deliveryTrackingCode:true,
  shipment:{select:{trackingNumber:true,shippedAt:true,deliveredAt:true}},
  orderShipments:{where:{archivedAt:null},take:1,select:{id:true}},
} as const satisfies Prisma.OrderSelect;
type AssignmentTarget={productionStatus?:string;completedAt?:Date|null;orderShipment?:ShippingEvidence['shipment']};
export function assertAssignmentMutable(order:ShippingEvidence,target:AssignmentTarget){
  if(shippingEvidence(order).complete||['COMPLETED','CANCELLED','REVIEW_REQUESTED'].includes(order.salesStatus??'')||['READY','CANCELLED'].includes(target.productionStatus??'')||target.completedAt||target.orderShipment&&parcelHasDispatchEvidence(target.orderShipment))throw new ConflictException('Нельзя менять назначение изготовленного, отправленного или завершённого изделия');
}
/** Validate the exact legacy propagation cohort before creating a new snapshot or any write. */
export async function assertItemAssignmentMutable(tx:Prisma.TransactionClient,orderId:string,item:{id:string;athleteId:string|null;measurementId:string|null;productionStatus:string}){
  const order=await tx.order.findFirst({where:{id:orderId,archivedAt:null},select:assignmentOrderSelect});
  if(!order)throw new ConflictException('Заказ не найден');
  assertAssignmentMutable(order,item);
  const targets=await tx.orderItemInstance.findMany({where:{orderItemId:item.id,archivedAt:null,athleteId:item.athleteId,measurementId:item.measurementId,orderItem:{archivedAt:null}},include:{orderShipment:true}});
  for(const target of targets)assertAssignmentMutable(order,target);
}
