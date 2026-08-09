import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Prisma, User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { uploadsRoot } from "../uploads";
import { AddOrderPaymentDto, CreateOrderDto, UpdateOrderStatusesDto, UploadModelImageDto } from "./orders.dto";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const OPTIMIZE_FROM_BYTES = 2 * 1024 * 1024;

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
        paymentStatus: true, shippingStatus: true, modelImagePath: true, notes: true, createdAt: true,
        client: { select: { id: true, displayName: true, country: true, city: true, address: true, postalCode: true, language: true, source: true } },
        athlete: { select: { id: true, firstName: true, lastName: true } },
        measurement: { select: { id: true, measuredAt: true, values: true } },
        items: { select: { id: true, name: true, quantity: true, priceMinor: true, modelImagePath: true, productionStatus: true, athlete: { select: { id: true, firstName: true, lastName: true } }, measurement: { select: { id: true, measuredAt: true, values: true } } } },
        activities: { select: { id: true, type: true, summary: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 30 },
        payments: { select: { id: true, amountMinor: true, currency: true, method: true, receivedAt: true, reference: true, notes: true }, orderBy: { receivedAt: "desc" } },
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
    const data = { salesStatus: dto.salesStatus, productionStatus: dto.productionStatus, shippingStatus: dto.shippingStatus };
    if (!Object.values(data).some(Boolean)) throw new BadRequestException("Укажите хотя бы один статус");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({ where: { id: orderId }, data });
      const summary = "Изменены рабочие статусы заказа";
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "ORDER_STATUSES_UPDATED", summary, metadata: data } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "Order", entityId: orderId, before: order, after: updated } });
      return updated;
    });
  }
  async addPayment(orderId: string, dto: AddOrderPaymentDto, actor: User) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { payments: true } });
    if (!order) throw new NotFoundException("Заказ не найден");
    const currency = dto.currency.toUpperCase();
    if (currency !== order.currency) throw new BadRequestException(`Оплата должна быть в валюте заказа: ${order.currency}`);
    const alreadyPaid = order.payments.filter((payment) => payment.currency === currency).reduce((sum, payment) => sum + payment.amountMinor, 0);
    const totalPaid = alreadyPaid + dto.amountMinor;
    const paymentStatus = totalPaid >= order.priceMinor ? "PAID" : totalPaid >= order.depositRequiredMinor ? "DEPOSIT_PAID" : "PARTIALLY_PAID";
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({ data: { orderId, amountMinor: dto.amountMinor, currency, method: dto.method, receivedAt: new Date(dto.receivedAt), reference: dto.reference?.trim() || null, notes: dto.notes?.trim() || null } });
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus } });
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "PAYMENT_RECEIVED", summary: `Получена оплата ${(dto.amountMinor / 100).toFixed(2)} ${currency}`, metadata: { paymentId: payment.id, method: dto.method } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Payment", entityId: payment.id, after: payment } });
      return payment;
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
    const client = await this.prisma.client.findFirst({ where: { id: dto.clientId, archivedAt: null } });
    if (!client) throw new NotFoundException("Клиент не найден");
    if (dto.depositRequiredMinor > dto.priceMinor) throw new BadRequestException("Предоплата не может превышать цену");
    const items = dto.items?.length ? dto.items : [{ athleteId: dto.athleteId, measurementId: dto.measurementId, name: dto.description, quantity: 1, priceMinor: dto.priceMinor, modelImagePath: dto.modelImagePath }];
    const athleteIds = [...new Set(items.map((item) => item.athleteId).filter((id): id is string => Boolean(id)))];
    if (athleteIds.length && await this.prisma.athlete.count({ where: { id: { in: athleteIds }, clientId: dto.clientId, archivedAt: null } }) !== athleteIds.length) throw new BadRequestException("Один или несколько спортсменов не принадлежат клиенту");
    return this.prisma.$transaction(async (tx) => {
      const number = await nextOrderNumber(tx);
      const order = await tx.order.create({ data: { number, clientId: dto.clientId, athleteId: dto.athleteId, measurementId: dto.measurementId, type: dto.type, notes: dto.description, modelImagePath: dto.modelImagePath, requiredDeliveryAt: dto.requiredDeliveryAt ? new Date(dto.requiredDeliveryAt) : undefined, priceMinor: dto.priceMinor, depositRequiredMinor: dto.depositRequiredMinor, currency: dto.currency.toUpperCase(), responsibleManagerId: actor.id, items: { create: items.map((item) => ({ athleteId: item.athleteId, measurementId: item.measurementId, name: item.name, quantity: item.quantity, priceMinor: item.priceMinor, modelImagePath: item.modelImagePath })) } } });
      await tx.activity.create({ data: { clientId: dto.clientId, orderId: order.id, type: "ORDER_CREATED", summary: `Создан заказ ${number}` } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Order", entityId: order.id, after: order } });
      return order;
    });
  }
}
