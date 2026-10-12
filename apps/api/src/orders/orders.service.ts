import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Prisma, User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { appliedPaymentMinor, buildPaymentConversion, ExchangeRatesService, EXCHANGE_RATE_ADVISORY_LOCK, parseExchangeRateCache, type ExchangeRateCurrency } from "../finance/exchange-rates";
import { presentClientContact } from "../communications/inbound-routing";
import { uploadsRoot } from "../uploads";
import { AddOrderPaymentDto, ArchiveOrdersDto, CreateOrderDto, DeleteProductionSlotDto, OrderMeasurementDto, UpdateOrderCurrencyDto, UpdateOrderDeadlineDto, UpdateOrderDeliveryAddressDto, UpdateOrderDetailsDto, UpdateOrderDisciplineDto, UpdateOrderItemDetailsDto, UpdateOrderModelImageDto, UpdateOrderStatusesDto, UpdateProductionSlotDto, UploadModelImageDto, WebsiteSalesCorrectionDto } from "./orders.dto";
import { archiveOrdersTransaction, OrderArchiveError, ORDER_ARCHIVE_ERROR } from "./order-archive";
import { DELIVERY_ADDRESS_ERROR, DeliveryAddressOperationError, persistOrderDeliveryAddress } from "./order-delivery-address";
import { changeOrderCurrencyTransaction, OrderCurrencyChangeError } from "./order-currency";
import { DEFAULT_PRODUCTION_DURATION_DAYS, DEFAULT_SHIPPING_LEAD_DAYS, productionSetting, productionWindow, requiresProduction, resolveProductionSlotTentative, violatesShippingLead } from "./production-rules";
import { loadProductionOrders, type ProductionOrderRepository } from "./production-context";
import { isOrderImageName } from "./order-image-name";
import { ORDER_MODEL_IMAGE_ERROR, OrderModelImageOperationError, persistOrderModelImage } from "./order-model-image";
import { ORDER_DETAILS_ERROR, OrderDetailsOperationError, persistOrderDetails } from "./order-details";
import { ORDER_ITEM_DETAILS_ERROR, OrderItemDetailsError, persistOrderItemDetails } from "./order-item-details";
import { keycrmSourceChannel } from "../keycrm/keycrm-normalizer";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const OPTIMIZE_FROM_BYTES = 2 * 1024 * 1024;
function keycrmSourceNames(context: Prisma.JsonValue | null | undefined) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {} as Record<string,string>;
  const value=(context as Record<string,unknown>).sourceNames;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string,string>;
  return Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
}
function keycrmOrderSource(externalData: Prisma.JsonValue | null, sourceNames: Record<string,string>) {
  if (!externalData || typeof externalData !== "object" || Array.isArray(externalData)) return {id:"",name:""};
  const sourceId=(externalData as Record<string,unknown>).source_id;
  const id=sourceId===null||sourceId===undefined?"":String(sourceId);
  return {id,name:sourceNames[id]??""};
}
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
  constructor(private readonly prisma: PrismaService, private readonly exchangeRates: ExchangeRatesService) {}

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
    const orders = await this.prisma.order.findMany({
      where: { archivedAt: null, ...(query ? { OR: [
        { number: { contains: query, mode: "insensitive" as const } },
        { client: { displayName: { contains: query, mode: "insensitive" as const } } },
        { athlete: { is: { firstName: { contains: query, mode: "insensitive" as const } } } },
        { athlete: { is: { lastName: { contains: query, mode: "insensitive" as const } } } },
      ] } : {}) },
      orderBy: [{ requiredDeliveryAt: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, number: true, type: true, discipline: true, country: true,
        deliveryAddressSet: true, deliveryRecipient: true, deliveryRecipientPhone: true, deliveryAddressLine1: true, deliveryAddressLine2: true,
        deliveryCity: true, deliveryRegion: true, deliveryPostalCode: true, deliveryAddressText: true,
        deliveryServiceName: true,
        deliveryTrackingCode: true,
        requiredDeliveryAt: true, promisedProductionAt: true, priority: true, priceMinor: true,
        deliveryMinor: true, discountMinor: true, taxMinor: true, giftWrapMinor: true,
        depositRequiredMinor: true, currency: true, salesStatus: true, productionStatus: true,
        paymentStatus: true, shippingStatus: true, modelImagePath: true, externalImageUrl: true, notes: true,
        buyerComment: true, managerComment: true, giftMessage: true, promocode: true, isGift: true,
        sourceSystem: true, sourceAccount: true, externalId: true, externalNumber: true, externalUpdatedAt: true,
        createdAt: true, productionSlot: true,
        client: { select: { id: true, displayName: true, country: true, city: true, address: true, postalCode: true, language: true, source: true, phone: true, email: true, facebook: true, instagram: true, whatsapp: true } },
        athlete: { select: { id: true, firstName: true, lastName: true } },
        measurement: { select: { id: true, athleteId: true, measuredAt: true, values: true } },
        items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, quantity: true, priceMinor: true, modelImagePath: true, externalImageUrl: true, sku: true, properties: true, productionStatus: true, athlete: { select: { id: true, firstName: true, lastName: true } }, measurement: { select: { id: true, athleteId: true, measuredAt: true, values: true } } } },
        activities: { select: { id: true, type: true, summary: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 30 },
        payments: { where: { voidedAt: null }, select: { id: true, amountMinor: true, currency: true, appliedAmountMinor: true, appliedCurrency: true, exchangeRateSnapshot: true, method: true, receivedAt: true, reference: true, notes: true }, orderBy: { receivedAt: "desc" } }, shipment: true, invoices: { where: { archivedAt: null }, select: { id: true, number: true, status: true, language: true, totalMinor: true, issueDate: true }, orderBy: { createdAt: "desc" } },
      },
    });
    return orders.map((order) => ({
      ...order,
      client: presentClientContact(order.client),
    }));
  }

  async detail(orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, archivedAt: null },
      select: {
        id: true, number: true, type: true, discipline: true, country: true,
        deliveryAddressSet: true, deliveryRecipient: true, deliveryRecipientPhone: true, deliveryAddressLine1: true, deliveryAddressLine2: true,
        deliveryCity: true, deliveryRegion: true, deliveryPostalCode: true, deliveryAddressText: true,
        deliveryServiceName: true,
        deliveryTrackingCode: true,
        requiredDeliveryAt: true, promisedProductionAt: true, priority: true, priceMinor: true,
        deliveryMinor: true, discountMinor: true, taxMinor: true, giftWrapMinor: true,
        depositRequiredMinor: true, currency: true, salesStatus: true, productionStatus: true,
        paymentStatus: true, shippingStatus: true, modelImagePath: true, externalImageUrl: true, notes: true,
        buyerComment: true, managerComment: true, giftMessage: true, promocode: true, isGift: true,
        sourceSystem: true, sourceAccount: true, externalId: true, externalNumber: true, externalUpdatedAt: true,
        createdAt: true, updatedAt: true, productionSlot: true,
        responsibleManager: { select: { id: true, displayName: true } },
        client: { select: { id: true, displayName: true, country: true, city: true, address: true, postalCode: true, language: true, source: true, phone: true, email: true, facebook: true, instagram: true, whatsapp: true } },
        athlete: {
          select: {
            id: true, firstName: true, lastName: true,
            measurements: { orderBy: [{ measuredAt: "desc" }, { createdAt: "desc" }], select: { id: true, athleteId: true, measuredAt: true, unit: true, height: true, chest: true, waist: true, hips: true, torso: true, values: true, notes: true, source: true } },
          },
        },
        measurement: { select: { id: true, athleteId: true, measuredAt: true, unit: true, height: true, chest: true, waist: true, hips: true, torso: true, values: true, notes: true, source: true } },
        items: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true, name: true, quantity: true, priceMinor: true, modelImagePath: true, externalImageUrl: true, sku: true, properties: true, productionStatus: true,
            athlete: {
              select: {
                id: true, firstName: true, lastName: true,
                measurements: { orderBy: [{ measuredAt: "desc" }, { createdAt: "desc" }], select: { id: true, athleteId: true, measuredAt: true, unit: true, height: true, chest: true, waist: true, hips: true, torso: true, values: true, notes: true, source: true } },
              },
            },
            measurement: { select: { id: true, athleteId: true, measuredAt: true, unit: true, height: true, chest: true, waist: true, hips: true, torso: true, values: true, notes: true, source: true } },
          },
        },
        activities: { select: { id: true, type: true, summary: true, metadata: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 },
        payments: { where: { voidedAt: null }, select: { id: true, amountMinor: true, currency: true, appliedAmountMinor: true, appliedCurrency: true, exchangeRateSnapshot: true, method: true, receivedAt: true, reference: true, notes: true }, orderBy: { receivedAt: "desc" } },
        shipment: true,
        invoices: { where: { archivedAt: null }, select: { id: true, number: true, status: true, language: true, currency: true, totalMinor: true, issueDate: true, dueDate: true }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!order) throw new NotFoundException("Заказ не найден");
    const paymentHistory = await this.prisma.payment.findMany({
      where: { orderId },
      select: { id: true, amountMinor: true, currency: true, appliedAmountMinor: true, appliedCurrency: true, exchangeRateSnapshot: true, method: true, receivedAt: true, reference: true, notes: true, voidedAt: true, voidReason: true, createdAt: true },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    });
    const items = order.items.map(({ athlete, ...item }) => {
      if (!athlete) return { ...item, athlete: null, measurementHistory: [] };
      const { measurements, ...athleteSummary } = athlete;
      return { ...item, athlete: athleteSummary, measurementHistory: measurements };
    });
    const legacyAthlete = order.athlete;
    const measurementHistory = legacyAthlete?.measurements ?? [];
    const athlete = legacyAthlete ? { id: legacyAthlete.id, firstName: legacyAthlete.firstName, lastName: legacyAthlete.lastName } : null;
    return { ...order, athlete, client: presentClientContact(order.client), items, paymentHistory, measurementHistory };
  }

  async productionList(orderId?: string, from?: string, to?: string) {
    try {
      return await loadProductionOrders(this.prisma.order as unknown as ProductionOrderRepository, orderId, from, to);
    } catch (error) {
      const code = error && typeof error === "object" && "message" in error ? String(error.message) : "";
      if (code === "INVALID_PRODUCTION_RANGE") {
        throw new BadRequestException("Некорректный период производства");
      }
      if (code === "PRODUCTION_RESULT_LIMIT_EXCEEDED") {
        throw new BadRequestException("В выбранном периоде более 1000 активных заказов. Сократите период");
      }
      throw error;
    }
  }

  async archiveOrders(dto: ArchiveOrdersDto, actor: User) {
    try {
      return await this.prisma.$transaction((tx) => archiveOrdersTransaction(tx, dto.orderIds, actor.id));
    } catch (error) {
      if (!(error instanceof OrderArchiveError)) throw error;
      if (error.code === ORDER_ARCHIVE_ERROR.emptySelection) throw new BadRequestException("Выберите хотя бы один заказ");
      throw new ConflictException("Один или несколько выбранных заказов уже недоступны. Обновите список и повторите действие");
    }
  }
  async correctWebsiteSales(dto: WebsiteSalesCorrectionDto, actor: User) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('yoleotard-website-sales-correction'))");
      const latestSync = await tx.keycrmSyncRun.findFirst({ where: { status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { createdAt: "desc" }, select: { context: true } });
      const sourceNames = keycrmSourceNames(latestSync?.context);
      const eligibleWhere = { archivedAt: null, type: { not: "WEBSITE_SALE" as const }, sourceSystem: "KEYCRM", OR: [{ AND: [{ deliveryTrackingCode: { not: null } }, { deliveryTrackingCode: { not: "" } }] }, { shipment: { is: { AND: [{ trackingNumber: { not: null } }, { trackingNumber: { not: "" } }] } } }] };
      const requestedIds = dto.candidates?.map(candidate => candidate.orderId) ?? [];
      if (!dto.dryRun && (requestedIds.length === 0 || new Set(requestedIds).size !== requestedIds.length)) throw new BadRequestException("Повторите предварительную проверку заказов");
      if (!dto.dryRun) for (const orderId of [...requestedIds].sort()) await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const possibleOrders = await tx.order.findMany({ where: { ...eligibleWhere, ...(!dto.dryRun ? { id: { in: requestedIds } } : {}) }, include: { productionSlot: true, shipment: true }, take: 10001, orderBy: { id: "asc" } });
      const orders = possibleOrders.filter(order => keycrmSourceChannel(keycrmOrderSource(order.externalData, sourceNames).name) === "WEBSITE");
      if (orders.length > 5000) throw new BadRequestException("Найдено более 5000 заказов. Выполните коррекцию после уточнения выборки");
      if (dto.dryRun) return { dryRun: true, matched: orders.length, updated: 0, orderNumbers: orders.map(order => order.number), candidates: orders.map(order => { const source=keycrmOrderSource(order.externalData,sourceNames); return { orderId: order.id, expectedUpdatedAt: order.updatedAt.toISOString(), expectedType: order.type, expectedProductionSlotUpdatedAt: order.productionSlot?.updatedAt.toISOString() ?? null, expectedSourceId: source.id, expectedSourceName: source.name } }) };
      const expected = new Map(dto.candidates!.map(candidate => [candidate.orderId, candidate]));
      const stale = orders.length !== requestedIds.length || orders.some(order => {
        const candidate = expected.get(order.id);
        const source=keycrmOrderSource(order.externalData,sourceNames);
        return !candidate || candidate.expectedUpdatedAt !== order.updatedAt.toISOString() || candidate.expectedType !== order.type || candidate.expectedProductionSlotUpdatedAt !== (order.productionSlot?.updatedAt.toISOString() ?? null) || candidate.expectedSourceId !== source.id || candidate.expectedSourceName !== source.name;
      });
      if (stale) throw new ConflictException("Список заказов изменился. Повторите предварительную проверку");
      for (const order of orders) {
        if (order.productionSlot) {
          await tx.productionSlot.delete({ where: { orderId: order.id } });
          await tx.auditLog.create({ data: { actorId: actor.id, action: "DELETE", entityType: "ProductionSlot", entityId: order.productionSlot.id, before: order.productionSlot } });
        }
        const updated = await tx.order.update({ where: { id: order.id }, data: { type: "WEBSITE_SALE", productionStatus: "NOT_SCHEDULED" } });
        await tx.activity.create({ data: { clientId: order.clientId, orderId: order.id, type: "ORDER_WEBSITE_SALE_CORRECTED", summary: "Тип заказа исправлен на «Продажа с сайта»", metadata: { hadProductionSlot: Boolean(order.productionSlot), trackingNumber: order.shipment?.trackingNumber ?? order.deliveryTrackingCode } } });
        await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "Order", entityId: order.id, before: { type: order.type, productionStatus: order.productionStatus }, after: { type: updated.type, productionStatus: updated.productionStatus } } });
      }
      return { dryRun: false, matched: orders.length, updated: orders.length, orderNumbers: orders.slice(0, 20).map(order => order.number), candidates: [] };
    });
  }


  async updateStatuses(orderId: string, dto: UpdateOrderStatusesDto, actor: User) {
    const data = { salesStatus: dto.salesStatus, productionStatus: dto.productionStatus };
    if (!Object.values(data).some(Boolean)) throw new BadRequestException("Укажите хотя бы один статус");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { payments: { where: { voidedAt: null } } } });
      if (!order) throw new NotFoundException("Заказ не найден");
      if (dto.productionStatus && dto.productionStatus !== "NOT_SCHEDULED" && !requiresProduction(order.type)) {
        throw new BadRequestException("Быстрые продажи и готовые изделия не планируются в производство");
      }
      const committedProductionStatuses = new Set(["SCHEDULED", "MATERIALS", "CUTTING", "SEWING", "DECORATION", "QUALITY_CONTROL", "READY"]);
      if (dto.productionStatus && committedProductionStatuses.has(dto.productionStatus)) {
        const paidMinor = order.payments.reduce((sum, payment) => sum + appliedPaymentMinor(payment, order.currency), 0);
        if (paidMinor < order.depositRequiredMinor) throw new BadRequestException("До получения требуемой предоплаты заказ можно планировать только предварительно");
      }
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
      if (requiresProduction(order.type) && order.productionSlot && violatesShippingLead(order.productionSlot.endsAt, requiredDeliveryAt, shippingLeadDays)) {
        throw new BadRequestException(`Дата отправки должна быть минимум на ${shippingLeadDays} дн. позже окончания производства`);
      }
      const updated = await tx.order.update({ where: { id: orderId }, data: { requiredDeliveryAt } });
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "ORDER_DEADLINE_UPDATED", summary: "Изменён срок отправки заказа", metadata: { requiredDeliveryAt } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "Order", entityId: orderId, before: order, after: updated } });
      return updated;
    });
  }
  async updateCurrency(orderId: string, dto: UpdateOrderCurrencyDto, actor: User) {
    try {
      return await this.prisma.$transaction(tx => changeOrderCurrencyTransaction(tx, orderId, dto.currency, actor.id));
    } catch (error) {
      if (!(error instanceof OrderCurrencyChangeError)) throw error;
      if (error.code === "ORDER_NOT_FOUND") throw new NotFoundException({ code: error.code, message: error.message });
      throw new BadRequestException({ code: error.code, message: error.message });
    }
  }
  async updateDiscipline(orderId: string, dto: UpdateOrderDisciplineDto, actor: User) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null } });
      if (!order) throw new NotFoundException("Заказ не найден");
      const updated = await tx.order.update({ where: { id: orderId }, data: { discipline: dto.discipline } });
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "ORDER_DISCIPLINE_UPDATED", summary: "Изменён вид спорта заказа", metadata: { discipline: dto.discipline } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "Order", entityId: orderId, before: order, after: updated } });
      return updated;
    });
  }
  async updateModelImage(orderId: string, dto: UpdateOrderModelImageDto, actor: User) {
    if (!isOrderImageName(dto.modelImagePath)) throw new BadRequestException("Некорректное имя изображения заказа");
    try {
      const image = await stat(join(uploadsRoot(), "order-models", dto.modelImagePath));
      if (!image.isFile()) throw new Error("not a file");
    } catch {
      throw new NotFoundException("Изображение заказа не найдено");
    }
    try {
      return await this.prisma.$transaction((tx) => persistOrderModelImage(tx, orderId, dto, actor.id));
    } catch (error) {
      if (!(error instanceof OrderModelImageOperationError)) throw error;
      if (error.code === ORDER_MODEL_IMAGE_ERROR.orderNotFound) throw new NotFoundException({ code: error.code, message: "Заказ не найден" });
      if (error.code === ORDER_MODEL_IMAGE_ERROR.changed) throw new ConflictException({ code: error.code, message: "Изображение уже изменено другим пользователем. Обновите заказ и повторите действие" });
      throw new BadRequestException({ code: error.code, message: "Позиция не принадлежит заказу" });
    }
  }
  async updateDetails(orderId: string, dto: UpdateOrderDetailsDto, actor: User) {
    if (dto.modelImagePath) {
      if (!isOrderImageName(dto.modelImagePath)) throw new BadRequestException("Некорректное имя изображения заказа");
      try {
        const image = await stat(join(uploadsRoot(), "order-models", dto.modelImagePath));
        if (!image.isFile()) throw new Error("not a file");
      } catch { throw new NotFoundException("Изображение заказа не найдено"); }
    }
    if (dto.currency !== undefined && (dto.expectedCurrency === undefined || dto.priceDirty === undefined || dto.expectedType === undefined || dto.expectedRequiredDeliveryAt === undefined)) {
      throw new BadRequestException({ code: ORDER_DETAILS_ERROR.changed, message: "Для изменения валюты обновите заказ и повторите действие" });
    }
    try {
      return await this.prisma.$transaction(async tx => {
        let detailsInput = dto;
        if (dto.currency !== undefined && dto.currency !== dto.expectedCurrency) {
          const converted = await changeOrderCurrencyTransaction(tx, orderId, dto.currency as ExchangeRateCurrency, actor.id, new Date(), {
            currency: dto.expectedCurrency!,
            type: dto.expectedType!,
            description: dto.expectedDescription,
            priceMinor: dto.expectedPriceMinor,
            requiredDeliveryAt: dto.expectedRequiredDeliveryAt ?? null,
            modelImagePath: dto.expectedModelImagePath,
          });
          detailsInput = {
            ...dto,
            priceMinor: dto.priceDirty ? dto.priceMinor : converted.order.priceMinor,
            expectedCurrency: converted.order.currency,
            expectedType: converted.order.type,
            expectedDescription: converted.order.notes ?? null,
            expectedPriceMinor: converted.order.priceMinor,
            expectedRequiredDeliveryAt: converted.order.requiredDeliveryAt?.toISOString() ?? null,
            expectedModelImagePath: converted.order.modelImagePath ?? null,
          };
        }
        return persistOrderDetails(tx, orderId, detailsInput, actor.id);
      });
    } catch (error) {
      if (error instanceof OrderCurrencyChangeError) {
        if (error.code === "ORDER_NOT_FOUND") throw new NotFoundException({ code: error.code, message: error.message });
        if (error.code === "ORDER_CHANGED") throw new ConflictException({ code: error.code, message: "Заказ уже изменён другим пользователем. Обновите заказ и повторите действие" });
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      if (!(error instanceof OrderDetailsOperationError)) throw error;
      if (error.code === ORDER_DETAILS_ERROR.orderNotFound) throw new NotFoundException({ code: error.code, message: "Заказ не найден" });
      if (error.code === ORDER_DETAILS_ERROR.descriptionRequired) throw new BadRequestException({ code: error.code, message: "Добавьте описание заказа" });
      if (error.code === ORDER_DETAILS_ERROR.depositWouldUnconfirmProduction) throw new BadRequestException({ code: error.code, message: "Сначала внесите оплату до новой суммы предоплаты либо измените условия предоплаты" });
      if (error.code === ORDER_DETAILS_ERROR.productionDeadlineConflict) throw new BadRequestException({ code: error.code, message: "Срок отправки раньше допустимого завершения производства" });
      if (error.code === ORDER_DETAILS_ERROR.changed) throw new ConflictException({ code: error.code, message: "Описание или цена уже изменены другим пользователем. Обновите заказ и повторите действие" });
      throw new ConflictException({ code: error.code, message: "Изображение уже изменено другим пользователем. Обновите заказ и повторите действие" });
    }
  }
  async updateItemDetails(orderId: string, itemId: string, dto: UpdateOrderItemDetailsDto, actor: User) {
    if (dto.modelImagePath) {
      if (!isOrderImageName(dto.modelImagePath)) throw new BadRequestException("Некорректное имя изображения заказа");
      try { const image=await stat(join(uploadsRoot(),"order-models",dto.modelImagePath)); if(!image.isFile())throw new Error("not a file"); }
      catch { throw new NotFoundException("Изображение заказа не найдено"); }
    }
    try { return await this.prisma.$transaction(tx=>persistOrderItemDetails(tx,orderId,itemId,dto,actor.id)); }
    catch(error){
      if(!(error instanceof OrderItemDetailsError))throw error;
      if(error.code===ORDER_ITEM_DETAILS_ERROR.orderNotFound)throw new NotFoundException("Заказ не найден");
      if(error.code===ORDER_ITEM_DETAILS_ERROR.itemNotFound)throw new NotFoundException("Дизайн заказа не найден");
      if(error.code===ORDER_ITEM_DETAILS_ERROR.depositWouldUnconfirmProduction)throw new BadRequestException("Сначала внесите оплату до новой суммы предоплаты");
      if(error.code===ORDER_ITEM_DETAILS_ERROR.totalTooLarge)throw new BadRequestException("Итоговая сумма заказа превышает допустимый предел");
      throw new ConflictException("Дизайн уже изменён другим пользователем. Обновите заказ и повторите действие");
    }
  }
  async updateDeliveryAddress(orderId: string, dto: UpdateOrderDeliveryAddressDto, actor: User) {
    try {
      return await this.prisma.$transaction(tx => persistOrderDeliveryAddress(tx, orderId, dto, actor.id));
    } catch (error) {
      if (!(error instanceof DeliveryAddressOperationError)) throw error;
      if (error.code === DELIVERY_ADDRESS_ERROR.orderNotFound) throw new NotFoundException({ code: error.code });
      throw new BadRequestException({ code: error.code });
    }
  }
  async updateProductionSlot(orderId: string, dto: UpdateProductionSlotDto, actor: User) {
    const startsAt = new Date(dto.startsAt), endsAt = new Date(dto.endsAt);
    if (endsAt < startsAt) throw new BadRequestException("Дата окончания не может быть раньше даты начала");
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('yoleotard-production-settings'))");
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { payments: { where: { voidedAt: null } }, productionSlot: true } });
      if (!order) throw new NotFoundException("Заказ не найден");
      if (!requiresProduction(order.type)) throw new BadRequestException("Быстрые продажи и готовые изделия не планируются в производство");
      const leadSetting = await tx.appSetting.findUnique({ where: { section_key: { section: "production", key: "shippingLeadDays" } } });
      const shippingLeadDays = productionSetting(leadSetting?.value, DEFAULT_SHIPPING_LEAD_DAYS, 0, 30);
      if (order.requiredDeliveryAt && violatesShippingLead(endsAt, order.requiredDeliveryAt, shippingLeadDays)) {
        throw new BadRequestException(`Производство должно завершиться минимум за ${shippingLeadDays} дн. до отправки`);
      }
      const paid = order.payments.reduce((sum, payment) => sum + appliedPaymentMinor(payment, order.currency), 0);
      const tentative = resolveProductionSlotTentative(paid, order.depositRequiredMinor, dto.tentative);
      if (!tentative && paid < order.depositRequiredMinor) throw new BadRequestException("До получения предоплаты слот может быть только предварительным");
      const slot = await tx.productionSlot.upsert({ where:{orderId}, create:{orderId,startsAt,endsAt,capacity:dto.capacity??1,tentative,locked:dto.locked??false}, update:{startsAt,endsAt,capacity:dto.capacity??1,tentative,locked:dto.locked??false,sourceSystem:null,sourceAccount:null,externalId:null} });
      await tx.activity.create({data:{clientId:order.clientId,orderId,type:"PRODUCTION_SLOT_UPDATED",summary:"Обновлён производственный слот",metadata:{startsAt,endsAt,tentative,locked:dto.locked??false}}});
      await tx.auditLog.create({data:{actorId:actor.id,action:order.productionSlot?"UPDATE":"CREATE",entityType:"ProductionSlot",entityId:slot.id,before:order.productionSlot??undefined,after:slot}});return slot;
    });
  }
  async deleteProductionSlot(orderId: string, dto: DeleteProductionSlotDto, actor: User) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { productionSlot: true } });
      if (!order) throw new NotFoundException("Заказ не найден");
      if (!order.productionSlot) throw new NotFoundException("Производственный слот не найден");
      if (order.productionSlot.updatedAt.toISOString() !== dto.expectedUpdatedAt) throw new ConflictException("Производственный слот уже изменён. Обновите план и повторите действие");
      const slot = await tx.productionSlot.delete({ where: { orderId } });
      const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { productionStatus: "NOT_SCHEDULED" } });
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "PRODUCTION_SLOT_DELETED", summary: "Производственный слот удалён", metadata: { slotId: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "DELETE", entityType: "ProductionSlot", entityId: slot.id, before: slot, after: { orderId, productionStatus: updatedOrder.productionStatus } } });
      return { deleted: true, orderId, productionStatus: updatedOrder.productionStatus };
    });
  }
  async addPayment(orderId: string, dto: AddOrderPaymentDto, actor: User) {
    const currency = dto.currency.toUpperCase() as ExchangeRateCurrency;
    const orderBrief = await this.prisma.order.findFirst({ where: { id: orderId, archivedAt: null }, select: { currency: true } });
    if (!orderBrief) throw new NotFoundException("Заказ не найден");
    if (currency !== orderBrief.currency) await this.exchangeRates.currentOrRefresh(actor);
    return this.prisma.$transaction(async (tx) => {
      if (currency !== orderBrief.currency) await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", EXCHANGE_RATE_ADVISORY_LOCK);
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { payments: { where: { voidedAt: null } }, productionSlot: true } });
      if (!order) throw new NotFoundException("Заказ не найден");
      if (order.currency !== orderBrief.currency) throw new ConflictException("Валюта заказа изменилась. Повторите добавление оплаты");
      let conversion: ReturnType<typeof buildPaymentConversion> | null = null;
      if (currency !== order.currency) {
        const cacheSetting = await tx.appSetting.findUnique({ where: { section_key: { section: "finance", key: "exchangeRateCache" } } });
        try { conversion = buildPaymentConversion(parseExchangeRateCache(cacheSetting?.value), dto.amountMinor, currency, order.currency as ExchangeRateCurrency); }
        catch (error) { throw new BadRequestException(error instanceof Error ? `Не удалось пересчитать оплату: ${error.message}` : "Не удалось пересчитать оплату"); }
      }
      const appliedAmountMinor = conversion?.appliedAmountMinor ?? dto.amountMinor;
      const alreadyPaid = order.payments.reduce((sum, payment) => sum + appliedPaymentMinor(payment, order.currency), 0);
      const totalPaid = alreadyPaid + appliedAmountMinor;
      const paymentStatus = totalPaid >= order.priceMinor ? "PAID" : totalPaid >= order.depositRequiredMinor ? "DEPOSIT_PAID" : "PARTIALLY_PAID";
      const confirmsProductionSlot = requiresProduction(order.type) && totalPaid >= order.depositRequiredMinor && order.productionSlot?.tentative;
      const payment = await tx.payment.create({ data: { orderId, amountMinor: dto.amountMinor, currency, appliedAmountMinor: conversion?.appliedAmountMinor, appliedCurrency: conversion?.appliedCurrency, exchangeRateSnapshot: conversion?.snapshot as Prisma.InputJsonValue | undefined, method: dto.method, receivedAt: new Date(dto.receivedAt), reference: dto.reference?.trim() || null, notes: dto.notes?.trim() || null } });
      const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { paymentStatus, ...(confirmsProductionSlot && order.productionStatus === "NOT_SCHEDULED" ? { productionStatus: "SCHEDULED" } : {}) } });
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "PAYMENT_RECEIVED", summary: `Получена оплата ${(dto.amountMinor / 100).toFixed(2)} ${currency}`, metadata: { paymentId: payment.id, method: dto.method, appliedAmountMinor, appliedCurrency: order.currency, exchangeRateSnapshot: conversion?.snapshot } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Payment", entityId: payment.id, after: payment } });
      if (confirmsProductionSlot && order.productionSlot) {
        const slot = await tx.productionSlot.update({ where: { orderId }, data: { tentative: false } });
        await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "PRODUCTION_SLOT_CONFIRMED", summary: "Производственный слот подтверждён после получения предоплаты", metadata: { paymentId: payment.id, depositRequiredMinor: order.depositRequiredMinor, currency: order.currency, paymentCurrency: currency, productionStatus: updatedOrder.productionStatus } } });
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

  async addItemMeasurement(orderId: string, itemId: string, dto: OrderMeasurementDto, actor: User) {
    const { measuredAt, standardHeight, notes, expectedMeasurementId, ...numbered } = dto;
    if (Object.values(numbered).some(value => value !== undefined && !Number.isInteger(value * 2))) {
      throw new BadRequestException("Измерения должны вводиться с шагом 0,5 см");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
      const order = await tx.order.findFirst({
        where: { id: orderId, archivedAt: null },
        include: { items: { include: { measurement: { select: { athleteId: true } } } } },
      });
      if (!order) throw new NotFoundException("Заказ не найден");
      const item = order.items.find(candidate => candidate.id === itemId);
      if (!item) throw new NotFoundException("Позиция заказа не найдена");
      const previousMeasurementId = item.measurementId ?? null;
      if ((expectedMeasurementId ?? null) !== previousMeasurementId) {
        throw new ConflictException("Замеры позиции уже изменены другим пользователем. Обновите заказ и повторите");
      }
      if (!item.athleteId) throw new BadRequestException("Сначала укажите спортсмена для позиции заказа");
      if (item.measurement && item.measurement.athleteId !== item.athleteId) {
        throw new BadRequestException("Снимок замеров не принадлежит спортсмену позиции");
      }
      const athlete = await tx.athlete.findFirst({ where: { id: item.athleteId, clientId: order.clientId, archivedAt: null } });
      if (!athlete) throw new NotFoundException("Спортсмен позиции заказа не найден");
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
          source: previousMeasurementId ? `Редактирование замеров позиции заказа ${order.number}` : standardHeight ? `Ростовой стандарт ${standardHeight} см` : "Ручной ввод из позиции заказа",
        },
      });
      const updatedItem = await tx.orderItem.update({ where: { id: item.id }, data: { measurementId: measurement.id } });
      const mirrorsExistingItem = previousMeasurementId !== null && order.athleteId === athlete.id && order.measurementId === previousMeasurementId;
      const mirrorsSingleItem = order.items.length === 1
        && (order.athleteId === null || order.athleteId === athlete.id)
        && (order.measurementId === null || order.measurementId === previousMeasurementId);
      let updatedOrder: { athleteId: string | null; measurementId: string | null } | undefined;
      if (mirrorsExistingItem || mirrorsSingleItem) {
        updatedOrder = await tx.order.update({ where: { id: order.id }, data: { athleteId: athlete.id, measurementId: measurement.id } });
      }
      await tx.activity.create({
        data: {
          clientId: order.clientId,
          orderId: order.id,
          type: previousMeasurementId ? "MEASUREMENT_REPLACED" : "MEASUREMENT_CREATED",
          summary: previousMeasurementId ? `Обновлены замеры позиции заказа ${order.number}` : `Добавлены замеры позиции заказа ${order.number}`,
          metadata: { itemId: item.id, measurementId: measurement.id, previousMeasurementId, athleteId: athlete.id, standardHeight },
        },
      });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Measurement", entityId: measurement.id, after: measurement } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "OrderItem", entityId: item.id, before: { athleteId: item.athleteId, measurementId: item.measurementId }, after: { athleteId: updatedItem.athleteId, measurementId: updatedItem.measurementId } } });
      if (updatedOrder) {
        await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "Order", entityId: order.id, before: { athleteId: order.athleteId, measurementId: order.measurementId }, after: { athleteId: updatedOrder.athleteId, measurementId: updatedOrder.measurementId } } });
      }
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge-global"},0))`;
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
      if (order.requiredDeliveryAt && requiresProduction(order.type)) {
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
