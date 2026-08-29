import { BadRequestException, Injectable } from "@nestjs/common";
import { AiRecordStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";

export type MemoryWrite = {
  clientId: string;
  type: string;
  key: string;
  value: Prisma.InputJsonValue;
  sourceType: string;
  sourceId: string;
  sourceMessageId?: string;
  confidence?: number;
  extractor?: string;
  extractorVersion?: string;
};

@Injectable()
export class CustomerMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async remember(input: MemoryWrite) {
    if (!input.sourceType || !input.sourceId) throw new BadRequestException("Для памяти обязателен источник");
    const sourceType = input.sourceType.trim().toUpperCase();
    if (!(["MESSAGE", "AI_RUN", "STAFF"] as const).includes(sourceType as "MESSAGE" | "AI_RUN" | "STAFF")) throw new BadRequestException("Недопустимый тип источника памяти");
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-memory:${input.clientId}:${input.key}`},0))`;
      if (sourceType === "MESSAGE") {
        if (!input.sourceMessageId || input.sourceId !== input.sourceMessageId) throw new BadRequestException("Для источника MESSAGE требуется канонический идентификатор сообщения");
        const source = await tx.message.findFirst({ where: { id: input.sourceMessageId, conversation: { clientId: input.clientId } }, select: { id: true } });
        if (!source) throw new BadRequestException("Источник памяти не относится к выбранному клиенту");
      } else if (sourceType === "AI_RUN") {
        if (input.sourceMessageId) throw new BadRequestException("Для источника AI_RUN нельзя указывать сообщение");
        const source = await tx.aiRun.findFirst({ where: { id: input.sourceId, clientId: input.clientId }, select: { id: true } });
        if (!source) throw new BadRequestException("AI-запуск не относится к выбранному клиенту");
      } else {
        if (input.sourceMessageId) throw new BadRequestException("Для источника STAFF нельзя указывать сообщение");
        const source = await tx.user.findUnique({ where: { id: input.sourceId }, select: { id: true } });
        if (!source) throw new BadRequestException("Сотрудник-источник не найден");
      }
      const current = await tx.customerMemory.findFirst({
        where: { clientId: input.clientId, key: input.key, status: AiRecordStatus.ACTIVE },
        orderBy: { createdAt: "desc" },
      });
      const next = await tx.customerMemory.create({ data: {
        clientId: input.clientId, type: input.type, key: input.key, valueJson: input.value,
        sourceType, sourceId: input.sourceId, sourceMessageId: input.sourceMessageId,
        confidence: input.confidence, extractor: input.extractor, extractorVersion: input.extractorVersion,
      } });
      if (current) await tx.customerMemory.update({ where: { id: current.id }, data: { status: AiRecordStatus.SUPERSEDED, supersededById: next.id } });
      await tx.auditLog.create({ data: { action: "AI_MEMORY_CANDIDATE_CREATED", entityType: "CustomerMemory", entityId: next.id, after: { clientId: input.clientId, key: input.key, sourceType, sourceId: input.sourceId } } });
      return next;
    });
  }
}
