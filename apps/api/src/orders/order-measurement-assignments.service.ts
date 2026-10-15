import { assertAssignmentMutable } from "./order-assignment-eligibility";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ArchiveOrderAthleteDto, ArchiveOrderMeasurementDto, AssignOrderMeasurementsDto, CreateOrderAthleteDto, CreateOrderSnapshotDto, MeasurementUsageQueryDto } from './order-measurement-assignments.dto';
import { compositionToken } from './order-composition';
import { createMeasurementData } from '../clients/measurement-data';

@Injectable()
export class OrderMeasurementAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}
  async createAthlete(orderId:string,input:CreateOrderAthleteDto,actor:User){
    return this.prisma.$transaction(async tx=>{
      const order=await this.lockContext(tx,orderId);
      const {operationKey,...fields}=input;
      const data={...fields,firstName:fields.firstName.trim(),lastName:fields.lastName?.trim(),birthDate:fields.birthDate?new Date(fields.birthDate):undefined};
      if(!data.firstName)throw new BadRequestException('Укажите имя спортсменки');
      const requestHash=compositionToken({kind:'ATHLETE',actorId:actor.id,data});
      const previous=await tx.orderCompositionOperation.findUnique({where:{orderId_operationKey:{orderId,operationKey}}});
      if(previous){
        if(previous.requestHash!==requestHash)throw new ConflictException('Ключ создания уже использован для другого запроса');
        const id=(previous.result as {id:string}).id,existing=await tx.athlete.findFirst({where:{id,clientId:order.clientId}});
        if(!existing)throw new ConflictException('Результат операции требует проверки принадлежности');return existing;
      }
      const athlete=await tx.athlete.create({data:{...data,clientId:order.clientId}});
      await tx.activity.create({data:{orderId,clientId:order.clientId,actorId:actor.id,type:'ATHLETE_CREATED',summary:`Добавлена спортсменка: ${athlete.firstName}`,metadata:{athleteId:athlete.id}}});
      await tx.auditLog.create({data:{actorId:actor.id,action:'CREATE',entityType:'Athlete',entityId:athlete.id,after:JSON.parse(JSON.stringify(athlete))}});
      await tx.orderCompositionOperation.create({data:{orderId,actorId:actor.id,operationKey,requestHash,result:{id:athlete.id}}});
      return athlete;
    });
  }
  async createSnapshot(orderId:string,athleteId:string,input:CreateOrderSnapshotDto,actor:User){
    return this.prisma.$transaction(async tx=>{
      const order=await this.lockContext(tx,orderId);
      await tx.$queryRaw`SELECT "id" FROM "Athlete" WHERE "id" = ${athleteId} FOR UPDATE`;
      if(!await tx.athlete.findFirst({where:{id:athleteId,clientId:order.clientId,archivedAt:null},select:{id:true}}))throw new ConflictException('Спортсменка не принадлежит клиенту или архивирована');
      const {operationKey,...fields}=input,data=createMeasurementData(athleteId,fields);
      const requestHash=compositionToken({kind:'MEASUREMENT',actorId:actor.id,data});
      const previous=await tx.orderCompositionOperation.findUnique({where:{orderId_operationKey:{orderId,operationKey}}});
      if(previous){
        if(previous.requestHash!==requestHash)throw new ConflictException('Ключ создания уже использован для другого запроса');
        const id=(previous.result as {id:string}).id,existing=await tx.measurement.findFirst({where:{id,athleteId}});
        if(!existing)throw new ConflictException('Результат операции требует проверки принадлежности');return existing;
      }
      const measurement=await tx.measurement.create({data});
      await tx.activity.create({data:{orderId,clientId:order.clientId,actorId:actor.id,type:'MEASUREMENT_CREATED',summary:'Создана новая версия мерок; назначения не изменены',metadata:{athleteId,measurementId:measurement.id}}});
      await tx.auditLog.create({data:{actorId:actor.id,action:'CREATE',entityType:'Measurement',entityId:measurement.id,after:JSON.parse(JSON.stringify(measurement))}});
      await tx.orderCompositionOperation.create({data:{orderId,actorId:actor.id,operationKey,requestHash,result:{id:measurement.id}}});
      return measurement;
    });
  }
  private async lockContext(tx: Prisma.TransactionClient, orderId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge-global"},0))`;
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', orderId);
    const initial = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, select: { clientId: true } });
    if (!initial) throw new NotFoundException('Заказ не найден');
    await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${initial.clientId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.order.findFirst({ where: { id: orderId, clientId: initial.clientId, archivedAt: null }, select: {
      clientId: true, salesStatus: true, shippingStatus: true, deliveryTrackingCode: true,
      shipment: { select: { trackingNumber: true, shippedAt: true, deliveredAt: true } },
      orderShipments: { where: { archivedAt: null }, take: 1, select: { id: true } },
    } });
    if (!order || !await tx.client.findFirst({ where: { id: order.clientId, archivedAt: null }, select: { id: true } })) throw new NotFoundException('Клиент или заказ не найден');
    return order;
  }

  async assign(orderId: string, input: AssignOrderMeasurementsDto, actor: User) {
    if (!Array.isArray(input.targets) || input.targets.length < 1 || input.targets.length > 1000 || new Set(input.targets.map(target => target.id)).size !== input.targets.length) throw new BadRequestException('Выберите от 1 до 1000 разных экземпляров');
    if (input.measurementId && !input.athleteId) throw new BadRequestException('Сначала выберите спортсменку');
    return this.prisma.$transaction(async tx => {
      const order = await this.lockContext(tx, orderId);
      if (input.athleteId) {
        await tx.$queryRaw`SELECT "id" FROM "Athlete" WHERE "id" = ${input.athleteId} FOR UPDATE`;
        if (!await tx.athlete.findFirst({ where: { id: input.athleteId, clientId: order.clientId, archivedAt: null }, select: { id: true } })) throw new ConflictException('Спортсменка не принадлежит клиенту заказа или архивирована');
      }
      if (input.measurementId && !await tx.measurement.findFirst({ where: { id: input.measurementId, athleteId: input.athleteId!, archivedAt: null }, select: { id: true } })) throw new ConflictException('Версия мерок не принадлежит спортсменке или архивирована');
      const instances = [];
      for (const target of [...input.targets].sort((a, b) => a.id.localeCompare(b.id))) {
        const expectedUpdatedAt = new Date(target.expectedUpdatedAt);
        if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new BadRequestException('Некорректная версия экземпляра');
        const current = await tx.orderItemInstance.findFirst({ where: { id: target.id, archivedAt: null, orderItem: { orderId, archivedAt: null, order: { clientId: order.clientId, archivedAt: null } } }, include: { orderShipment: true } });
        if (!current) throw new NotFoundException('Активный экземпляр заказа не найден');
        if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ConflictException('Экземпляр уже изменён другим пользователем');
        const standardHeight = input.standardHeight === undefined ? current.standardHeight : input.standardHeight;
        if (current.athleteId === input.athleteId && current.measurementId === input.measurementId && current.standardHeight === standardHeight) { instances.push(current); continue; }
        assertAssignmentMutable(order,current);
        const data = { athleteId: input.athleteId, measurementId: input.measurementId, standardHeight };
        const claimed = await tx.orderItemInstance.updateMany({ where: { id: current.id, archivedAt: null, updatedAt: expectedUpdatedAt, orderItem: { orderId, archivedAt: null, order: { clientId: order.clientId, archivedAt: null } } }, data });
        if (claimed.count !== 1) throw new ConflictException('Экземпляр уже изменён другим пользователем');
        const updated = await tx.orderItemInstance.findUniqueOrThrow({ where: { id: current.id } });
        await tx.activity.create({ data: { orderId, clientId: order.clientId, actorId: actor.id, type: 'ORDER_ITEM_INSTANCE_MEASUREMENTS_ASSIGNED', summary: `Назначены спортсменка и мерки экземпляру №${current.ordinal}`, metadata: { instanceId: current.id, orderItemId: current.orderItemId, before: { athleteId: current.athleteId, measurementId: current.measurementId, standardHeight: current.standardHeight }, after: data } } });
        await tx.auditLog.create({ data: { actorId: actor.id, action: 'UPDATE', entityType: 'OrderItemInstance', entityId: current.id, before: current, after: updated } });
        instances.push(updated);
      }
      return { instances };
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  async usage(orderId: string, query: MeasurementUsageQueryDto) {
    const { page = 1, pageSize = 25, athleteId } = query;
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('Некорректная страница использований мерок');
    return this.prisma.$transaction(async tx => {
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, select: { clientId: true } });
      if (!order || !await tx.client.findFirst({ where: { id: order.clientId, archivedAt: null }, select: { id: true } })) throw new NotFoundException('Клиент или заказ не найден');
      // Historical athletes and snapshots remain readable; neither archive flag filters usage.
      if (athleteId && !await tx.athlete.findFirst({ where: { id: athleteId, clientId: order.clientId }, select: { id: true } })) throw new NotFoundException('Спортсменка клиента не найдена');
      const where: Prisma.OrderItemInstanceWhereInput = {
        orderItem: { order: { clientId: order.clientId } },
        ...(athleteId ? { athleteId } : {}),
        OR: [{ athleteId: null }, { athlete: { clientId: order.clientId } }],
        AND: [{ OR: [{ measurementId: null }, { measurement: { athlete: { clientId: order.clientId } } }] }],
      };
      const total = await tx.orderItemInstance.count({ where });
      const instances = await tx.orderItemInstance.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: [{ orderItemId: 'asc' }, { ordinal: 'asc' }, { id: 'asc' }],
        select: { id: true, ordinal: true, measurementId: true, productionStatus: true, archivedAt: true,
          athlete: { select: { archivedAt: true } }, measurement: { select: { measuredAt: true, archivedAt: true } },
          orderItem: { select: { id: true, name: true, archivedAt: true, order: { select: { id: true, number: true, archivedAt: true } } } },
        },
      });
      return { rows: instances.map(instance => ({
        orderId: instance.orderItem.order.id, orderNumber: instance.orderItem.order.number,
        orderItemId: instance.orderItem.id, designName: instance.orderItem.name,
        instanceId: instance.id, ordinal: instance.ordinal, measurementId: instance.measurementId,
        measuredAt: instance.measurement?.measuredAt ?? null, productionStatus: instance.productionStatus,
        // A historical row may be archived through any of its owners, never physically removed.
        archived: Boolean(instance.archivedAt || instance.orderItem.archivedAt || instance.orderItem.order.archivedAt || instance.athlete?.archivedAt || instance.measurement?.archivedAt),
      })), total, page, pageSize };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async history(orderId:string,instanceId:string){
    return this.prisma.$transaction(async tx=>{
      const context=await tx.order.findFirst({where:{id:orderId,archivedAt:null},select:{clientId:true}});
      if(!context||!await tx.client.findFirst({where:{id:context.clientId,archivedAt:null},select:{id:true}}))throw new NotFoundException('Клиент или заказ не найден');
      const current=await tx.orderItemInstance.findFirst({where:{id:instanceId,orderItem:{order:{clientId:context.clientId}},
        OR:[{athleteId:null},{athlete:{clientId:context.clientId}}],
        AND:[{OR:[{measurementId:null},{measurement:{athlete:{clientId:context.clientId}}}]}]
      },select:{id:true,ordinal:true,standardHeight:true,productionStatus:true,archivedAt:true,
        athlete:{select:{id:true,firstName:true,lastName:true,archivedAt:true}},
        measurement:{select:{id:true,athleteId:true,measuredAt:true,values:true,archivedAt:true}},
        orderItem:{select:{id:true,name:true,sku:true,notes:true,designNumber:true,priceMinor:true,archivedAt:true,order:{select:{id:true,number:true,currency:true,archivedAt:true}}}}
      }});
      if(!current)throw new NotFoundException('Исторический экземпляр клиента не найден');
      const {orderItem,...instance}=current,{order,...design}=orderItem;
      return {orderId:order.id,orderNumber:order.number,currency:order.currency,design,instance,
        archived:Boolean(order.archivedAt||design.archivedAt||instance.archivedAt||instance.athlete?.archivedAt||instance.measurement?.archivedAt)};
    },{isolationLevel:'RepeatableRead'});
  }

  async archiveMeasurement(orderId: string, measurementId: string, input: ArchiveOrderMeasurementDto, actor: User) {
    return this.prisma.$transaction(async tx => {
      const order = await this.lockContext(tx, orderId);
      await tx.$queryRaw`SELECT "id" FROM "Measurement" WHERE "id" = ${measurementId} FOR UPDATE`;
      const current = await tx.measurement.findFirst({ where: { id: measurementId, athlete: { clientId: order.clientId } } });
      if (!current) throw new NotFoundException('Версия мерок клиента не найдена');
      const expectedArchivedAt = input.expectedArchivedAt === null ? null : new Date(input.expectedArchivedAt);
      if (expectedArchivedAt && !Number.isFinite(expectedArchivedAt.getTime())) throw new BadRequestException('Некорректная версия архива мерок');
      if ((current.archivedAt?.getTime() ?? null) !== (expectedArchivedAt?.getTime() ?? null)) throw new ConflictException('Версия мерок уже изменена');
      if (current.archivedAt) return { id: current.id, archivedAt: current.archivedAt };
      const archivedAt = new Date();
      const claimed = await tx.measurement.updateMany({ where: { id: measurementId, archivedAt: expectedArchivedAt, athlete: { clientId: order.clientId } }, data: { archivedAt } });
      if (claimed.count !== 1) throw new ConflictException('Версия мерок уже изменена');
      await tx.activity.create({ data: { orderId, clientId: order.clientId, actorId: actor.id, type: 'MEASUREMENT_ARCHIVED', summary: 'Версия мерок архивирована; прежние назначения сохранены', metadata: { measurementId, athleteId: current.athleteId, archivedAt: archivedAt.toISOString() } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'ARCHIVE', entityType: 'Measurement', entityId: measurementId, before: { archivedAt: current.archivedAt }, after: { archivedAt } } });
      return { id: measurementId, archivedAt };
    });
  }

  async archiveAthlete(orderId: string, athleteId: string, input: ArchiveOrderAthleteDto, actor: User) {
    return this.prisma.$transaction(async tx => {
      const order = await this.lockContext(tx, orderId);
      await tx.$queryRaw`SELECT "id" FROM "Athlete" WHERE "id" = ${athleteId} FOR UPDATE`;
      const current = await tx.athlete.findFirst({ where: { id: athleteId, clientId: order.clientId } });
      if (!current) throw new NotFoundException('Спортсменка клиента не найдена');
      const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
      if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new BadRequestException('Некорректная версия спортсменки');
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ConflictException('Спортсменка уже изменена');
      if (current.archivedAt) return { id: current.id, archivedAt: current.archivedAt, updatedAt: current.updatedAt };
      const claimed = await tx.athlete.updateMany({ where: { id: athleteId, clientId: order.clientId, archivedAt: null, updatedAt: expectedUpdatedAt }, data: { archivedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('Спортсменка уже изменена');
      const updated = await tx.athlete.findUniqueOrThrow({ where: { id: athleteId } });
      await tx.activity.create({ data: { orderId, clientId: order.clientId, actorId: actor.id, type: 'ATHLETE_ARCHIVED', summary: 'Спортсменка архивирована; история и мерки сохранены', metadata: { athleteId } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'ARCHIVE', entityType: 'Athlete', entityId: athleteId, before: current, after: updated } });
      return { id: updated.id, archivedAt: updated.archivedAt, updatedAt: updated.updatedAt };
    });
  }
}
