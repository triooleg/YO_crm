import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { UpdateProductionSettingsDto } from "./finance.dto";

const DAY_MS = 86_400_000;

export async function saveProductionSettingsTransaction(tx: any, dto: UpdateProductionSettingsDto, actorId: string) {
  if (!Number.isInteger(dto.defaultDurationDays) || dto.defaultDurationDays < 1 || dto.defaultDurationDays > 90) {
    throw new BadRequestException("Срок производства должен быть от 1 до 90 дней");
  }
  if (!Number.isInteger(dto.shippingLeadDays) || dto.shippingLeadDays < 0 || dto.shippingLeadDays > 30) {
    throw new BadRequestException("Резерв до отправки должен быть от 0 до 30 дней");
  }
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('yoleotard-production-settings'))");
  const before = await tx.appSetting.findMany({ where: { section: "production", key: { in: ["defaultDurationDays", "shippingLeadDays"] } } });
  const previousLeadSetting = before.find((setting: { key: string }) => setting.key === "shippingLeadDays");
  const previousLead = typeof previousLeadSetting?.value === "number" && Number.isInteger(previousLeadSetting.value) && previousLeadSetting.value >= 0 && previousLeadSetting.value <= 30 ? previousLeadSetting.value : 2;
  if (dto.shippingLeadDays > previousLead) {
    const slots = await tx.productionSlot.findMany({ where: { order: { archivedAt: null, type: { notIn: ["READY_MODEL", "ACCESSORY"] }, productionStatus: { not: "CANCELLED" }, requiredDeliveryAt: { not: null } } }, include: { order: { select: { number: true, requiredDeliveryAt: true } } } });
    const invalid = slots.find((slot: { endsAt: Date; order: { number: string; requiredDeliveryAt: Date | null } }) => slot.order.requiredDeliveryAt && slot.endsAt > new Date(slot.order.requiredDeliveryAt.getTime() - dto.shippingLeadDays * DAY_MS));
    if (invalid) throw new BadRequestException(`Нельзя увеличить резерв: график заказа ${invalid.order.number} заканчивается слишком поздно`);
  }
  const updated = [];
  for (const [key, value] of [["defaultDurationDays", dto.defaultDurationDays], ["shippingLeadDays", dto.shippingLeadDays]] as const) {
    const previous = before.find((setting: { key: string }) => setting.key === key);
    const setting = await tx.appSetting.upsert({ where: { section_key: { section: "production", key } }, create: { section: "production", key, value }, update: { value } });
    await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "AppSetting", entityId: setting.id, before: previous as Prisma.InputJsonValue | undefined, after: setting } });
    updated.push(setting);
  }
  return updated;
}
