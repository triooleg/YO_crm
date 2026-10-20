import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma, User } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { PrismaService } from "../prisma.service";
import { uploadsRoot } from "../uploads";
import { UpdateBrandingDto } from "./branding.dto";

export const BRANDING_FILE_NAME = /^[a-f0-9-]+\.webp$/;
const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const SETTING = { section: "interface", key: "branding" } as const;
type BrandingValue = { logoPath: string | null; useInHeader: boolean; useInMessages: boolean };

function normalized(value: unknown): BrandingValue {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const logoPath = typeof item.logoPath === "string" && BRANDING_FILE_NAME.test(item.logoPath) ? item.logoPath : null;
  return { logoPath, useInHeader: item.useInHeader !== false, useInMessages: item.useInMessages !== false };
}

@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService) {}

  async settings() {
    const item = await this.prisma.appSetting.findUnique({ where: { section_key: SETTING } });
    return this.response(normalized(item?.value));
  }

  async update(dto: UpdateBrandingDto, actor: User) {
    if (dto.removeLogo && dto.data) throw new BadRequestException("Нельзя одновременно удалить и загрузить логотип");
    const current = await this.prisma.appSetting.findUnique({ where: { section_key: SETTING } });
    let logoPath = normalized(current?.value).logoPath;
    if (dto.removeLogo) logoPath = null;
    if (dto.data) logoPath = await this.storeLogo(dto);
    const value: BrandingValue = { logoPath, useInHeader: dto.useInHeader, useInMessages: dto.useInMessages };
    const saved = await this.prisma.$transaction(async tx => {
      const item = await tx.appSetting.upsert({
        where: { section_key: SETTING },
        create: { ...SETTING, value: value as unknown as Prisma.InputJsonValue },
        update: { value: value as unknown as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "BrandingSetting", entityId: item.id, before: current as unknown as Prisma.InputJsonValue | undefined, after: item } });
      return item;
    });
    return this.response(normalized(saved.value));
  }

  private async storeLogo(dto: UpdateBrandingDto) {
    if (!dto.name || !dto.mime) throw new BadRequestException("Укажите файл логотипа");
    if (!["image/jpeg", "image/png", "image/webp"].includes(dto.mime)) throw new BadRequestException("Допустимы JPG, PNG или WebP");
    const match = dto.data?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[1] !== dto.mime) throw new BadRequestException("Некорректные данные логотипа");
    const source = Buffer.from(match[2]!, "base64");
    if (!source.length || source.length > MAX_LOGO_BYTES) throw new BadRequestException("Размер логотипа должен быть до 3 МБ");
    const metadata = await sharp(source).metadata().catch(() => null);
    const expected = dto.mime === "image/jpeg" ? "jpeg" : dto.mime.slice(6);
    if (!metadata || metadata.format !== expected || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) throw new BadRequestException("Файл не является допустимым изображением до 4096 × 4096 px");
    const stored = await sharp(source).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
    const directory = join(uploadsRoot(), "branding");
    await mkdir(directory, { recursive: true });
    const name = `${randomUUID()}.webp`;
    await writeFile(join(directory, name), stored, { flag: "wx" });
    return name;
  }

  private response(value: BrandingValue) {
    return { logoUrl: value.logoPath ? `/api/branding/logo/${value.logoPath}` : null, useInHeader: value.useInHeader, useInMessages: value.useInMessages };
  }
}
