import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaInboundMessage = {
  channel: "FACEBOOK" | "INSTAGRAM" | "WHATSAPP";
  externalSenderId: string;
  externalMessageId: string;
  content: string;
  displayName?: string;
  receiverId?: string;
  email?: string;
  phone?: string;
  receivedAt: Date;
  metadata: {
    messageType: string;
    attachmentTypes?: string[];
    attachments?: Array<{ type: string; url?: string; stickerId?: string }>;
  };
};

export type MetaWebhookEventSummary = {
  object: string;
  entryId?: string;
  eventType: string;
  senderId?: string;
  recipientId?: string;
  mid?: string;
  hasText: boolean;
  attachmentCount: number;
  attachmentTypes: string[];
  isEcho: boolean;
  isTest: boolean;
};

export type MetaControlEvent = {
  channel: "FACEBOOK" | "INSTAGRAM";
  receiverId?: string;
  externalMessageId?: string;
  eventType: "message_echo" | "read" | "delivery" | "reaction" | "message_edit" | "postback";
  receivedAt: Date;
  editedText?: string;
};

type AnyRecord = Record<string, any>;
const records = (value: unknown): AnyRecord[] => Array.isArray(value) ? value.filter(x => x && typeof x === "object") : [];
const asDate = (value: unknown, seconds = false) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * (seconds ? 1000 : 1)) : new Date();
};

export function metaConversationExternalId(receiverId: string | undefined, senderId: string) {
  return receiverId ? `${receiverId}:${senderId}` : senderId;
}

export function legacyConversationMatchesReceiver(metadata: unknown, receiverId: string | undefined) {
  if (!receiverId || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as AnyRecord).receiverId === receiverId;
}

function messengerMessages(payload: AnyRecord, channel: "FACEBOOK" | "INSTAGRAM") {
  const output: MetaInboundMessage[] = [];
  for (const entry of records(payload.entry)) for (const event of records(entry.messaging)) {
    const message = event.message;
    if (!message || message.is_echo === true || !event.sender?.id || !message.mid) continue;
    const attachments = records(message.attachments).map(x => {
      const stickerId = x.payload?.sticker_id ?? (x.type === "image" ? message.sticker_id : undefined);
      return {
        type: stickerId ? "sticker" : String(x.type || "file"),
        ...(typeof x.payload?.url === "string" ? { url: x.payload.url } : {}),
        ...(stickerId !== undefined ? { stickerId: String(stickerId) } : {}),
      };
    });
    const attachmentTypes = attachments.map(x => x.type);
    const attachmentLabel: Record<string, string> = { image: "[Фото]", video: "[Видео]", audio: "[Аудио]", file: "[Файл]", fallback: "[Вложение]", sticker: "[Стикер]" };
    const content = String(message.text || attachments.map(x => attachmentLabel[x.type] || "[Вложение]").join("\n")).trim().slice(0, 5000);
    if (!content) continue;
    output.push({ channel, externalSenderId: String(event.sender.id), externalMessageId: String(message.mid), content, receiverId: String(entry.id || event.recipient?.id || "") || undefined, receivedAt: asDate(event.timestamp), metadata: { messageType: message.text ? "text" : attachmentTypes[0] || "attachment", ...(attachmentTypes.length ? { attachmentTypes, attachments } : {}) } });
  }
  return output;
}

function messengerEventType(event: AnyRecord) {
  if (event.message?.is_echo === true) return "message_echo";
  if (event.message_edit) return "message_edit";
  if (event.message?.is_deleted || event.message?.is_unsupported === false && event.message?.mid && !event.message?.text && !event.message?.attachments) return "message_edit";
  if (event.message) return "message";
  if (event.read) return "read";
  if (event.delivery) return "delivery";
  if (event.reaction || event.message_reaction) return "reaction";
  if (event.postback) return "postback";
  return "unknown";
}

export function summarizeMetaWebhook(payload: unknown): MetaWebhookEventSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as AnyRecord, object = String(value.object || "unknown"), output: MetaWebhookEventSummary[] = [];
  for (const entry of records(value.entry)) {
    if (object === "page" || object === "instagram") for (const event of records(entry.messaging)) {
      const attachments = records(event.message?.attachments), eventType = messengerEventType(event);
      output.push({
        object,
        ...(entry.id !== undefined ? { entryId: String(entry.id) } : {}),
        eventType,
        ...(event.sender?.id !== undefined ? { senderId: String(event.sender.id) } : {}),
        ...(event.recipient?.id !== undefined ? { recipientId: String(event.recipient.id) } : {}),
        ...(event.message?.mid !== undefined ? { mid: String(event.message.mid) } : event.postback?.mid !== undefined ? { mid: String(event.postback.mid) } : {}),
        hasText: typeof event.message?.text === "string" && event.message.text.length > 0,
        attachmentCount: attachments.length,
        attachmentTypes: attachments.map(x => String(x.type || "file")),
        isEcho: event.message?.is_echo === true,
        isTest: String(event.message?.mid || event.postback?.mid || "").includes("test_message"),
      });
    }
    if (object === "whatsapp_business_account") for (const change of records(entry.changes)) {
      const messages = records(change.value?.messages);
      if (!messages.length) output.push({ object, ...(entry.id !== undefined ? { entryId: String(entry.id) } : {}), eventType: records(change.value?.statuses).length ? "status" : String(change.field || "change"), hasText: false, attachmentCount: 0, attachmentTypes: [], isEcho: false, isTest: false });
      for (const message of messages) output.push({ object, ...(entry.id !== undefined ? { entryId: String(entry.id) } : {}), eventType: "message", ...(message.from !== undefined ? { senderId: String(message.from) } : {}), ...(change.value?.metadata?.phone_number_id !== undefined ? { recipientId: String(change.value.metadata.phone_number_id) } : {}), ...(message.id !== undefined ? { mid: String(message.id) } : {}), hasText: message.type === "text" && typeof message.text?.body === "string", attachmentCount: message.type === "text" ? 0 : 1, attachmentTypes: message.type === "text" ? [] : [String(message.type || "unknown")], isEcho: false, isTest: String(message.id || "").includes("test_message") });
    }
  }
  return output;
}

export function normalizeMetaControlEvents(payload: unknown): MetaControlEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as AnyRecord;
  if (value.object !== "page" && value.object !== "instagram") return [];
  const channel: MetaControlEvent["channel"] = value.object === "page" ? "FACEBOOK" : "INSTAGRAM", output: MetaControlEvent[] = [];
  for (const entry of records(value.entry)) for (const event of records(entry.messaging)) {
    const eventType = messengerEventType(event);
    if (!(["message_echo", "read", "delivery", "reaction", "message_edit", "postback"] as string[]).includes(eventType)) continue;
    const source = event.message_edit || event.reaction || event.message_reaction || event.postback || event.delivery || event.read || event.message || {};
    const mids = Array.isArray(source.mids) ? source.mids : [source.mid || event.message?.mid].filter(Boolean);
    const base = { channel, receiverId: String(entry.id || event.recipient?.id || "") || undefined, eventType: eventType as MetaControlEvent["eventType"], receivedAt: asDate(event.timestamp) };
    if (!mids.length) output.push(base);
    else for (const mid of mids) output.push({ ...base, externalMessageId: String(mid), ...(eventType === "message_edit" && typeof source.text === "string" ? { editedText: source.text.trim().slice(0, 5000) } : {}) });
  }
  return output;
}

function whatsappMessages(payload: AnyRecord) {
  const output: MetaInboundMessage[] = [];
  for (const entry of records(payload.entry)) for (const change of records(entry.changes)) {
    const value = change.value || {}, contacts = new Map(records(value.contacts).map(x => [String(x.wa_id || ""), String(x.profile?.name || "").trim()]));
    for (const message of records(value.messages)) {
      if (!message.id || !message.from) continue;
      const type = String(message.type || "unknown"), typed = message[type] || {};
      const content = String(type === "text" ? message.text?.body : typed.caption || ({ image: "[Фото]", video: "[Видео]", audio: "[Аудио]", document: "[Документ]", sticker: "[Стикер]", location: "[Геопозиция]", contacts: "[Контакт]" } as Record<string,string>)[type] || "[Сообщение]").trim().slice(0, 5000);
      output.push({ channel: "WHATSAPP", externalSenderId: String(message.from), externalMessageId: String(message.id), content, displayName: contacts.get(String(message.from)) || undefined, receiverId: String(value.metadata?.phone_number_id || "") || undefined, phone: String(message.from), receivedAt: asDate(message.timestamp, true), metadata: { messageType: type } });
    }
  }
  return output;
}

export function normalizeMetaWebhook(payload: unknown): MetaInboundMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as AnyRecord;
  if (value.object === "page") return messengerMessages(value, "FACEBOOK");
  if (value.object === "instagram") return messengerMessages(value, "INSTAGRAM");
  if (value.object === "whatsapp_business_account") return whatsappMessages(value);
  return [];
}

export function verifyMetaSignature(rawBody: Buffer, signature: string | undefined, appSecret: string) {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex"), supplied = signature.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

export function safeTokenEqual(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
