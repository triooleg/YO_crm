import { shipmentEmailAccountIdentity } from "./shipment-email-account";
import { BadGatewayException, BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma, type MessageDeliveryAttempt, type User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { EmailTransportService } from "./email-transport.service";

export const SHIPMENT_EMAIL_SECTION = "integration.email.shipment-notification";
export type ShipmentEmailInput = { recipient: string; subject: string; content: string; clientRequestId: string; orderId: string; shipmentId: string; notificationId: string; accountIdentity?:string };
export type ShipmentEmailResult = { status: "SENT" | "FAILED" | "UNCERTAIN" | "PENDING"; attemptId?: string; messageId?: string; error?: string };
export type ShipmentEmailContext = ShipmentEmailInput & { clientId: string; conversationId: string; attemptId: string; actorId: string; providerMessageId: string; accountIdentity: string };
export type NotificationConversationContext = { conversationId: string; externalId: string | null };

export async function validateNotificationConversation(tx: Prisma.TransactionClient, clientId: string, channel: string, conversationId: string, resolvedExternalId: string | null, context?: NotificationConversationContext) {
  if (!context) return;
  const current = await tx.conversation.findUnique({ where: { id: context.conversationId } });
  if (resolvedExternalId !== context.externalId || !current || current.archivedAt || current.id !== conversationId || current.clientId !== clientId || current.channel !== channel || current.externalId !== context.externalId)
    throw new ConflictException("Переписка уведомления изменилась. Обновите предпросмотр");
}

export function shipmentEmailMessageId(clientRequestId: string) {
  return `<shipment-${clientRequestId.toLowerCase()}@yoleotard.com>`;
}
function result(attempt: MessageDeliveryAttempt): ShipmentEmailResult {
  return { status: attempt.status as ShipmentEmailResult["status"], attemptId: attempt.id, ...(attempt.messageId ? { messageId: attempt.messageId } : {}) };
}
async function currentShipmentEmailAccount(tx: Prisma.TransactionClient) {
  const rows = await tx.appSetting.findMany({where:{section:"integration.email",key:{in:["username","fromAddress"]}},select:{key:true,value:true}});
  return shipmentEmailAccountIdentity(Object.fromEntries(rows.map(row=>[row.key,row.value])));
}

export async function resolveShipmentEmailContext(tx: Prisma.TransactionClient, providerMessageId: string, recipient: string) {
  const row = await tx.appSetting.findUnique({ where: { section_key: { section: SHIPMENT_EMAIL_SECTION, key: providerMessageId } } });
  if (!row) return undefined;
  const value = row.value as unknown as ShipmentEmailContext;
  if (!value || typeof value !== "object" || Array.isArray(value) || !["clientId", "conversationId", "attemptId", "actorId", "orderId", "shipmentId", "notificationId"].every(key => typeof (value as unknown as Record<string, unknown>)[key] === "string" && Boolean((value as unknown as Record<string, unknown>)[key])) || typeof value.clientRequestId !== "string" || value.providerMessageId !== providerMessageId || shipmentEmailMessageId(value.clientRequestId) !== providerMessageId || typeof value.recipient !== "string" || value.recipient !== recipient.trim().toLowerCase()) return null;
  if (!value.accountIdentity || value.accountIdentity !== await currentShipmentEmailAccount(tx)) return null;
  const conversation = await tx.conversation.findUnique({ where: { id: value.conversationId } });
  const attempt = await tx.messageDeliveryAttempt.findUnique({ where: { id: value.attemptId } });
  if (!conversation || conversation.archivedAt || conversation.channel !== "EMAIL" || conversation.clientId !== value.clientId || !attempt || attempt.clientId !== value.clientId || attempt.conversationId !== conversation.id || attempt.clientRequestId !== value.clientRequestId) return null;
  if (!await tx.client.findFirst({where:{id:value.clientId,archivedAt:null}})) return null;
  return { context: value, conversation, attempt };
}

// Internal adapter. The notification orchestrator owns permission checks, order scope and consent.
export async function sendShipmentEmail(prisma: PrismaService, transport: EmailTransportService, clientId: string, input: ShipmentEmailInput, actor: Pick<User, "id">, recordUncertain: (requestId: string, clientId: string, actorId: string, providerMessageId: string) => Promise<void>): Promise<ShipmentEmailResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientRequestId) || !/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(input.recipient.trim()) || !input.subject.trim() || /[\r\n]/.test(input.subject) || !input.content.trim() || !input.orderId || !input.shipmentId || !input.notificationId) throw new BadRequestException("Некорректные данные email-уведомления");
  const normalized = { ...input, recipient: input.recipient.trim().toLowerCase(), clientRequestId: input.clientRequestId.toLowerCase() };
  const providerMessageId = shipmentEmailMessageId(normalized.clientRequestId);
  const reserved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"shipment-email-request:" + normalized.clientRequestId},0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"shipment-email-client:" + clientId},0))`;
    const existing = await tx.messageDeliveryAttempt.findUnique({ where: { clientRequestId: normalized.clientRequestId } });
    if (existing) {
      const trusted = await resolveShipmentEmailContext(tx, providerMessageId, normalized.recipient);
      if (!trusted || trusted.attempt.id !== existing.id || trusted.context.clientId !== clientId || Object.entries(normalized).some(([key, value]) => trusted.context[key as keyof ShipmentEmailInput] !== value)) throw new ConflictException("Идентификатор отправки уже использован");
      return { done: result(existing) };
    }
    const accountIdentity = await currentShipmentEmailAccount(tx);
    if (!accountIdentity) throw new BadRequestException("Почтовый аккаунт не настроен");
    if (input.accountIdentity && input.accountIdentity!==accountIdentity) throw new BadRequestException("Почтовый аккаунт изменился после подтверждения уведомления");
    const client = await tx.client.findFirst({ where: { id: clientId, archivedAt: null } });
    if (!client) throw new BadRequestException("Клиент недоступен");
    let conversation = await tx.conversation.findUnique({ where: { clientId_channel: { clientId, channel: "EMAIL" } } });
    if (conversation?.archivedAt) throw new ConflictException("Переписка email архивирована");
    // Null mapping avoids stealing another client's recipient identity or changing canonical mail.
    if (!conversation) conversation = await tx.conversation.create({ data: { clientId, channel: "EMAIL", externalId: null } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"message-send:" + conversation.id},0))`;
    if (await tx.messageDeliveryAttempt.findFirst({ where: { conversationId: conversation.id, status: { in: ["PENDING", "UNCERTAIN"] } } })) return { done: { status: "PENDING" as const } };
    const attempt = await tx.messageDeliveryAttempt.create({ data: { clientRequestId: normalized.clientRequestId, clientId, conversationId: conversation.id, status: "PENDING" } });
    const context: ShipmentEmailContext = { ...normalized, clientId, conversationId: conversation.id, attemptId: attempt.id, actorId: actor.id, providerMessageId, accountIdentity };
    await tx.appSetting.create({ data: { section: SHIPMENT_EMAIL_SECTION, key: providerMessageId, value: context } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "RESERVE", entityType: "MessageDeliveryAttempt", entityId: attempt.id, after: { channel: "EMAIL", ...context } } });
    return { context };
  });
  if (reserved.done) return reserved.done;
  const context = reserved.context!;
  const finish = (status: "SENT" | "FAILED") => prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"message-send:" + context.conversationId},0))`;
    const attempt = await tx.messageDeliveryAttempt.findUniqueOrThrow({ where: { id: context.attemptId } });
    if (attempt.status === "SENT") return result(attempt);
    const existing = await tx.message.findUnique({ where: { conversationId_externalId: { conversationId: context.conversationId, externalId: providerMessageId } } });
    const sentAt = new Date(), metadata = { provider: "GMAIL", source: "CRM", ...context, messageId: providerMessageId, to: context.recipient };
    const message = existing || await tx.message.create({ data: { conversationId: context.conversationId, direction: "OUTBOUND", status, content: context.content, normalizedText: context.content.normalize("NFKC"), messageType: "email", externalId: providerMessageId, authorId: actor.id, ...(status === "SENT" ? { sentAt } : {}), metadata } });
    const finalStatus = existing?.status === "SENT" ? "SENT" : status;
    const updated = await tx.messageDeliveryAttempt.update({ where: { id: attempt.id }, data: { status: finalStatus, messageId: message.id } });
    if (finalStatus === "SENT") await tx.$executeRaw`UPDATE "Conversation" SET "lastMessageAt"=GREATEST(COALESCE("lastMessageAt",${sentAt}),${sentAt}),"updatedAt"=NOW() WHERE "id"=${context.conversationId}`;
    await tx.activity.create({ data: { clientId, type: finalStatus === "SENT" ? "MESSAGE_SENT" : "MESSAGE_SEND_FAILED", summary: finalStatus === "SENT" ? "Уведомление об отправке заказа отправлено через Gmail" : "Gmail отклонил уведомление об отправке заказа", metadata: { ...context, messageId: message.id } } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: finalStatus === "SENT" ? "SEND" : "SEND_FAILED", entityType: "Message", entityId: message.id, after: { channel: "EMAIL", status: finalStatus, ...context } } });
    return result(updated);
  });
  const uncertain = async () => {
    try { await recordUncertain(context.clientRequestId, clientId, actor.id, providerMessageId); } catch { /* Durable PENDING reservation still blocks resending after DB failure. */ }
    try {
      const attempt = await prisma.messageDeliveryAttempt.findUnique({ where: { id: context.attemptId } });
      if (attempt) return result(attempt);
    } catch { /* The committed attempt remains protected even while the database is unavailable. */ }
    return { status: "UNCERTAIN" as const, attemptId: context.attemptId };
  };
  try { const response = await transport.send({ to: context.recipient, subject: context.subject, text: context.content, messageId: providerMessageId, accountIdentity: context.accountIdentity }); if (response.messageId !== providerMessageId) return uncertain(); }
  catch (error) {
    // Only explicit SMTP/config rejection is definitive. Network and unknown outcomes are protected.
    if (error instanceof BadRequestException || (error instanceof BadGatewayException && error.message === "Gmail отклонил исходящее письмо")) {
      try { return await finish("FAILED"); } catch { return uncertain(); }
    }
    return uncertain();
  }
  try { return await finish("SENT"); } catch { return uncertain(); }
}
