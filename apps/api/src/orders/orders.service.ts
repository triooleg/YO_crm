import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { uploadsRoot } from "../uploads";
import { AddOrderPaymentDto, CreateOrderDto, UploadModelImageDto } from "./orders.dto";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const OPTIMIZE_FROM_BYTES = 2 * 1024 * 1024;

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
        payments: { select: { id: true, amountMinor: true, currency: true, method: true, receivedAt: true, reference: true, notes: true }, orderBy: { receivedAt: "desc" } },
      },
    });
  }

  async addPayment(orderId: string, dto: AddOrderPaymentDto, actor: User) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { payments: true } });
    if (!order) throw new NotFoundException("Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ");
    const currency = dto.currency.toUpperCase();
    if (currency !== order.currency) throw new BadRequestException(`РћРїР»Р°С‚Р° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РІ РІР°Р»СЋС‚Рµ Р·Р°РєР°Р·Р°: ${order.currency}`);
    const alreadyPaid = order.payments.filter((payment) => payment.currency === currency).reduce((sum, payment) => sum + payment.amountMinor, 0);
    const totalPaid = alreadyPaid + dto.amountMinor;
    const paymentStatus = totalPaid >= order.priceMinor ? "PAID" : totalPaid >= order.depositRequiredMinor ? "DEPOSIT_PAID" : "PARTIALLY_PAID";
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({ data: { orderId, amountMinor: dto.amountMinor, currency, method: dto.method, receivedAt: new Date(dto.receivedAt), reference: dto.reference?.trim() || null, notes: dto.notes?.trim() || null } });
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus } });
      await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "PAYMENT_RECEIVED", summary: `РџРѕР»СѓС‡РµРЅР° РѕРїР»Р°С‚Р° ${(dto.amountMinor / 100).toFixed(2)} ${currency}`, metadata: { paymentId: payment.id, method: dto.method } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Payment", entityId: payment.id, after: payment } });
      return payment;
    });
  }

  async upload(dto: UploadModelImageDto) {
    const sourceExt = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[dto.mime];
    if (!sourceExt) throw new BadRequestException("Р”РѕРїСѓСЃС‚РёРјС‹ JPG, PNG РёР»Рё WebP");
    const source = Buffer.from(dto.data.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!source.length || source.length > MAX_SOURCE_BYTES) throw new BadRequestException("Р Р°Р·РјРµСЂ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РґРѕ 5 РњР‘");
    let stored = source, extension = sourceExt, optimized = false;
    if (source.length > OPTIMIZE_FROM_BYTES) {
      try {
        stored = await sharp(source).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
        extension = "jpg"; optimized = true;
      } catch { throw new BadRequestException("РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ РёР·РѕР±СЂР°Р¶РµРЅРёРµ. Р’С‹Р±РµСЂРёС‚Рµ РґСЂСѓРіРѕР№ С„Р°Р№Р» JPG, PNG РёР»Рё WebP"); }
    }
    const dir = join(uploadsRoot(), "order-models"); await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${extension}`; await writeFile(join(dir, name), stored);
    return { path: name, url: `/api/orders/images/${name}`, optimized, originalBytes: source.length, storedBytes: stored.length };
  }

  async create(dto: CreateOrderDto, actor: User) {
    const client = await this.prisma.client.findFirst({ where: { id: dto.clientId, archivedAt: null } });
    if (!client) throw new NotFoundException("РљР»РёРµРЅС‚ РЅРµ РЅР°Р№РґРµРЅ");
    if (dto.depositRequiredMinor > dto.priceMinor) throw new BadRequestException("РџСЂРµРґРѕРїР»Р°С‚Р° РЅРµ РјРѕР¶РµС‚ РїСЂРµРІС‹С€Р°С‚СЊ С†РµРЅСѓ");
    const number = `YO-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({ data: { number, clientId: dto.clientId, athleteId: dto.athleteId, measurementId: dto.measurementId, type: dto.type, notes: dto.description, modelImagePath: dto.modelImagePath, requiredDeliveryAt: dto.requiredDeliveryAt ? new Date(dto.requiredDeliveryAt) : undefined, priceMinor: dto.priceMinor, depositRequiredMinor: dto.depositRequiredMinor, currency: dto.currency.toUpperCase(), responsibleManagerId: actor.id } });
      await tx.activity.create({ data: { clientId: dto.clientId, orderId: order.id, type: "ORDER_CREATED", summary: `РЎРѕР·РґР°РЅ Р·Р°РєР°Р· ${number}` } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Order", entityId: order.id, after: order } });
      return order;
    });
  }
}
