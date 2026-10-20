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

const chatwootCustomerEmail = (value: unknown, channel: MetaInboundMessage["channel"] | "CHATWOOT" | "EMAIL") => {
  const email = String(value || "").trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/^\d+@facebook\.com$/i.test(email) ? email : undefined;
};

const profileText = (value: unknown, maxLength: number) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : undefined;
};

export type ChatwootContactProfile = {
  displayName?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  city?: string;
  country?: string;
};

export type ChatwootContactRecord = ChatwootContactProfile & {
  contactId: string;
  sourceId: string;
  candidateExternalIds: string[];
  channel: MetaInboundMessage["channel"] | "CHATWOOT" | "EMAIL";
};

export function chatwootContactProfile(payload: unknown): ChatwootContactProfile | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const wrapper = payload as RecordLike;
  const contact = wrapper.payload && typeof wrapper.payload === "object" && !Array.isArray(wrapper.payload)
    ? wrapper.payload as RecordLike
    : wrapper;
  const attributes = contact.additional_attributes && typeof contact.additional_attributes === "object" && !Array.isArray(contact.additional_attributes)
    ? contact.additional_attributes as RecordLike
    : {};
  const profile: ChatwootContactProfile = {
    displayName: profileText(contact.name, 240),
    email: chatwootCustomerEmail(contact.email, "CHATWOOT"),
    phone: profileText(contact.phone_number || contact.phone, 80),
    avatarUrl: safeUrl(contact.thumbnail || contact.avatar_url),
    city: profileText(attributes.city, 160),
    country: profileText(attributes.country || attributes.country_code, 120),
  };
  return Object.values(profile).some(Boolean) ? profile : undefined;
}

export function chatwootContactRecords(payload: unknown, inboxId: string): ChatwootContactRecord[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const rows = Array.isArray((payload as RecordLike).payload) ? (payload as RecordLike).payload as unknown[] : [];
  const records: ChatwootContactRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const contact = row as RecordLike, contactId = String(contact.id || "");
    if (!/^\d+$/.test(contactId) || Number(contactId) <= 0) continue;
    const profile = chatwootContactProfile(contact);
    if (!profile || ![profile.email, profile.phone, profile.avatarUrl, profile.city, profile.country].some(Boolean)) continue;
    const inboxes = Array.isArray(contact.contact_inboxes) ? contact.contact_inboxes : [];
    for (const entry of inboxes) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as RecordLike, itemInbox = item.inbox && typeof item.inbox === "object" ? item.inbox as RecordLike : {};
      const sourceId = profileText(item.source_id, 500);
      if (String(itemInbox.id || "") !== inboxId || !sourceId) continue;
      const identifier = profileText(contact.identifier, 500);
      records.push({ ...profile, contactId, sourceId, candidateExternalIds: [...new Set([sourceId, identifier, contactId].filter((value): value is string => Boolean(value)))], channel: channelFor(itemInbox.channel_type) });
    }
  }
  return records;
}

export function chatwootHasNextPage(payload: unknown, requestedPage: number) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const value = payload as RecordLike;
  const rows = Array.isArray(value.payload) ? value.payload : [];
  if (!rows.length) return false;
  const meta = value.meta && typeof value.meta === "object" && !Array.isArray(value.meta) ? value.meta as RecordLike : {};
  const currentPage = Math.max(1, Number(meta.current_page) || requestedPage);
  const totalPages = Number(meta.total_pages);
  if (Number.isFinite(totalPages) && totalPages > 0) return currentPage < totalPages;
  const totalContacts = Number(meta.count);
  if (!Number.isFinite(totalContacts) || totalContacts <= 0) return true;
  const providerPageSize = Math.max(1, Number(meta.per_page) || rows.length);
  return currentPage * providerPageSize < totalContacts;
}

export function chatwootBackfillBatch(records: ChatwootContactRecord[], page: number, offset: number, limit: number, hasNextPage: boolean) {
  const batchLimit = Math.max(1, Math.min(50, Math.floor(limit) || 15));
  const selected = records.slice(offset, offset + batchLimit);
  const nextCursor = offset + selected.length < records.length
    ? `${page}:${offset + selected.length}`
    : hasNextPage ? `${page + 1}:0` : undefined;
  return { records: selected, nextCursor };
}

export async function fetchChatwootContactProfile(url: string, token: string, fetchImpl: typeof fetch = fetch) {
  try {
    const response = await fetchImpl(url, { headers: { api_access_token: token, Accept: "application/json" }, signal: AbortSignal.timeout(8000), redirect: "error" });
    return response.ok ? chatwootContactProfile(await boundedChatwootResponseJson(response)) : undefined;
  } catch {
    return undefined;
  }
}

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
  avatarUrl?: string;
  city?: string;
  country?: string;
  metadata: MetaInboundMessage["metadata"] & {
    chatwootConversationId?: string;
    chatwootContactId?: string;
    attachments?: ChatwootAttachment[];
  };
};

export type ChatwootReadReceipt = {
  channel: MetaInboundMessage["channel"] | "CHATWOOT" | "EMAIL";
  externalMessageId: string;
  accountId: string;
  inboxId: string;
  conversationId: string;
  receivedAt: Date;
};

export type ChatwootMessageUpdate = Omit<ChatwootReadReceipt, "receivedAt">;

export async function boundedChatwootResponseJson(response: Response, maxBytes = 2_000_000) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new RangeError("CHATWOOT_RESPONSE_TOO_LARGE");
  if (!response.body) throw new TypeError("CHATWOOT_RESPONSE_BODY_MISSING");
  const reader = response.body.getReader(), chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RangeError("CHATWOOT_RESPONSE_TOO_LARGE");
    }
    chunks.push(Buffer.from(part.value));
  }
  return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
}

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

const chatwootTimestamp = (value: unknown) => {
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (Number.isSafeInteger(seconds) && seconds > 0) {
    const parsed = new Date(seconds * 1000);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
};

export function normalizeChatwootMessageUpdate(payload: unknown): ChatwootMessageUpdate | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as RecordLike;
  if (value.event !== "message_updated" || value.message_type !== "outgoing" || value.private === true) return undefined;
  const messageId = String(value.id || ""), accountId = String(value.account?.id || value.conversation?.account_id || ""), inboxId = String(value.inbox?.id || value.conversation?.inbox_id || value.conversation?.inbox?.id || ""), conversationId = String(value.conversation?.id || value.conversation_id || "");
  if (!/^\d+$/.test(messageId) || !/^\d+$/.test(accountId) || !/^\d+$/.test(inboxId) || !/^\d+$/.test(conversationId)) return undefined;
  const channelType = value.inbox?.channel_type || value.conversation?.inbox?.channel_type || value.conversation?.channel;
  return { channel: channelFor(channelType), externalMessageId: `chatwoot:${accountId}:${messageId}`, accountId, inboxId, conversationId };
}

export function normalizeChatwootReadReceipt(payload: unknown): ChatwootReadReceipt | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as RecordLike, candidate = normalizeChatwootMessageUpdate(value), receivedAt = chatwootTimestamp(value.updated_at);
  return candidate && value.status === "read" && receivedAt ? { ...candidate, receivedAt } : undefined;
}

export function chatwootReadReceiptFromApi(candidate: ChatwootMessageUpdate | undefined, payload: unknown): ChatwootReadReceipt | undefined {
  if (!candidate || !payload || typeof payload !== "object") return undefined;
  const messages = Array.isArray((payload as RecordLike).payload) ? (payload as RecordLike).payload as RecordLike[] : [];
  const messageId = candidate.externalMessageId.split(":").at(-1);
  const message = messages.find(item => String(item.id || "") === messageId);
  if (!message || message.status !== "read" || ![1, "1", "outgoing"].includes(message.message_type)) return undefined;
  if (String(message.account_id || "") !== candidate.accountId || String(message.inbox_id || "") !== candidate.inboxId || String(message.conversation_id || "") !== candidate.conversationId) return undefined;
  const receivedAt = chatwootTimestamp(message.updated_at);
  return receivedAt ? { ...candidate, receivedAt } : undefined;
}

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
  const conversationSender = value.conversation?.meta?.sender || {};
  const messageSender = value.sender || {};
  const sender = direction === "INBOUND" ? messageSender : conversationSender;
  const fallbackSender = direction === "INBOUND" ? conversationSender : messageSender;
  const contactIdCandidate = String(sender.id || fallbackSender.id || "");
  const chatwootContactId = /^\d+$/.test(contactIdCandidate) && Number(contactIdCandidate) > 0 ? contactIdCandidate : undefined;
  const sourceId = value.conversation?.contact_inbox?.source_id || sender.identifier || fallbackSender.identifier || sender.id || fallbackSender.id;
  const messageId = value.id;
  if (!sourceId || !messageId) return [];
  const attachments = (Array.isArray(value.attachments) ? value.attachments : []).filter((item: unknown): item is RecordLike => Boolean(item && typeof item === "object" && !Array.isArray(item))).map(normalizeAttachment);
  const types = attachments.map(item => item.type);
  const labels: Record<string, string> = { image: "[Фото]", video: "[Видео]", audio: "[Аудио]", file: "[Файл]" };
  const content = String(value.content || (types.length ? labels[types[0]!] || "[Вложение]" : "")).trim().slice(0, 5000);
  if (!content) return [];
  const channelType = value.inbox?.channel_type || value.conversation?.inbox?.channel_type || value.conversation?.channel;
  const rawDate = Number(value.created_at), receivedAt = Number.isFinite(rawDate) && rawDate > 0 ? new Date(rawDate * 1000) : new Date();
  const channel = channelFor(channelType);
  return [{
    channel,
    direction,
    externalSenderId: String(sourceId),
    externalMessageId: `chatwoot:${String(value.account?.id || value.conversation?.account_id || "0")}:${String(messageId)}`,
    content,
    displayName: String(sender.name || fallbackSender.name || "").trim() || undefined,
    email: chatwootCustomerEmail(sender.email, channel) || chatwootCustomerEmail(fallbackSender.email, channel),
    phone: String(sender.phone_number || sender.phone || fallbackSender.phone_number || fallbackSender.phone || "").trim() || undefined,
    accountId: String(value.account?.id || value.conversation?.account_id || "") || undefined,
    inboxId: String(value.inbox?.id || value.conversation?.inbox_id || value.conversation?.inbox?.id || "") || undefined,
    receivedAt,
    metadata: {
      messageType: value.content_type || types[0] || "text",
      chatwootConversationId: String(value.conversation?.id || value.conversation_id || "") || undefined,
      chatwootContactId,
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
