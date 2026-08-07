import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { User } from "@prisma/client";
import sharp from "sharp";
import { PrismaService } from "../prisma.service";
import type { CreateOrderDto, UploadModelImageDto } from "./orders.dto";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const OPTIMIZE_FROM_BYTES = 2 * 1024 * 1024;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(dto: UploadModelImageDto) {
    const sourceExt = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[dto.mime];
    if (!sourceExt) throw new BadRequestException("Допустимы JPG, PNG или WebP");

    const source = Buffer.from(dto.data.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!source.length || source.length > MAX_SOURCE_BYTES) {
      throw new BadRequestException("Размер изображения должен быть до 5 МБ");
    }

    let stored = source;
    let extension = sourceExt;
    let optimized = false;
    if (source.length > OPTIMIZE_FROM_BYTES) {
      try {
        stored = await sharp(source)
          .rotate()
          .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 88, mozjpeg: true })
          .toBuffer();
        extension = "jpg";
        optimized = true;
      } catch {
        throw new BadRequestException("Не удалось обработать изображение. Выберите другой файл JPG, PNG или WebP");
      }
    }

    const dir = join(process.cwd(), "uploads", "order-models");
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${extension}`;
    await writeFile(join(dir, name), stored);
    return {
      path: name,
      url: `/api/orders/images/${name}`,
      optimized,
      originalBytes: source.length,
      storedBytes: stored.length,
    };
  }

  async create(dto: CreateOrderDto, actor: User) {
    const client = await this.prisma.client.findFirst({ where: { id: dto.clientId, archivedAt: null } });
    if (!client) throw new NotFoundException("Клиент не найден");
    if (dto.depositRequiredMinor > dto.priceMinor) throw new BadRequestException("Предоплата не может превышать цену");
    const number = `YO-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          number,
          clientId: dto.clientId,
          athleteId: dto.athleteId,
          measurementId: dto.measurementId,
          type: dto.type,
          notes: dto.description,
          modelImagePath: dto.modelImagePath,
          requiredDeliveryAt: dto.requiredDeliveryAt ? new Date(dto.requiredDeliveryAt) : undefined,
          priceMinor: dto.priceMinor,
          depositRequiredMinor: dto.depositRequiredMinor,
          currency: dto.currency.toUpperCase(),
          responsibleManagerId: actor.id,
        },
      });
      await tx.activity.create({ data: { clientId: dto.clientId, orderId: order.id, type: "ORDER_CREATED", summary: `Создан заказ ${number}` } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "Order", entityId: order.id, after: order } });
      return order;
    });
  }
}
