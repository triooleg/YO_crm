import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Prisma, User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { uploadsRoot } from "../uploads";
import { AddOrderPaymentDto, CreateOrderDto, OrderMeasurementDto, UpdateOrderDeadlineDto, UpdateOrderStatusesDto, UpdateProductionSlotDto, UploadModelImageDto } from "./orders.dto";
import { DEFAULT_PRODUCTION_DURATION_DAYS, DEFAULT_SHIPPING_LEAD_DAYS, productionSetting, productionWindow, resolveProductionSlotTentative, violatesShippingLead } from "./production-rules";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const OPTIMIZE_FROM_BYTES = 2 * 1024 * 1024;
function calculateDepositMinor(priceMinor: number, percent: number) {
  const scaled = BigInt(priceMinor) * BigInt(percent);
  return Number((scaled + 50n) / 100n);
}

async function nextOrderNumber(tx: Prisma.TransactionClient, now = new Date()) {
  const year = String(now.getFullYear()).slice(-2);
  const prefix = `YO-${year}-`;
  const last = await tx.order.findFirst({
    where: { number: { startsWith: `YO-${year}-` } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const sequence = Number(last?.number.slice(-4) ?? "0") + 1;
  if (sequence > 9999) throw new BadRequestException(`Исчерпан диапазон номеров заказов за 20${year} год`);
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async defaults() {
    const [setting, duration, lead] = await Promise.all([
      this.prisma.appSetting.findUnique({ where: { section_key: { section: "orders", key: "depositPercent" } } }),
      this.prisma.appSetting.findUnique({ where: { section_key: { section: "production", key: "defaultDurationDays" } } }),
      this.prisma.appSetting.findUnique({ where: { section_key: { section: "production", key: "shippingLeadDays" } } }),
    ]);
    const depositPercent = typeof setting?.value === "number" && Number.isInteger(setting.value) && setting.value >= 0 && setting.value <= 100 ? setting.value : 50;
    return {
      depositPercent,
      defaultDurationDays: productionSetting(duration?.value, DEFAULT_PRODUCTION_DURATION_DAYS, 1, 90),
      shippingLeadDays: productionSetting(lead?.value, DEFAULT_SHIPPING_LEAD_DAYS, 0, 30),
    };
  }

  async list(search?: string) {
    const query = search?.trim();
    return this.prisma.order.findMany({
      where: { archivedAt: null, ...(query ? { OR: [
        { number: { contains: query, mode: "insensitive" as const } },
        { client: { displayName: { contains: query, mode: "insensitive" as const } } },
        { athlete: { is: { firstName: { contains: query, mode: "insensitive" as const } } } },
        { athlete: { is: { lastName: { contains: query, mode: "insensitive" as const } } } },
      ] } : {}) },
      orderBy: [{ requiredDeliveryAt: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true, number: true, type: true, requiredDeliveryAt: true, priceMinor: true,
        depositRequiredMinor: true, currency: true, salesStatus: true, productionStatus: true,
        paymentStatus: true, shippingStatus: true, modelImagePath: true, notes: true, createdAt: true, productionSlot: true,
        client: { select: { id: true, displayName: true, country: true, city: true, address: true, postalCode: true, language: true, source: true } },
        athlete: { select: { id: true, firstName: true, lastName: true } },
        measurement: { select: { id: true, measuredAt: true, values: true } },
        items: { select: { id: true, name: true, quantity: true, priceMinor: true, modelImagePath: true, productionStatus: true, athlete: { select: { id: true, firstName: true, lastName: true } }, measurement: { select: { id: true, measuredAt: true, values: true } } } },
        activities: { select: { id: true, type: true, summary: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 30 },
        payments: { select: { id: true, amountMinor: true, currency: true, method: true, receivedAt: true, reference: true, notes: true }, orderBy: { receivedAt: "desc" } }, shipment: true, invoices: { where: { archivedAt: null }, select: { id: true, number: true, status: true, language: true, totalMinor: true, issueDate: true }, orderBy: { createdAt: "desc" } },
      },
    });
  }

  async productionList() {
    return this.prisma.order.findMany({
      where: { archivedAt: null },
      orderBy: [{ requiredDeliveryAt: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        number: true,
        notes: true,
        modelImagePath: true,
        requiredDeliveryAt: true,
        productionStatus: true,
        priceMinor: true,
        currency: true,
        productionSlot: true,
        client: { select: { displayName: true, country: true } },
        items: {
          select: {
            quantity: true,
            modelImagePath: true,
            athlete: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
  }


  async updateStatuses(orderId: string, dto: UpdateOrderStatusesDto, actor: User) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { payments: true } });
    if (!order) throw new NotFoundException("Заказ не найден");
    const committedProductionStatuses = new Set(["SCHEDULED", "MATERIALS", "CUTTING", "SEWING", "DECORATION", "QUALITY_CONTROL", "READY"]);
    if (dto.productionStatus && committedProductionStatuses.has(dto.productionStatus)) {
      const paidMinor = order.payments.filter((payment) => payment.currency === order.currency).reduce((sum, payment) => sum + payment.amountMinor, 0);
      if (paidMinor < order.depositRequiredMinor) throw new BadRequestException("До получения требуемой предоплаты заказ можно планировать только предварительно");
    }
    const data = { salesStatus: dto.salesStatus, productionStatus: dto.productionStatus };
    if (!Object.values(data).some(Boolean)) throw new BadRequestException("Укажите хотя бы один статус");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({ where: { id: orderId }, data });
      const summary = "Изменены рабочие статусы заказа";
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "ORDER_STATUSES_UPDATED", summary, metadata: data } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "Order", entityId: orderId, before: order, after: updated } });
      return updated;
    });
  }
  async updateDeadline(orderId: string, dto: UpdateOrderDeadlineDto, actor: User) {
    const requiredDeliveryAt = new Date(dto.requiredDeliveryAt);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('yoleotard-production-settings'))");
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { productionSlot: true } });
      if (!order) throw new NotFoundException("Заказ не найден");
      const leadSetting = await tx.appSetting.findUnique({ where: { section_key: { section: "production", key: "shippingLeadDays" } } });
      const shippingLeadDays = productionSetting(leadSetting?.value, DEFAULT_SHIPPING_LEAD_DAYS, 0, 30);
      if (order.productionSlot && violatesShippingLead(order.productionSlot.endsAt, requiredDeliveryAt, shippingLeadDays)) {
        throw new BadRequestException(`Дата отправки должна быть минимум на ${shippingLeadDays} дн. позже окончания производства`);
      }
      const updated = await tx.order.update({ where: { id: orderId }, data: { requiredDeliveryAt } });
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "ORDER_DEADLINE_UPDATED", summary: "Изменён срок отправки заказа", metadata: { requiredDeliveryAt } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "Order", entityId: orderId, before: order, after: updated } });
      return updated;
    });
  }
  async updateProductionSlot(orderId: string, dto: UpdateProductionSlotDto, actor: User) {
    const startsAt = new Date(dto.startsAt), endsAt = new Date(dto.endsAt);
    if (endsAt < startsAt) throw new BadRequestException("Дата окончания не может быть раньше даты начала");
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('yoleotard-production-settings'))");
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { payments: true, productionSlot: true } });
      if (!order) throw new NotFoundException("Заказ не найден");
      const leadSetting = await tx.appSetting.findUnique({ where: { section_key: { section: "production", key: "shippingLeadDays" } } });
      const shippingLeadDays = productionSetting(leadSetting?.value, DEFAULT_SHIPPING_LEAD_DAYS, 0, 30);
      if (order.requiredDeliveryAt && violatesShippingLead(endsAt, order.requiredDeliveryAt, shippingLeadDays)) {
        throw new BadRequestException(`Производство должно завершиться минимум за ${shippingLeadDays} дн. до отправки`);
      }
      const paid = order.payments.filter((payment) => payment.currency === order.currency).reduce((sum, payment) => sum + payment.amountMinor, 0);
      const tentative = resolveProductionSlotTentative(paid, order.depositRequiredMinor, dto.tentative);
      if (!tentative && paid < order.depositRequiredMinor) throw new BadRequestException("До получения предоплаты слот может быть только предварительным");
      const slot = await tx.productionSlot.upsert({ where:{orderId}, create:{orderId,startsAt,endsAt,capacity:dto.capacity??1,tentative,locked:dto.locked??false}, update:{startsAt,endsAt,capacity:dto.capacity??1,tentative,locked:dto.locked??false} });
      await tx.activity.create({data:{clientId:order.clientId,orderId,type:"PRODUCTION_SLOT_UPDATED",summary:"Обновлён производственный слот",metadata:{startsAt,endsAt,tentative,locked:dto.locked??false}}});
      await tx.auditLog.create({data:{actorId:actor.id,action:order.productionSlot?"UPDATE":"CREATE",entityType:"ProductionSlot",entityId:slot.id,before:order.productionSlot??undefined,after:slot}});return slot;
    });
  }
  async addPayment(orderId: string, dto: AddOrderPaymentDto, actor: User) {
    const currency = dto.currency.toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { payments: true, productionSlot: true } });
      if (!order) throw new NotFoundException("Заказ не найден");
      if (currency !== order.currency) throw new BadRequestException(`Оплата должна быть в валюте заказа: ${order.currency}`);
      const alreadyPaid = order.payments.filter((payment) => payment.currency === order.currency).reduce((sum, payment) => sum + payment.amountMinor, 0);
      const totalPaid = alreadyPaid + dto.amountMinor;
      const paymentStatus = totalPaid >= order.priceMinor ? "PAID" : totalPaid >= order.depositRequiredMinor ? "DEPOSIT_PAID" : "PARTIALLY_PAID";
      const confirmsProductionSlot = totalPaid >= order.depositRequiredMinor && order.productionSlot?.tentative;
      const payment = await tx.payment.create({ data: { orderId, amountMinor: dto.amountMinor, currency, method: dto.method, receivedAt: new Date(dto.receivedAt), reference: dto.reference?.trim() || null, notes: dto.notes?.trim() || null } });
      const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { paymentStatus, ...(confirmsProductionSlot && order.productionStatus === "NOT_SCHEDULED" ? { productionStatus: "SCHEDULED" } : {}) } });
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "PAYMENT_RECEIVED", summary: `Получена оплата ${(dto.amountMinor / 100).toFixed(2)} ${currency}`, metadata: { paymentId: payment.id, method: dto.method } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Payment", entityId: payment.id, after: payment } });
      if (confirmsProductionSlot && order.productionSlot) {
        const slot = await tx.productionSlot.update({ where: { orderId }, data: { tentative: false } });
        await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "PRODUCTION_SLOT_CONFIRMED", summary: "Производственный слот подтверждён после получения предоплаты", metadata: { paymentId: payment.id, depositRequiredMinor: order.depositRequiredMinor, currency, productionStatus: updatedOrder.productionStatus } } });
        await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "ProductionSlot", entityId: slot.id, before: order.productionSlot, after: slot } });
        if (updatedOrder.productionStatus !== order.productionStatus) await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "Order", entityId: orderId, before: { productionStatus: order.productionStatus }, after: { productionStatus: updatedOrder.productionStatus } } });
      }
      return payment;
    });
  }

  async addMeasurement(orderId: string, dto: OrderMeasurementDto, actor: User) {
    const { measuredAt, standardHeight, notes, expectedMeasurementId, ...numbered } = dto;
    if (Object.values(numbered).some(value => value !== undefined && !Number.isInteger(value * 2))) {
      throw new BadRequestException("Измерения должны вводиться с шагом 0,5 см");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { items: true } });
      if (!order) throw new NotFoundException("Заказ не найден");
      if (order.type === "GROUP_ORDER" || order.type === "PAIR" || order.items.length > 1) {
        throw new BadRequestException("Добавляйте замеры отдельно для каждого спортсмена состава");
      }
      const item = order.items[0];
      if (order.measurementId && item?.measurementId && order.measurementId !== item.measurementId) {
        throw new BadRequestException("Снимки замеров заказа не совпадают");
      }
      const previousMeasurementId = order.measurementId ?? item?.measurementId ?? null;
      if ((expectedMeasurementId ?? null) !== previousMeasurementId) {
        throw new ConflictException("Замеры уже изменены другим пользователем. Обновите заказ и повторите");
      }
      if (order.athleteId && item?.athleteId && order.athleteId !== item.athleteId) {
        throw new BadRequestException("Спортсмены заказа не совпадают");
      }
      const athleteId = order.athleteId ?? order.items[0]?.athleteId;
      if (!athleteId) throw new BadRequestException("Сначала укажите спортсмена в заказе");
      const athlete = await tx.athlete.findFirst({ where: { id: athleteId, clientId: order.clientId, archivedAt: null } });
      if (!athlete) throw new NotFoundException("Спортсмен заказа не найден");
      const measurement = await tx.measurement.create({
        data: {
          athleteId: athlete.id,
          measuredAt: new Date(measuredAt),
          chest: dto.m1,
          waist: dto.m2,
          hips: dto.m3,
          torso: dto.m15,
          values: { standardHeight, ...numbered },
          notes,
          source: previousMeasurementId ? `Редактирование замеров заказа ${order.number}` : standardHeight ? `Ростовой стандарт ${standardHeight} см` : "Ручной ввод из заказа",
        },
      });
      const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { athleteId: athlete.id, measurementId: measurement.id } });
      if (item) await tx.orderItem.update({ where: { id: item.id }, data: { athleteId: athlete.id, measurementId: measurement.id } });
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: previousMeasurementId ? "MEASUREMENT_REPLACED" : "MEASUREMENT_CREATED", summary: previousMeasurementId ? `Обновлены замеры для заказа ${order.number}` : `Добавлены замеры для заказа ${order.number}`, metadata: { measurementId: measurement.id, previousMeasurementId, athleteId: athlete.id, standardHeight } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Measurement", entityId: measurement.id, after: measurement } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "Order", entityId: orderId, before: { athleteId: order.athleteId, measurementId: order.measurementId }, after: { athleteId: updatedOrder.athleteId, measurementId: updatedOrder.measurementId } } });
      return measurement;
    });
  }

  async upload(dto: UploadModelImageDto) {
    const sourceExt = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[dto.mime];
    if (!sourceExt) throw new BadRequestException("Допустимы JPG, PNG или WebP");
    const source = Buffer.from(dto.data.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!source.length || source.length > MAX_SOURCE_BYTES) throw new BadRequestException("Размер изображения должен быть до 5 МБ");
    let stored = source, extension = sourceExt, optimized = false;
    if (source.length > OPTIMIZE_FROM_BYTES) {
      try {
        stored = await sharp(source).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
        extension = "jpg"; optimized = true;
      } catch { throw new BadRequestException("Не удалось обработать изображение. Выберите другой файл JPG, PNG или WebP"); }
    }
    const dir = join(uploadsRoot(), "order-models"); await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${extension}`; await writeFile(join(dir, name), stored);
    return { path: name, url: `/api/orders/images/${name}`, optimized, originalBytes: source.length, storedBytes: stored.length };
  }

  async create(dto: CreateOrderDto, actor: User) {
    const items = dto.items?.length ? dto.items : [{ athleteId: dto.athleteId, measurementId: dto.measurementId, name: dto.description, quantity: 1, priceMinor: dto.priceMinor, modelImagePath: dto.modelImagePath }];
    const athleteIds = [...new Set([dto.athleteId, ...items.map((item) => item.athleteId)].filter((id): id is string => Boolean(id)))];
    const measurementRefs = [
      ...(dto.measurementId ? [{ measurementId: dto.measurementId, athleteId: dto.athleteId }] : []),
      ...items.flatMap((item) => item.measurementId ? [{ measurementId: item.measurementId, athleteId: item.athleteId }] : []),
    ];
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('yoleotard-production-settings'))");
      const depositSetting = await tx.appSetting.findUnique({ where: { section_key: { section: "orders", key: "depositPercent" } } });
      const [durationSetting, leadSetting] = await Promise.all([
        tx.appSetting.findUnique({ where: { section_key: { section: "production", key: "defaultDurationDays" } } }),
        tx.appSetting.findUnique({ where: { section_key: { section: "production", key: "shippingLeadDays" } } }),
      ]);
      const depositPercent = typeof depositSetting?.value === "number" && Number.isInteger(depositSetting.value) && depositSetting.value >= 0 && depositSetting.value <= 100 ? depositSetting.value : 50;
      const depositRequiredMinor = dto.depositRequiredMinor ?? calculateDepositMinor(dto.priceMinor, depositPercent);
      if (depositRequiredMinor > dto.priceMinor) throw new BadRequestException("Предоплата не может превышать цену");
      const client = await tx.client.findFirst({ where: { id: dto.clientId, archivedAt: null } });
      if (!client) throw new NotFoundException("Клиент не найден");
      if (athleteIds.length && await tx.athlete.count({ where: { id: { in: athleteIds }, clientId: dto.clientId, archivedAt: null } }) !== athleteIds.length) throw new BadRequestException("Один или несколько спортсменов не принадлежат клиенту");
      if (measurementRefs.length) {
        const measurements = await tx.measurement.findMany({
          where: { id: { in: [...new Set(measurementRefs.map((reference) => reference.measurementId))] }, athlete: { clientId: dto.clientId, archivedAt: null } },
          select: { id: true, athleteId: true },
        });
        const measurementById = new Map(measurements.map((measurement) => [measurement.id, measurement.athleteId]));
        if (measurementRefs.some((reference) => measurementById.get(reference.measurementId) !== reference.athleteId)) throw new BadRequestException("Снимок замеров не принадлежит выбранному спортсмену клиента");
      }
      const number = await nextOrderNumber(tx);
      const order = await tx.order.create({ data: { number, clientId: dto.clientId, athleteId: dto.athleteId, measurementId: dto.measurementId, type: dto.type, notes: dto.description, modelImagePath: dto.modelImagePath, requiredDeliveryAt: dto.requiredDeliveryAt ? new Date(dto.requiredDeliveryAt) : undefined, priceMinor: dto.priceMinor, depositRequiredMinor, currency: dto.currency.toUpperCase(), responsibleManagerId: actor.id, items: { create: items.map((item) => ({ athleteId: item.athleteId, measurementId: item.measurementId, name: item.name, quantity: item.quantity, priceMinor: item.priceMinor, modelImagePath: item.modelImagePath })) } } });
      if (order.requiredDeliveryAt) {
        const defaultDurationDays = productionSetting(durationSetting?.value, DEFAULT_PRODUCTION_DURATION_DAYS, 1, 90);
        const shippingLeadDays = productionSetting(leadSetting?.value, DEFAULT_SHIPPING_LEAD_DAYS, 0, 30);
        const { startsAt, endsAt } = productionWindow(order.requiredDeliveryAt, defaultDurationDays, shippingLeadDays);
        const slot = await tx.productionSlot.create({ data: { orderId: order.id, startsAt, endsAt, capacity: 1, tentative: true, locked: false } });
        await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "ProductionSlot", entityId: slot.id, after: slot } });
      }
      await tx.activity.create({ data: { clientId: dto.clientId, orderId: order.id, type: "ORDER_CREATED", summary: `Создан заказ ${number}` } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Order", entityId: order.id, after: order } });
      return order;
    });
  }
}
