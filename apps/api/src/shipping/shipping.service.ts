import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ProductionStatus, ShippingCarrier, ShippingStatus, Prisma, type User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { appliedPaymentMinor, ExchangeRatesService, EXCHANGE_RATE_ADVISORY_LOCK, parseExchangeRateCache } from "../finance/exchange-rates";
import { UpdateCarrierSettingDto, UpsertOrderShipmentDto, UpsertShipmentDto } from "./shipping.dto";
import { aggregateShippingStatus } from "./shipping-status";
import { calculateShippingFinance, shippingCustomerCharge } from "./shipping-finance";
import { requiresProduction } from "../orders/production-rules";
import { updateProductionStatusGraph } from "../orders/production-status-graph";

import { assertShippingMoney, baseShippingCharge, convertedShippingCharge, hasOriginalShippingCharge, preservedShippingCharge, unchangedShippingCharge } from "./shipping-conversion";

const labels:Record<ShippingCarrier,string>={NOVA_POSHTA:"Новая почта",NOVA_GLOBAL:"Nova Global",UKRPOSHTA:"Укрпочта",DHL:"DHL", UPS:"UPS"};
const transitions:Record<ShippingStatus,ShippingStatus[]>={NOT_READY:[ShippingStatus.READY,ShippingStatus.LABEL_CREATED,ShippingStatus.SHIPPED],READY:[ShippingStatus.LABEL_CREATED,ShippingStatus.SHIPPED],LABEL_CREATED:[ShippingStatus.SHIPPED],SHIPPED:[ShippingStatus.IN_TRANSIT,ShippingStatus.DELIVERED,ShippingStatus.RETURNED,ShippingStatus.LOST],IN_TRANSIT:[ShippingStatus.DELIVERED,ShippingStatus.RETURNED,ShippingStatus.LOST],DELIVERED:[ShippingStatus.RETURNED],RETURNED:[],LOST:[]};
const preShipmentStatuses:ShippingStatus[]=[ShippingStatus.NOT_READY,ShippingStatus.READY,ShippingStatus.LABEL_CREATED];
const sentStatuses:ShippingStatus[]=[ShippingStatus.SHIPPED,ShippingStatus.IN_TRANSIT,ShippingStatus.DELIVERED,ShippingStatus.RETURNED,ShippingStatus.LOST];
const allowed=(from:ShippingStatus,to:ShippingStatus)=>from===to||transitions[from].includes(to);
@Injectable()
export class ShippingService{
  constructor(private readonly prisma:PrismaService, private readonly exchangeRates:ExchangeRatesService){}
  private async carrierData(){const saved=await this.prisma.appSetting.findMany({where:{section:"shipping",key:{startsWith:"carrier."}}});const map=new Map(saved.map(x=>[x.key,x.value as Record<string,unknown>]));return Object.values(ShippingCarrier).map(carrier=>({carrier,label:labels[carrier],enabled:map.get("carrier."+carrier)?.enabled!==false,account:String(map.get("carrier."+carrier)?.account||""),sender:String(map.get("carrier."+carrier)?.sender||""),dispatchPoint:String(map.get("carrier."+carrier)?.dispatchPoint||"")}))}
  async list(input:{filter?:string;horizon?:number}={}){
    if(input.filter!==undefined&&input.filter!=="upcoming")throw new BadRequestException("Некорректный фильтр отправок");
    if(input.horizon!==undefined&&(input.filter!=="upcoming"||input.horizon!==7))throw new BadRequestException("Поддерживается горизонт отправок 7 дней");
    const read=async(db:Pick<Prisma.TransactionClient,"order">)=>{
      const eligible=input.filter==="upcoming"?await (async()=>{
        const {eligibleUpcomingShipmentRecords,loadOverviewOrderSources}=await import("../overview/overview-order-model");
        return eligibleUpcomingShipmentRecords(await loadOverviewOrderSources(db),{horizon:input.horizon});
      })():undefined;
      const ids=eligible?[...new Set(eligible.map(row=>row.orderId))]:undefined;
      const orders=await db.order.findMany({where:{archivedAt:null,...(ids?{id:{in:ids}}:{})},orderBy:[{requiredDeliveryAt:"asc"},{createdAt:"desc"}],select:{id:true,number:true,requiredDeliveryAt:true,deliveryTrackingCode:true,shippingStatus:true,currency:true,modelImagePath:true,client:{select:{displayName:true,country:true,city:true,address:true,postalCode:true}},items:{where:{archivedAt:null},select:{quantity:true,modelImagePath:true}},shipment:true,orderShipments:{where:{archivedAt:null},orderBy:[{isPrimary:"desc"},{createdAt:"asc"}]}}});
      const carriers=(await this.carrierData()).map(({carrier,label,enabled})=>({carrier,label,enabled}));
      return{orders:eligible?orders.map(order=>({...order,upcomingShipments:eligible.filter(row=>row.orderId===order.id),orderShipments:order.orderShipments.filter(parcel=>eligible.some(row=>row.orderId===order.id&&row.shipmentId===parcel.id))})):orders,carriers};
    };
    return input.filter==="upcoming"?this.prisma.$transaction(read,{isolationLevel:"RepeatableRead",timeout:30000,maxWait:5000}):read(this.prisma);
  }
  async carriers(){return(await this.carrierData()).map(({carrier,label,enabled})=>({carrier,label,enabled}))}
  async carrierSettings(){return this.carrierData()}
  async saveCarrier(carrier:ShippingCarrier,d:UpdateCarrierSettingDto,u:User){if(!Object.values(ShippingCarrier).includes(carrier))throw new BadRequestException("Служба доставки не поддерживается");return this.prisma.$transaction(async tx=>{const key="carrier."+carrier,before=await tx.appSetting.findUnique({where:{section_key:{section:"shipping",key}}}),x=await tx.appSetting.upsert({where:{section_key:{section:"shipping",key}},create:{section:"shipping",key,value:d as unknown as Prisma.InputJsonValue},update:{value:d as unknown as Prisma.InputJsonValue}});await tx.auditLog.create({data:{actorId:u.id,action:before?"UPDATE":"CREATE",entityType:"ShippingCarrierSetting",entityId:x.id,before:before??undefined,after:x}});return x})}
  async upsert(orderId:string,d:UpsertShipmentDto,u:User){return this.prisma.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",orderId);
    const order=await tx.order.findFirst({where:{id:orderId,archivedAt:null},include:{shipment:true,orderShipments:{where:{archivedAt:null},orderBy:[{isPrimary:"desc"},{createdAt:"asc"}]}}});
    if(!order)throw new NotFoundException("Заказ не найден");
    if(order.orderShipments.length>1)throw new ConflictException("Заказ содержит несколько посылок — измените нужную посылку во вкладке «Доставка»");
    if(order.shipment&&(!d.expectedUpdatedAt||order.shipment.updatedAt.toISOString()!==new Date(d.expectedUpdatedAt).toISOString()))throw new ConflictException("Доставка уже изменена другим пользователем");
    if(d.currency!==order.currency)throw new BadRequestException("Стоимость доставки должна быть в валюте заказа");
    await this.assertCarrier(tx,d.carrier);
    if(!allowed(order.shippingStatus,d.status))throw new BadRequestException("Недопустимый переход статуса доставки");
    const tracking=d.trackingNumber===undefined?order.shipment?.trackingNumber??null:d.trackingNumber?.trim()||null,shippedAt=d.shippedAt===undefined?order.shipment?.shippedAt??null:d.shippedAt?new Date(d.shippedAt):null,deliveredAt=d.deliveredAt===undefined?order.shipment?.deliveredAt??null:d.deliveredAt?new Date(d.deliveredAt):null,notes=d.notes===undefined?order.shipment?.notes??null:d.notes?.trim()||null;
    this.assertDates(d.status,tracking,shippedAt,deliveredAt);
    const primary=order.orderShipments[0];
    const legacyCharge=primary&&unchangedShippingCharge(primary,d.costMinor,undefined,order.currency)?preservedShippingCharge(primary):baseShippingCharge(d.costMinor);
    this.assertAggregateBounds(order,d.costMinor);
    const data={carrier:d.carrier,trackingNumber:tracking,costMinor:d.costMinor,currency:d.currency,shippedAt,deliveredAt,notes},x=await tx.shipment.upsert({where:{orderId},create:{orderId,...data},update:data});
    const legacyData={...legacyCharge,customerChargeRateSnapshot:(legacyCharge.customerChargeRateSnapshot??Prisma.DbNull) as Prisma.InputJsonValue|typeof Prisma.DbNull};
    const projected=primary?await tx.orderShipment.update({where:{id:primary.id},data:{carrier:d.carrier,status:d.status,trackingNumber:tracking,...(primary.carrier!==d.carrier || primary.trackingNumber!==tracking?{trackingUrl:null}:{}),...legacyData,currency:d.currency,shippedAt,deliveredAt,isPrimary:true,updatedAt:new Date(Math.max(Date.now(),primary.updatedAt.getTime()+1))}}):await tx.orderShipment.create({data:{orderId,carrier:d.carrier,status:d.status,trackingNumber:tracking,...legacyData,currency:d.currency,shippedAt,deliveredAt,isPrimary:true}});
    await this.refreshOrderShipping(tx,orderId,u.id);
    await tx.activity.create({data:{clientId:order.clientId,orderId,actorId:u.id,type:"SHIPMENT_UPDATED",summary:"Обновлены данные доставки",metadata:{shipmentId:x.id,carrier:d.carrier,status:d.status,trackingNumber:x.trackingNumber}}});
    await tx.auditLog.create({data:{actorId:u.id,action:order.shipment?"UPDATE":"CREATE",entityType:"Shipment",entityId:x.id,before:order.shipment??undefined,after:x}});
    await tx.auditLog.create({data:{actorId:u.id,action:primary?"UPDATE":"CREATE",entityType:"OrderShipment",entityId:projected.id,before:primary??undefined,after:projected}});
    return x;
  })}
  shipments(orderId:string){return this.prisma.orderShipment.findMany({where:{orderId,archivedAt:null},orderBy:[{isPrimary:"desc"},{createdAt:"asc"}],include:{instances:{where:{archivedAt:null},include:{orderItem:true,athlete:true}},atelierExpense:true}})}
  createShipment(orderId:string,d:UpsertOrderShipmentDto,u:User){return this.persistOrderShipment(orderId,null,d,u)}
  updateShipment(orderId:string,shipmentId:string,d:UpsertOrderShipmentDto,u:User){return this.persistOrderShipment(orderId,shipmentId,d,u)}
  async archiveShipment(orderId:string,shipmentId:string,expectedUpdatedAt:string,u:User){return this.prisma.$transaction(async tx=>{await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",orderId);const current=await tx.orderShipment.findFirst({where:{id:shipmentId,orderId,archivedAt:null},include:{instances:true,order:{select:{clientId:true}}}});if(!current)throw new NotFoundException("Посылка не найдена");if(current.updatedAt.toISOString()!==new Date(expectedUpdatedAt).toISOString())throw new ConflictException("Посылка уже изменена другим пользователем");if(current.trackingNumber||sentStatuses.includes(current.status)||current.customerChargeMinor>0||hasOriginalShippingCharge(current)||current.atelierCostMinor>0)throw new ConflictException("Посылку с отправкой, треком или суммой нельзя удалить — сохраните её в истории");await tx.orderItemInstance.updateMany({where:{orderShipmentId:shipmentId,archivedAt:null,orderItem:{archivedAt:null}},data:{orderShipmentId:null}});const archived=await tx.orderShipment.update({where:{id:shipmentId},data:{archivedAt:new Date(),isPrimary:false,updatedAt:new Date(Math.max(Date.now(),current.updatedAt.getTime()+1))}});await this.refreshOrderShipping(tx,orderId,u.id);await tx.activity.create({data:{clientId:current.order.clientId,orderId,actorId:u.id,type:"ORDER_SHIPMENT_ARCHIVED",summary:"Посылка архивирована",metadata:{shipmentId}}});await tx.auditLog.create({data:{actorId:u.id,action:"ARCHIVE",entityType:"OrderShipment",entityId:shipmentId,before:current,after:archived}});return archived})}
  private async persistOrderShipment(orderId:string,shipmentId:string|null,d:UpsertOrderShipmentDto,u:User){
    if(d.customerChargeCurrency!==undefined)assertShippingMoney(d.customerChargeMinor,d.customerChargeCurrency);
    if(d.atelierCostCurrency!==undefined)assertShippingMoney(d.atelierCostMinor,d.atelierCostCurrency);
    assertShippingMoney(d.customerChargeMinor,d.customerChargeCurrency??d.currency);
    assertShippingMoney(d.atelierCostMinor,d.atelierCostCurrency??d.currency);
    let preparedCurrency:string|undefined;
    // Read the actual saved original pair before deciding whether any FX work is needed.
    if(d.customerChargeCurrency!==undefined&&d.customerChargeMinor>0&&d.customerChargeCurrency!==d.currency){
      const brief=await this.prisma.order.findFirst({where:{id:orderId,archivedAt:null},include:{orderShipments:{where:{archivedAt:null}}}});
      if(!brief)throw new NotFoundException("Заказ не найден");
      const current=shipmentId?brief.orderShipments.find(row=>row.id===shipmentId)??null:null;
      if(shipmentId&&!current)throw new NotFoundException("Посылка не найдена");
      if(current&&(!d.expectedUpdatedAt||current.updatedAt.toISOString()!==new Date(d.expectedUpdatedAt).toISOString()))throw new ConflictException("Посылка уже изменена другим пользователем");
      if(d.currency!==brief.currency)throw new ConflictException("Валюта заказа изменилась. Повторите сохранение");
      if(!unchangedShippingCharge(current,d.customerChargeMinor,d.customerChargeCurrency,brief.currency)){
        await this.exchangeRates.currentOrRefresh(u);
        preparedCurrency=brief.currency;
      }
    }
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",EXCHANGE_RATE_ADVISORY_LOCK);
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",orderId);
      const order=await tx.order.findFirst({where:{id:orderId,archivedAt:null},include:{orderShipments:{where:{archivedAt:null},orderBy:[{isPrimary:"desc"},{createdAt:"asc"}]}}});
      if(!order)throw new NotFoundException("Заказ не найден");
      if(d.currency!==order.currency)throw new BadRequestException("Стоимость доставки должна быть в валюте заказа");
      await this.assertCarrier(tx,d.carrier);
      const current=shipmentId?await tx.orderShipment.findFirst({where:{id:shipmentId,orderId,archivedAt:null}}):null;
      if(shipmentId&&!current)throw new NotFoundException("Посылка не найдена");
      if(current&&(!d.expectedUpdatedAt||current.updatedAt.toISOString()!==new Date(d.expectedUpdatedAt).toISOString()))throw new ConflictException("Посылка уже изменена другим пользователем");
      if(current&&!allowed(current.status,d.status))throw new BadRequestException("Недопустимый переход статуса доставки");
      const tracking=d.trackingNumber?.trim()||null,shippedAt=d.shippedAt?new Date(d.shippedAt):null,deliveredAt=d.deliveredAt?new Date(d.deliveredAt):null;this.assertDates(d.status,tracking,shippedAt,deliveredAt);
      const uniqueIds=[...new Set(d.instanceIds)];
      if(uniqueIds.length!==d.instanceIds.length)throw new BadRequestException("Один экземпляр указан в составе посылки дважды");
      const instances=await tx.orderItemInstance.findMany({where:{id:{in:uniqueIds},archivedAt:null,orderItem:{orderId,archivedAt:null}},select:{id:true,orderShipmentId:true}});
      if(instances.length!==uniqueIds.length)throw new BadRequestException("В составе есть экземпляр другого заказа или архивный экземпляр");
      if(instances.some(x=>x.orderShipmentId&&x.orderShipmentId!==shipmentId))throw new ConflictException("Экземпляр уже назначен другой посылке");
      const isPrimary=current?.isPrimary??order.orderShipments.length===0;
      const unchanged=unchangedShippingCharge(current,d.customerChargeMinor,d.customerChargeCurrency,order.currency);
      let charge=unchanged&&current?preservedShippingCharge(current):baseShippingCharge(d.customerChargeMinor);
      const needsConversion=!unchanged&&d.customerChargeMinor>0&&d.customerChargeCurrency!==undefined&&d.customerChargeCurrency!==order.currency;
      if(needsConversion){
        if(!preparedCurrency||preparedCurrency!==order.currency)throw new ConflictException("Данные доставки изменились. Повторите сохранение");
        const [providerSetting,cacheSetting]=await Promise.all([
          tx.appSetting.findUnique({where:{section_key:{section:"finance",key:"exchangeRateProvider"}}}),
          tx.appSetting.findUnique({where:{section_key:{section:"finance",key:"exchangeRateCache"}}}),
        ]);
        try{
          const cache=parseExchangeRateCache(cacheSetting?.value),provider=providerSetting?.value??"NBU";
          if(cache.provider!==provider)throw new Error("Источник курса изменился");
          charge=convertedShippingCharge(cache,d.customerChargeMinor,d.customerChargeCurrency!,order.currency);
        }catch(error){throw new BadRequestException(error instanceof Error?error.message:"Официальные курсы недоступны")}
      }
      const nextDelivery=shippingCustomerCharge(order.orderShipments.filter(row=>row.id!==shipmentId))+charge.customerChargeMinor;
      this.assertAggregateBounds(order,nextDelivery);
      const linkedExpense=current?.atelierExpenseId?await tx.expense.findUnique({where:{id:current.atelierExpenseId}}):null;
      const atelierCurrency=d.atelierCostCurrency??linkedExpense?.currency??order.currency;
      assertShippingMoney(d.atelierCostMinor,atelierCurrency);
      const atelierExpenseId=await this.persistAtelierExpense(tx,orderId,current?.atelierExpenseId??null,d.atelierCostMinor,atelierCurrency,shippedAt,u.id);
      const data={carrier:d.carrier,status:d.status,trackingNumber:tracking,...(current && (current.carrier!==d.carrier || current.trackingNumber!==tracking)?{trackingUrl:null}:{}),...charge,customerChargeRateSnapshot:(charge.customerChargeRateSnapshot??Prisma.DbNull) as Prisma.InputJsonValue|typeof Prisma.DbNull,atelierCostMinor:d.atelierCostMinor,atelierExpenseId,currency:d.currency,weightGrams:d.weightGrams,lengthMm:d.lengthMm,widthMm:d.widthMm,heightMm:d.heightMm,shippedAt,deliveredAt,isPrimary};
      const shipment=current?await tx.orderShipment.update({where:{id:current.id},data:{...data,updatedAt:new Date(Math.max(Date.now(),current.updatedAt.getTime()+1))}}):await tx.orderShipment.create({data:{orderId,...data}});
      await tx.orderItemInstance.updateMany({where:{archivedAt:null,orderItem:{archivedAt:null},orderShipmentId:shipment.id,id:{notIn:uniqueIds}},data:{orderShipmentId:null}});
      if(uniqueIds.length)await tx.orderItemInstance.updateMany({where:{id:{in:uniqueIds}},data:{orderShipmentId:shipment.id}});
      await this.refreshOrderShipping(tx,orderId,u.id);
      await tx.activity.create({data:{clientId:order.clientId,orderId,actorId:u.id,type:current?"ORDER_SHIPMENT_UPDATED":"ORDER_SHIPMENT_CREATED",summary:current?"Обновлена посылка":"Добавлена посылка",metadata:{shipmentId:shipment.id,status:d.status,trackingNumber:tracking,instanceIds:uniqueIds}}});
      await tx.auditLog.create({data:{actorId:u.id,action:current?"UPDATE":"CREATE",entityType:"OrderShipment",entityId:shipment.id,before:current??undefined,after:shipment}});return shipment;
    });
  }

  private async persistAtelierExpense(tx:Prisma.TransactionClient,orderId:string,currentId:string|null,amountMinor:number,currency:string,shippedAt:Date|null,actorId:string){
    const before=currentId?await tx.expense.findUnique({where:{id:currentId}}):null;
    if(amountMinor<=0){
      if(before){const archived=await tx.expense.update({where:{id:before.id},data:{archivedAt:new Date()}});await tx.auditLog.create({data:{actorId,action:"ARCHIVE",entityType:"Expense",entityId:before.id,before,after:archived}})}
      return null;
    }
    let expense;
    if(before){
      expense=await tx.expense.update({where:{id:before.id},data:{orderId,amountMinor,currency,incurredAt:shippedAt??before.incurredAt,archivedAt:null}});
    }else{
      const category=await tx.expenseCategory.findFirst({where:{name:"Доставка",active:true}});
      if(!category)throw new ConflictException("Сначала создайте или активируйте финансовую категорию «Доставка» с правами бухгалтера");
      expense=await tx.expense.create({data:{categoryId:category.id,orderId,amountMinor,currency,incurredAt:shippedAt??new Date(),notes:"Расход перевозчика по посылке"}});
    }
    await tx.auditLog.create({data:{actorId,action:before?"UPDATE":"CREATE",entityType:"Expense",entityId:expense.id,before:before??undefined,after:expense}});
    return expense.id;
  }
  private assertAggregateBounds(order:{currency:string;priceMinor:number;deliveryMinor:number;depositRequiredMinor:number;paymentStatus:Parameters<typeof calculateShippingFinance>[0]["paymentStatus"]},deliveryMinor:number){
    assertShippingMoney(deliveryMinor,order.currency);
    const next=calculateShippingFinance({priceMinor:order.priceMinor,previousDeliveryMinor:order.deliveryMinor,deliveryMinor,depositRequiredMinor:order.depositRequiredMinor,paymentStatus:order.paymentStatus,paidMinor:0});
    assertShippingMoney(next.priceMinor,order.currency);
    assertShippingMoney(next.depositRequiredMinor,order.currency);
  }
  private async refreshOrderShipping(tx:Prisma.TransactionClient,orderId:string,actorId:string){
    const [shipments,order]=await Promise.all([
      tx.orderShipment.findMany({where:{orderId,archivedAt:null},orderBy:[{isPrimary:"desc"},{createdAt:"asc"}]}),
      tx.order.findUniqueOrThrow({where:{id:orderId},include:{payments:{where:{voidedAt:null}},productionSlot:true}}),
    ]);
    const deliveryMinor=shippingCustomerCharge(shipments),shippingStatus=aggregateShippingStatus(shipments.map(x=>x.status));
    const paidMinor=order.payments.reduce((sum,payment)=>sum+appliedPaymentMinor(payment,order.currency),0);
    const {priceMinor,depositRequiredMinor,paymentStatus}=calculateShippingFinance({priceMinor:order.priceMinor,previousDeliveryMinor:order.deliveryMinor,deliveryMinor,depositRequiredMinor:order.depositRequiredMinor,paymentStatus:order.paymentStatus,paidMinor});
    if(order.productionSlot&&!order.productionSlot.tentative&&priceMinor>order.priceMinor&&paidMinor<depositRequiredMinor)throw new ConflictException("Сначала внесите оплату до новой суммы предоплаты");
    const orderData={deliveryMinor,shippingStatus,priceMinor,depositRequiredMinor,paymentStatus};
    const confirmsProductionSlot=Boolean(requiresProduction(order.type)&&order.productionSlot?.tentative&&depositRequiredMinor>0&&paidMinor>=depositRequiredMinor);
    const shouldSchedule=confirmsProductionSlot&&order.productionStatus===ProductionStatus.NOT_SCHEDULED;
    if(shouldSchedule)await updateProductionStatusGraph(tx,orderId,ProductionStatus.SCHEDULED,orderData,{preserveProgress:true});
    else await tx.order.update({where:{id:orderId},data:orderData});
    if(confirmsProductionSlot&&order.productionSlot){const slot=await tx.productionSlot.update({where:{orderId},data:{tentative:false}});await tx.activity.create({data:{clientId:order.clientId,orderId,actorId,type:"PRODUCTION_SLOT_CONFIRMED",summary:"Производственный слот подтверждён после пересчёта доставки",metadata:{depositRequiredMinor,paidMinor,currency:order.currency}}});await tx.auditLog.create({data:{actorId,action:"UPDATE",entityType:"ProductionSlot",entityId:slot.id,before:order.productionSlot,after:slot}})}
    const primary=shipments[0];
    if(primary)await tx.shipment.upsert({where:{orderId},create:{orderId,carrier:primary.carrier,trackingNumber:primary.trackingNumber,costMinor:deliveryMinor,currency:primary.currency,shippedAt:primary.shippedAt,deliveredAt:primary.deliveredAt},update:{carrier:primary.carrier,trackingNumber:primary.trackingNumber,costMinor:deliveryMinor,currency:primary.currency,shippedAt:primary.shippedAt,deliveredAt:primary.deliveredAt}});
    else await tx.shipment.updateMany({where:{orderId},data:{trackingNumber:null,costMinor:0,shippedAt:null,deliveredAt:null}});
    await tx.auditLog.create({data:{actorId,action:"UPDATE",entityType:"OrderShippingAggregate",entityId:orderId,before:{deliveryMinor:order.deliveryMinor,priceMinor:order.priceMinor,depositRequiredMinor:order.depositRequiredMinor,paymentStatus:order.paymentStatus},after:{deliveryMinor,shippingStatus,priceMinor,depositRequiredMinor,paymentStatus}}});
  }
  private async assertCarrier(tx:Prisma.TransactionClient,carrier:ShippingCarrier){const setting=await tx.appSetting.findUnique({where:{section_key:{section:"shipping",key:"carrier."+carrier}}}),config=setting?.value as Record<string,unknown>|undefined;if(config?.enabled===false)throw new BadRequestException("Выбранная служба доставки отключена")}
  private assertDates(status:ShippingStatus,tracking:string|null,shippedAt:Date|null,deliveredAt:Date|null){if(sentStatuses.includes(status)&&!tracking)throw new BadRequestException("Для отправленной посылки укажите трек-номер");if(sentStatuses.includes(status)&&!shippedAt)throw new BadRequestException("Укажите дату отправки");if(status===ShippingStatus.DELIVERED&&!deliveredAt)throw new BadRequestException("Укажите дату доставки");if(preShipmentStatuses.includes(status)&&(shippedAt||deliveredAt))throw new BadRequestException("Дата отправки недопустима для выбранного статуса");if(status!==ShippingStatus.DELIVERED&&status!==ShippingStatus.RETURNED&&deliveredAt)throw new BadRequestException("Дата доставки недопустима для выбранного статуса");if(deliveredAt&&shippedAt&&deliveredAt<shippedAt)throw new BadRequestException("Дата доставки не может быть раньше даты отправки")}
}
