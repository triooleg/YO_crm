import { createHmac, timingSafeEqual } from "node:crypto";
import type { MetaInboundMessage } from "./meta-webhook";

type RecordLike = Record<string, any>;

const channelFor = (value: unknown): MetaInboundMessage["channel"] | "CHATWOOT" | "EMAIL" => {
  const key = String(value || "").toLowerCase();
  if (key.includes("facebook")) return "FACEBOOK";
  if (key.includes("instagram")) return "INSTAGRAM";
  if (key.includes("whatsapp")) return "WHATSAPP";
  if (key.includes("email")) return "EMAIL";
  return "CHATWOOT";
};

export type ChatwootInboundMessage = Omit<MetaInboundMessage, "channel"> & {
  channel: MetaInboundMessage["channel"] | "CHATWOOT" | "EMAIL";
  accountId?: string;
  inboxId?: string;
};

export function normalizeChatwootWebhook(payload: unknown): ChatwootInboundMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as RecordLike;
  if (value.event !== "message_created" || value.message_type !== "incoming") return [];
  const sender = value.sender || value.conversation?.meta?.sender || {};
  const sourceId = value.conversation?.contact_inbox?.source_id || sender.identifier || sender.id;
  const messageId = value.id;
  if (!sourceId || !messageId) return [];
  const attachments = Array.isArray(value.attachments) ? value.attachments : [];
  const types = attachments.map((item: RecordLike) => String(item.file_type || item.type || "file"));
  const content = String(value.content || (types[0]?.includes("image") ? "[Фото]" : types.length ? "[Вложение]" : "")).trim().slice(0, 5000);
  if (!content) return [];
  const channelType = value.inbox?.channel_type || value.conversation?.inbox?.channel_type || value.conversation?.channel;
  const rawDate = Number(value.created_at), receivedAt = Number.isFinite(rawDate) && rawDate > 0 ? new Date(rawDate * 1000) : new Date();
  return [{
    channel: channelFor(channelType),
    externalSenderId: String(sourceId),
    externalMessageId: `chatwoot:${String(value.account?.id || value.conversation?.account_id || "0")}:${String(messageId)}`,
    content,
    displayName: String(sender.name || "").trim() || undefined,
    email: String(sender.email || "").trim().toLowerCase() || undefined,
    phone: String(sender.phone_number || sender.phone || "").trim() || undefined,
    accountId: String(value.account?.id || value.conversation?.account_id || "") || undefined,
    inboxId: String(value.inbox?.id || value.conversation?.inbox_id || value.conversation?.inbox?.id || "") || undefined,
    receivedAt,
    metadata: { messageType: value.content_type || types[0] || "text", ...(types.length ? { attachmentTypes: types } : {}) },
  }];
}

export function verifyChatwootSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature || !secret) return false;
  const supplied = signature.replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}
