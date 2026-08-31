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

export type ChatwootAttachment = {
  type: string;
  url?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  name?: string;
};

export type ChatwootMessage = Omit<MetaInboundMessage, "channel" | "metadata"> & {
  channel: MetaInboundMessage["channel"] | "CHATWOOT" | "EMAIL";
  direction: "INBOUND" | "OUTBOUND";
  accountId?: string;
  inboxId?: string;
  metadata: MetaInboundMessage["metadata"] & {
    chatwootConversationId?: string;
    attachments?: ChatwootAttachment[];
  };
};

const attachmentType = (value: unknown) => {
  const type = String(value || "file").toLowerCase();
  if (type.includes("image")) return "image";
  if (type.includes("video")) return "video";
  if (type.includes("audio")) return "audio";
  return "file";
};

const safeUrl = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const finiteInteger = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
};

const mimeType = (type: string, extension: string) => {
  const key = extension.toLowerCase().replace(/^\./, "");
  const known: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
    pdf: "application/pdf", txt: "text/plain",
  };
  return known[key] || (type === "image" ? "image/jpeg" : type === "video" ? "video/mp4" : undefined);
};

const normalizeAttachment = (item: RecordLike): ChatwootAttachment => {
  const type = attachmentType(item.file_type || item.type), extension = String(item.extension || "").replace(/^\./, "").toLowerCase();
  const url = safeUrl(item.data_url || item.external_url || item.url), thumbnailUrl = safeUrl(item.thumb_url || item.thumbnail_url);
  const sizeBytes = finiteInteger(item.file_size || item.size), width = finiteInteger(item.width), height = finiteInteger(item.height);
  const name = String(item.fallback_title || item.filename || item.name || (extension ? `attachment.${extension}` : "attachment")).trim().slice(0, 180);
  return {
    type,
    ...(url ? { url } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(mimeType(type, extension) ? { mimeType: mimeType(type, extension) } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(name ? { name } : {}),
  };
};

export function normalizeChatwootWebhook(payload: unknown): ChatwootMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as RecordLike;
  if (value.event !== "message_created" || !["incoming", "outgoing"].includes(value.message_type) || value.private === true) return [];
  const direction = value.message_type === "outgoing" ? "OUTBOUND" : "INBOUND";
  const sender = value.conversation?.meta?.sender || (direction === "INBOUND" ? value.sender : {}) || {};
  const sourceId = value.conversation?.contact_inbox?.source_id || sender.identifier || sender.id;
  const messageId = value.id;
  if (!sourceId || !messageId) return [];
  const attachments = (Array.isArray(value.attachments) ? value.attachments : []).filter((item: unknown): item is RecordLike => Boolean(item && typeof item === "object" && !Array.isArray(item))).map(normalizeAttachment);
  const types = attachments.map(item => item.type);
  const labels: Record<string, string> = { image: "[Фото]", video: "[Видео]", audio: "[Аудио]", file: "[Файл]" };
  const content = String(value.content || (types.length ? labels[types[0]!] || "[Вложение]" : "")).trim().slice(0, 5000);
  if (!content) return [];
  const channelType = value.inbox?.channel_type || value.conversation?.inbox?.channel_type || value.conversation?.channel;
  const rawDate = Number(value.created_at), receivedAt = Number.isFinite(rawDate) && rawDate > 0 ? new Date(rawDate * 1000) : new Date();
  return [{
    channel: channelFor(channelType),
    direction,
    externalSenderId: String(sourceId),
    externalMessageId: `chatwoot:${String(value.account?.id || value.conversation?.account_id || "0")}:${String(messageId)}`,
    content,
    displayName: String(sender.name || "").trim() || undefined,
    email: String(sender.email || "").trim().toLowerCase() || undefined,
    phone: String(sender.phone_number || sender.phone || "").trim() || undefined,
    accountId: String(value.account?.id || value.conversation?.account_id || "") || undefined,
    inboxId: String(value.inbox?.id || value.conversation?.inbox_id || value.conversation?.inbox?.id || "") || undefined,
    receivedAt,
    metadata: {
      messageType: value.content_type || types[0] || "text",
      chatwootConversationId: String(value.conversation?.id || value.conversation_id || "") || undefined,
      ...(types.length ? { attachmentTypes: types, attachments } : {}),
    },
  }];
}

export function verifyChatwootSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature || !secret) return false;
  const supplied = signature.replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}
