type FactDate=string|Date|null;
type Parcel={id?:string;status?:string;trackingNumber?:string|null;shippedAt?:FactDate;deliveredAt?:FactDate;instances?:{id:string}[]};
export type ShippingEvidence={salesStatus?:string;shippingStatus?:string;deliveryTrackingCode?:string|null;shipment?:Parcel|null;orderShipments?:Parcel[];items?:{archivedAt?:Date|null;quantity?:number;instances?:{archivedAt?:Date|null;id?:string;productionStatus?:string}[]}[]};
const SENT=new Set(['SHIPPED','IN_TRANSIT','DELIVERED','RETURNED','LOST']);
export function parcelHasDispatchEvidence(parcel:Parcel){return Boolean(SENT.has(parcel.status??'')||parcel.trackingNumber?.trim()||parcel.shippedAt||parcel.deliveredAt);}
/** Read-only evidence; never invent dispatch dates or rewrite stored statuses. */
export function shippingEvidence(order:ShippingEvidence){
 const parcels=(order.orderShipments??[]).filter(parcel=>parcel.status!=='CANCELLED'),sent=parcels.filter(parcelHasDispatchEvidence);
 const legacy=Boolean((!parcels.length&&(['SHIPPED','DELIVERED'].includes(order.salesStatus??'')||SENT.has(order.shippingStatus??'')))||order.deliveryTrackingCode?.trim()||(order.shipment&&parcelHasDispatchEvidence(order.shipment)));
 const items=(order.items??[]).filter(item=>!item.archivedAt).map(item=>({...item,instances:item.instances?.filter(instance=>!instance.archivedAt)})),instances=items.flatMap(item=>item.instances??[]).filter(instance=>instance.productionStatus!=='CANCELLED');
 const covered=new Set(sent.flatMap(parcel=>(parcel.instances??[]).map(instance=>instance.id)));
 const knownCohort=items.length>0&&items.every(item=>Boolean(item.instances?.length)&&(item.quantity===undefined||item.instances!.length===item.quantity));
 const coverage=knownCohort&&instances.length>0&&new Set(instances.map(instance=>instance.id)).size===instances.length&&instances.every(instance=>Boolean(instance.id)&&covered.has(instance.id!));
 const complete=legacy||(parcels.length>0&&sent.length===parcels.length&&coverage);
 const exception=['LOST','RETURNED'].includes(order.shippingStatus??'')?order.shippingStatus:sent.some(parcel=>parcel.status==='LOST')?'LOST':sent.some(parcel=>parcel.status==='RETURNED')?'RETURNED':undefined;
 const delivered=parcels.length>0?complete&&parcels.every(parcel=>parcel.status==='DELIVERED'||parcel.deliveredAt):Boolean(order.shipment?.deliveredAt)||order.salesStatus==='DELIVERED'||order.shippingStatus==='DELIVERED';
 return {complete,delivered,partial:sent.length>0&&!complete,hasChildDispatch:sent.length>0,exception};
}

/** No active design after a managed composition is distinct from a legacy order without item rows. */
export function hasManagedEmptyItems(order:{items?:unknown[];compositionManaged?:boolean;compositionOperations?:unknown[];_count?:{items:number}}){
  return order.items?.length===0&&Boolean(order.compositionManaged||order.compositionOperations?.length||order._count?.items);
}
