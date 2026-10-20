import { Injectable } from "@nestjs/common";
import { AiRunStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";

@Injectable()
export class AiRunService {
  constructor(private readonly prisma: PrismaService) {}
  start(data: { conversationId?: string; messageId?: string; clientId?: string; agent: string; operation: string; provider: string; model: string; promptKey?: string; promptVersion?: number; contextSnapshot?: Prisma.InputJsonValue; retrievedKnowledgeIds?: string[]; retrievedMemoryIds?: string[]; retrievedMessageIds?: string[]; availableTools?: Prisma.InputJsonValue }) {
    return this.prisma.aiRun.create({ data: { ...data, retrievedKnowledgeIds: data.retrievedKnowledgeIds || [], retrievedMemoryIds: data.retrievedMemoryIds || [], retrievedMessageIds: data.retrievedMessageIds || [], status: AiRunStatus.RUNNING } });
  }
  complete(id: string, output: string, latencyMs: number) { return this.prisma.aiRun.update({ where: { id }, data: { generatedOutput: output, latencyMs, status: AiRunStatus.COMPLETED } }); }
  fail(id: string, errorCode: string, latencyMs: number) { return this.prisma.aiRun.update({ where: { id }, data: { errorCode, latencyMs, status: AiRunStatus.FAILED } }); }
  feedback(aiRunId: string, draftText: string) { return this.prisma.aiResponseFeedback.upsert({ where: { aiRunId }, create: { aiRunId, draftText }, update: { draftText } }); }
  finalizeFeedback(aiRunId: string, finalText: string, sentMessageId: string) { return this.prisma.$transaction(async tx => {
    const current = await tx.aiResponseFeedback.findUnique({ where: { aiRunId } });
    if (!current) return null;
    return tx.aiResponseFeedback.update({ where: { aiRunId }, data: { finalText, wasEdited: current.draftText !== finalText, accepted: true, rejected: false, sentMessageId } });
  }); }
}
