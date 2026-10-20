import { ShippingStatus } from "@prisma/client";
const sentStatuses:ShippingStatus[]=[ShippingStatus.SHIPPED,ShippingStatus.IN_TRANSIT,ShippingStatus.DELIVERED,ShippingStatus.RETURNED,ShippingStatus.LOST];
export function aggregateShippingStatus(statuses:ShippingStatus[]):ShippingStatus{
  if(!statuses.length)return ShippingStatus.NOT_READY;
  if(statuses.every(x=>x===ShippingStatus.DELIVERED))return ShippingStatus.DELIVERED;
  if(statuses.every(x=>x===ShippingStatus.RETURNED))return ShippingStatus.RETURNED;
  if(statuses.every(x=>x===ShippingStatus.LOST))return ShippingStatus.LOST;
  if(statuses.some(x=>x===ShippingStatus.IN_TRANSIT))return ShippingStatus.IN_TRANSIT;
  if(statuses.some(x=>sentStatuses.includes(x)))return ShippingStatus.SHIPPED;
  if(statuses.some(x=>x===ShippingStatus.LABEL_CREATED))return ShippingStatus.LABEL_CREATED;
  if(statuses.every(x=>x===ShippingStatus.READY))return ShippingStatus.READY;
  return ShippingStatus.NOT_READY;
}
