import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ShippingCarrier, ShippingStatus, type Prisma, type User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { UpdateCarrierSettingDto, UpsertShipmentDto } from "./shipping.dto";
const labels: Record<ShippingCarrier,string> = { NOVA_POSHTA:"Новая почта", NOVA_GLOBAL:"Nova Global", UKRPOSHTA:"Укрпочта", DHL:"DHL" };
const transitions: Record<ShippingStatus,ShippingStatus[]> = {
  NOT_READY:[ShippingStatus.READY,ShippingStatus.LABEL_CREATED,ShippingStatus.SHIPPED],
  READY:[ShippingStatus.LABEL_CREATED,ShippingStatus.SHIPPED],
  LABEL_CREATED:[ShippingStatus.SHIPPED],
  SHIPPED:[ShippingStatus.IN_TRANSIT,ShippingStatus.DELIVERED,ShippingStatus.RETURNED,ShippingStatus.LOST],
  IN_TRANSIT:[ShippingStatus.DELIVERED,ShippingStatus.RETURNED,ShippingStatus.LOST],
  DELIVERED:[ShippingStatus.RETURNED], RETURNED:[], LOST:[],
};
const preShipmentStatuses: ShippingStatus[] = [ShippingStatus.NOT_READY,ShippingStatus.READY,ShippingStatus.LABEL_CREATED];
const sentStatuses: ShippingStatus[] = [ShippingStatus.SHIPPED,ShippingStatus.IN_TRANSIT,ShippingStatus.DELIVERED,ShippingStatus.RETURNED,ShippingStatus.LOST];
const allowed=(from:ShippingStatus,to:ShippingStatus)=>from===to||transitions[from].includes(to);
@Injectable() export class ShippingService {
  constructor(private readonly prisma:PrismaService){}
  private async carrierData(){const saved=await this.prisma.appSetting.findMany({where:{section:"shipping",key:{startsWith:"carrier."}}});const map=new Map(saved.map(x=>[x.key,x.value as Record<string,unknown>]));return Object.values(ShippingCarrier).map(carrier=>({carrier,label:labels[carrier],enabled:map.get("carrier."+carrier)?.enabled!==false,account:String(map.get("carrier."+carrier)?.account||""),sender:String(map.get("carrier."+carrier)?.sender||""),dispatchPoint:String(map.get("carrier."+carrier)?.dispatchPoint||"")}))}
  async list(){const orders=await this.prisma.order.findMany({where:{archivedAt:null},orderBy:[{requiredDeliveryAt:"asc"},{createdAt:"desc"}],select:{id:true,number:true,requiredDeliveryAt:true,shippingStatus:true,currency:true,modelImagePath:true,client:{select:{displayName:true,country:true,city:true,address:true,postalCode:true}},items:{select:{quantity:true,modelImagePath:true}},shipment:true}});const carriers=(await this.carrierData()).map(({carrier,label,enabled})=>({carrier,label,enabled}));return{orders,carriers}}
  async carriers(){return(await this.carrierData()).map(({carrier,label,enabled})=>({carrier,label,enabled}))}
  async carrierSettings(){return this.carrierData()}
  async saveCarrier(carrier:ShippingCarrier,d:UpdateCarrierSettingDto,u:User){if(!Object.values(ShippingCarrier).includes(carrier))throw new BadRequestException("Служба доставки не поддерживается");return this.prisma.$transaction(async tx=>{const key="carrier."+carrier,before=await tx.appSetting.findUnique({where:{section_key:{section:"shipping",key}}}),x=await tx.appSetting.upsert({where:{section_key:{section:"shipping",key}},create:{section:"shipping",key,value:d as unknown as Prisma.InputJsonValue},update:{value:d as unknown as Prisma.InputJsonValue}});await tx.auditLog.create({data:{actorId:u.id,action:before?"UPDATE":"CREATE",entityType:"ShippingCarrierSetting",entityId:x.id,before:before??undefined,after:x}});return x})}
  async upsert(orderId:string,d:UpsertShipmentDto,u:User){return this.prisma.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",orderId);
    const order=await tx.order.findFirst({where:{id:orderId,archivedAt:null},include:{shipment:true}});if(!order)throw new NotFoundException("Заказ не найден");if(d.currency!==order.currency)throw new BadRequestException("Стоимость доставки должна быть в валюте заказа");
    const setting=await tx.appSetting.findUnique({where:{section_key:{section:"shipping",key:"carrier."+d.carrier}}}),config=setting?.value as Record<string,unknown>|undefined;if(config?.enabled===false)throw new BadRequestException("Выбранная служба доставки отключена");if(!allowed(order.shippingStatus,d.status))throw new BadRequestException("Недопустимый переход статуса доставки");
    const tracking=d.trackingNumber===undefined?order.shipment?.trackingNumber??null:d.trackingNumber?.trim()||null;
    const shippedAt=d.shippedAt===undefined?order.shipment?.shippedAt??null:d.shippedAt?new Date(d.shippedAt):null;
    const deliveredAt=d.deliveredAt===undefined?order.shipment?.deliveredAt??null:d.deliveredAt?new Date(d.deliveredAt):null;
    const notes=d.notes===undefined?order.shipment?.notes??null:d.notes?.trim()||null;
    if(sentStatuses.includes(d.status)&&!tracking)throw new BadRequestException("Для отправленной посылки укажите трек-номер");
    if(sentStatuses.includes(d.status)&&!shippedAt)throw new BadRequestException("Укажите дату отправки");
    if(d.status===ShippingStatus.DELIVERED&&!deliveredAt)throw new BadRequestException("Укажите дату доставки");
    if(preShipmentStatuses.includes(d.status)&&(shippedAt||deliveredAt))throw new BadRequestException("Дата отправки недопустима для выбранного статуса");
    if(d.status!==ShippingStatus.DELIVERED&&d.status!==ShippingStatus.RETURNED&&deliveredAt)throw new BadRequestException("Дата доставки недопустима для выбранного статуса");
    if(deliveredAt&&shippedAt&&deliveredAt<shippedAt)throw new BadRequestException("Дата доставки не может быть раньше даты отправки");
    const data={carrier:d.carrier,trackingNumber:tracking,costMinor:d.costMinor,currency:d.currency,shippedAt,deliveredAt,notes},x=await tx.shipment.upsert({where:{orderId},create:{orderId,...data},update:data});
    await tx.order.update({where:{id:orderId},data:{shippingStatus:d.status,deliveryMinor:d.costMinor}});
    await tx.activity.create({data:{clientId:order.clientId,orderId,type:"SHIPMENT_UPDATED",summary:"Обновлены данные доставки",metadata:{shipmentId:x.id,carrier:d.carrier,status:d.status,trackingNumber:x.trackingNumber}}});
    await tx.auditLog.create({data:{actorId:u.id,action:order.shipment?"UPDATE":"CREATE",entityType:"Shipment",entityId:x.id,before:order.shipment??undefined,after:x}});return x
  })}
}
