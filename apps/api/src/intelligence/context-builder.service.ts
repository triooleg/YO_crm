import { Injectable, NotFoundException } from "@nestjs/common";
import { AiRecordStatus, KnowledgeStatus } from "@prisma/client";
import { PrismaService } from "../prisma.service";

@Injectable()
export class ContextBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async build(input: { clientId: string; conversationId?: string; messageIds?: string[] }) {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, archivedAt: null },
      select: {
        id: true, displayName: true, language: true, country: true, preferredChannel: true,
        orders: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: {
          id: true, number: true, salesStatus: true, productionStatus: true, paymentStatus: true,
          shippingStatus: true, requiredDeliveryAt: true, promisedProductionAt: true, currency: true,
          priceMinor: true, depositRequiredMinor: true,
        } },
      },
    });
    if (!client) throw new NotFoundException("Клиент не найден");
    const conversation = input.conversationId
      ? await this.prisma.conversation.findFirst({ where: { id: input.conversationId, clientId: client.id, archivedAt: null }, select: { id: true, channel: true, subject: true } })
      : input.messageIds?.length
        ? await this.prisma.conversation.findFirst({ where: { clientId: client.id, archivedAt: null, messages: { some: { id: { in: input.messageIds } } } }, select: { id: true, channel: true, subject: true } })
      : await this.prisma.conversation.findFirst({ where: { clientId: client.id, archivedAt: null }, orderBy: { lastMessageAt: "desc" }, select: { id: true, channel: true, subject: true } });
    const conversationId = conversation?.id;
    const [messages, memories, facts, agreements, knowledge] = await Promise.all([
      conversationId ? this.prisma.message.findMany({ where: { conversationId, ...(input.messageIds?.length ? { id: { in: input.messageIds } } : {}) }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, direction: true, content: true, language: true, messageType: true, createdAt: true } }) : Promise.resolve([]),
      this.prisma.customerMemory.findMany({ where: { clientId: client.id, status: { in: [AiRecordStatus.ACTIVE, AiRecordStatus.VERIFIED] } }, select: { id: true, type: true, key: true, valueJson: true, status: true, sourceType: true, sourceId: true } }),
      this.prisma.conversationFact.findMany({ where: { clientId: client.id, ...(conversationId ? { conversationId } : {}), status: { in: [AiRecordStatus.ACTIVE, AiRecordStatus.VERIFIED] } }, take: 30, select: { id: true, type: true, subject: true, valueJson: true, status: true, sourceMessageId: true } }),
      this.prisma.agreement.findMany({ where: { clientId: client.id, ...(conversationId ? { conversationId } : {}), status: AiRecordStatus.VERIFIED, staffConfirmationMessageId: { not: null } }, take: 30, select: { id: true, orderId: true, type: true, subject: true, valueJson: true, status: true, customerMessageId: true, staffConfirmationMessageId: true } }),
      this.prisma.knowledgeItem.findMany({ where: { status: KnowledgeStatus.PUBLISHED, language: { in: [client.language || "ru", "ru"] }, OR: [{ validFrom: null }, { validFrom: { lte: new Date() } }], AND: [{ OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] }] }, orderBy: [{ priority: "desc" }, { updatedAt: "desc" }], take: 10, include: { versions: true } }),
    ]);
    const verifiedMemories = memories.filter(item => item.status === AiRecordStatus.VERIFIED);
    const candidateMemories = memories.filter(item => item.status === AiRecordStatus.ACTIVE);
    const verifiedFacts = facts.filter(item => item.status === AiRecordStatus.VERIFIED);
    const candidateFacts = facts.filter(item => item.status === AiRecordStatus.ACTIVE);
    return { client, conversation, messages: messages.reverse(), verifiedMemories, candidateMemories, verifiedFacts, candidateFacts, agreements, knowledge: knowledge.map(item => ({ id: item.id, title: item.title, content: item.versions.find(version => version.version === item.currentVersion)?.content })).filter(item => Boolean(item.content)) };
  }
}
