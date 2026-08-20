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
  metadata: { messageType: string; attachmentTypes?: string[] };
};

type AnyRecord = Record<string, any>;
const records = (value: unknown): AnyRecord[] => Array.isArray(value) ? value.filter(x => x && typeof x === "object") : [];
const asDate = (value: unknown, seconds = false) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * (seconds ? 1000 : 1)) : new Date();
};

function messengerMessages(payload: AnyRecord, channel: "FACEBOOK" | "INSTAGRAM") {
  const output: MetaInboundMessage[] = [];
  for (const entry of records(payload.entry)) for (const event of records(entry.messaging)) {
    const message = event.message;
    if (!message || message.is_echo === true || !event.sender?.id || !message.mid) continue;
    const attachmentTypes = records(message.attachments).map(x => String(x.type || "file"));
    const content = String(message.text || (attachmentTypes[0] === "image" ? "[Фото]" : attachmentTypes.length ? "[Вложение]" : "")).trim().slice(0, 5000);
    if (!content) continue;
    output.push({ channel, externalSenderId: String(event.sender.id), externalMessageId: String(message.mid), content, receiverId: String(entry.id || event.recipient?.id || "") || undefined, receivedAt: asDate(event.timestamp), metadata: { messageType: message.text ? "text" : attachmentTypes[0] || "attachment", ...(attachmentTypes.length ? { attachmentTypes } : {}) } });
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
