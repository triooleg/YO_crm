import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";

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
    replyTo?: { kind: "story" | "message"; externalMessageId?: string; storyId?: string; storyUrl?: string };
  };
};

export type MetaEchoMessage = Omit<MetaInboundMessage, "externalSenderId" | "displayName" | "email" | "phone"> & {
  externalRecipientId: string;
};

export function metaEchoAlreadyProcessed(metadata: unknown) {
  return Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof (metadata as AnyRecord).metaEchoReceivedAt === "string");
}

export function mergeMetaEchoMetadata(existing: unknown, eventMetadata: MetaEchoMessage["metadata"], receiverId: string | undefined, sentAt: Date) {
  const prior = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as AnyRecord : {};
  return { ...prior, ...eventMetadata, receiverId, provider: "META", source: prior.source === "CRM" ? "CRM" : "META", metaEchoReceivedAt: sentAt.toISOString() };
}

export function mergeMetaReadMetadata(existing: unknown, readAt: Date) {
  const prior = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as AnyRecord : {};
  const previous = typeof prior.metaReadAt === "string" ? new Date(prior.metaReadAt) : undefined;
  if (previous && Number.isFinite(previous.getTime()) && previous.getTime() >= readAt.getTime()) return { ...prior };
  return { ...prior, metaReadAt: readAt.toISOString() };
}

export function isMetaMessageReadAt(sentAt: Date | null | undefined, watermarkAt: Date) {
  return Boolean(sentAt && Number.isFinite(sentAt.getTime()) && sentAt.getTime() <= watermarkAt.getTime());
}

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
  channel: "FACEBOOK" | "INSTAGRAM" | "WHATSAPP";
  receiverId?: string;
  externalPartyId?: string;
  externalMessageId?: string;
  eventType: "message_echo" | "read" | "delivery" | "reaction" | "message_edit" | "postback";
  receivedAt: Date;
  readWatermarkAt?: Date;
  editedText?: string;
  reactionAction?: "react" | "unreact";
  reactionName?: string;
  reactionEmoji?: string;
  reactionActor?: "CUSTOMER" | "BUSINESS";
};

type AnyRecord = Record<string, any>;
const records = (value: unknown): AnyRecord[] => Array.isArray(value) ? value.filter(x => x && typeof x === "object") : [];
const asDate = (value: unknown, seconds = false) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * (seconds ? 1000 : 1)) : new Date();
};
const strictMetaTimestamp = (value: unknown) => {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 8_640_000_000_000_000) return undefined;
  const parsed = new Date(n);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
};
const strictWhatsAppTimestamp = (value: unknown) => {
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds) || seconds <= 0) return undefined;
  const parsed = new Date(seconds * 1000);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
};

const reactionEmojiByName: Record<string, string> = {
  love: "❤️",
  like: "👍",
  haha: "😂",
  wow: "😮",
  sad: "😢",
  angry: "😡",
};

export function mergeMetaReactionMetadata(existing: unknown, event: MetaControlEvent) {
  const prior = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as AnyRecord : {};
  const priorReactions = prior.reactions && typeof prior.reactions === "object" && !Array.isArray(prior.reactions) ? prior.reactions as AnyRecord : {};
  const priorVersions = prior.reactionVersions && typeof prior.reactionVersions === "object" && !Array.isArray(prior.reactionVersions) ? prior.reactionVersions as AnyRecord : {};
  const reactions = { ...priorReactions };
  const key = event.reactionActor === "BUSINESS" ? "business" : "customer";
  const eventTime = event.receivedAt.toISOString();
  const previousTime = typeof priorVersions[key] === "string" ? Date.parse(priorVersions[key]) : NaN;
  if (Number.isFinite(previousTime) && previousTime > event.receivedAt.getTime()) return { ...prior };
  if (event.reactionAction === "unreact") delete reactions[key];
  else reactions[key] = {
    name: event.reactionName || "love",
    emoji: event.reactionEmoji || reactionEmojiByName[event.reactionName || "love"] || "❤️",
    reactedAt: eventTime,
  };
  return { ...prior, reactions, reactionVersions: { ...priorVersions, [key]: eventTime } };
}

export function metaConversationExternalId(receiverId: string | undefined, senderId: string) {
  return receiverId ? `${receiverId}:${senderId}` : senderId;
}

export function metaProfileTargets(events:MetaInboundMessage[]){
  const unique=new Map<string,{channel:"FACEBOOK"|"INSTAGRAM";receiverId:string;senderId:string}>();
  for(const event of events)if((event.channel==="FACEBOOK"||event.channel==="INSTAGRAM")&&event.receiverId){const target={channel:event.channel,receiverId:event.receiverId,senderId:event.externalSenderId};unique.set(event.channel+":"+metaConversationExternalId(target.receiverId,target.senderId),target)}
  return [...unique.values()];
}

export type MetaFacebookProfile = {
  name?: unknown;
  username?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  profile_pic?: unknown;
  locale?: unknown;
  timezone?: unknown;
  location?: unknown;
  hometown?: unknown;
  email?: unknown;
};

export type NormalizedMetaFacebookProfile = {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  language?: string;
  timezone?: string;
  instagramUsername?: string;
  city?: string;
  email?: string;
};

export async function resolveMetaFacebookProfile(
  lookup: (fields: string) => Promise<MetaFacebookProfile>,
): Promise<MetaFacebookProfile> {
  const identity = await lookup("first_name,last_name,profile_pic");
  // Meta can reject one optional field group while allowing another. Keep the
  // identity response and evaluate both optional groups independently.
  const optional = await lookup("locale,timezone").catch(() => ({}));
  const contact = await lookup("location,email").catch(() => ({}));
  return { ...contact, ...optional, ...identity };
}

export type MetaConversationsResponse = {
  data?: Array<{ id?: unknown; participants?: { data?: Array<{
    id?: unknown;
    name?: unknown;
    email?: unknown;
    picture?: { data?: { url?: unknown } };
  }> } }>;
};

function metaConversationParticipantAvatar(participant: AnyRecord) {
  const picture = participant.picture;
  if (!picture || typeof picture !== "object" || Array.isArray(picture)) return "";
  const data = (picture as AnyRecord).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  return cleanProfileText((data as AnyRecord).url, 2048);
}

export async function resolveMetaFacebookProfileWithFallback(
  profileLookup: (fields: string) => Promise<MetaFacebookProfile>,
  conversationsLookup: () => Promise<MetaConversationsResponse>,
  isObjectUnavailable: (error: unknown) => boolean,
  psid: string,
  pageId: string,
) {
  try {
    return { profile: await resolveMetaFacebookProfile(profileLookup), source: "USER_PROFILE" as const };
  } catch (error) {
    if (!isObjectUnavailable(error)) throw error;
  }
  const conversations = await conversationsLookup();
  const names = new Set<string>();
  const avatars = new Set<string>();
  const emails = new Set<string>();
  for (const conversation of records(conversations.data)) {
    for (const participant of records(conversation.participants?.data)) {
      if (String(participant.id || "") !== psid || String(participant.id || "") === pageId) continue;
      const name = cleanProfileText(participant.name);
      if (name) names.add(name);
      const avatar = metaConversationParticipantAvatar(participant);
      if (avatar) avatars.add(avatar);
      const email = cleanProfileEmail(participant.email);
      if (email) emails.add(email);
    }
  }
  if (names.size <= 1 && avatars.size <= 1 && emails.size <= 1 && (names.size || avatars.size || emails.size)) return {
    profile: {
      ...(names.size ? { name: [...names][0] } : {}),
      ...(avatars.size ? { profile_pic: [...avatars][0] } : {}),
      ...(emails.size ? { email: [...emails][0] } : {}),
    },
    source: "CONVERSATIONS" as const,
  };
  return { profile: {}, source: "CONVERSATIONS" as const };
}

const META_AVATAR_HOST = /(^|\.)(?:fbcdn\.net|cdninstagram\.com|fbsbx\.com)$/i;

export function isMetaManagedAvatarUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && META_AVATAR_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function facebookFallbackProfileTargets(
  conversations: Array<{ externalId?: string | null; client: { id: string; displayName: string; avatarUrl?: string | null; city?: string | null; email?: string | null; language?: string | null; timezone?: string | null } }>,
  pageId: string,
) {
  const targets = new Map<string, { clientId: string; psid: string; needsName: boolean; needsAvatar: boolean; needsDetails: boolean }>();
  const prefix = pageId + ":";
  for (const conversation of conversations) {
    const needsName = /^Facebook \d+$/.test(conversation.client.displayName);
    const needsAvatar = conversation.client.avatarUrl === null || isMetaManagedAvatarUrl(conversation.client.avatarUrl);
    const needsDetails = [conversation.client.city, conversation.client.email, conversation.client.language, conversation.client.timezone].some(value => value === null);
    if ((!needsName && !needsAvatar && !needsDetails) || targets.has(conversation.client.id)) continue;
    const externalId = conversation.externalId || "";
    const psid = externalId.startsWith(prefix) ? externalId.slice(prefix.length) : "";
    if (!/^\d+$/.test(psid)) continue;
    targets.set(conversation.client.id, { clientId: conversation.client.id, psid, needsName, needsAvatar, needsDetails });
  }
  return [...targets.values()];
}

export async function runFacebookProfileBackfillBatch(
  conversations: Array<{ externalId?: string | null; client: { id: string; displayName: string; avatarUrl?: string | null; city?: string | null; email?: string | null; language?: string | null; timezone?: string | null } }>,
  pageId: string,
  limit: number,
  dryRun: boolean,
  resolve: (psid: string) => Promise<{ profile: NormalizedMetaFacebookProfile; source: "USER_PROFILE" | "CONVERSATIONS" }>,
  persist: (psid: string, profile: NormalizedMetaFacebookProfile) => Promise<boolean>,
  onFailure?: (psid: string, error: unknown) => void,
) {
  const page = conversations.slice(0, limit);
  const targets = facebookFallbackProfileTargets(page, pageId);
  let resolvedViaUserProfile = 0, resolvedViaConversations = 0, unresolved = 0, updated = 0, avatarsResolvedViaUserProfile = 0, avatarsResolvedViaConversations = 0, avatarsUnavailable = 0;
  for (const target of targets) try {
    const result = await resolve(target.psid);
    if (target.needsName && result.profile.displayName) {
      if (result.source === "USER_PROFILE") resolvedViaUserProfile++;
      else resolvedViaConversations++;
    } else if (target.needsName) unresolved++;
    if (target.needsAvatar) {
      if (result.profile.avatarUrl && result.source === "USER_PROFILE") avatarsResolvedViaUserProfile++;
      else if (result.profile.avatarUrl) avatarsResolvedViaConversations++;
      else avatarsUnavailable++;
    }
    if (!dryRun && Object.keys(result.profile).length && await persist(target.psid, result.profile)) updated++;
  } catch (error) {
    if (target.needsName) unresolved++;
    if (target.needsAvatar) avatarsUnavailable++;
    onFailure?.(target.psid, error);
  }
  return {
    dryRun,
    fallbackClientsFound: targets.filter(target => target.needsName).length,
    avatarClientsFound: targets.filter(target => target.needsAvatar).length,
    resolvedViaUserProfile,
    resolvedViaConversations,
    avatarsResolvedViaUserProfile,
    avatarsResolvedViaConversations,
    avatarsUnavailable,
    unresolved,
    updated: dryRun ? 0 : updated,
    nextCursor: conversations.length > limit ? page.at(-1)?.client.id ?? null : null,
  };
}

export type ExistingMetaClientProfile = {
  firstName: string;
  lastName?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  country?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  language?: string | null;
  timezone?: string | null;
  instagramUsername?: string | null;
};

const cleanProfileText = (value: unknown, max = 160) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const cleanProfileEmail = (value: unknown) => {
  const email = cleanProfileText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};

export function normalizeMetaFacebookProfile(profile: MetaFacebookProfile): NormalizedMetaFacebookProfile {
  const output: NormalizedMetaFacebookProfile = {};
  const firstName = cleanProfileText(profile.first_name);
  const lastName = cleanProfileText(profile.last_name);
  const displayName = cleanProfileText(profile.name) || [firstName, lastName].filter(Boolean).join(" ") || cleanProfileText(profile.username);
  if (displayName) {
    output.displayName = displayName;
    output.firstName = firstName || displayName;
    if (lastName) output.lastName = lastName;
  }

  const instagramUsername = cleanProfileText(profile.username).replace(/^@/, "");
  if (instagramUsername) output.instagramUsername = instagramUsername;

  const avatarUrl = cleanProfileText(profile.profile_pic, 2048);
  if (avatarUrl) {
    try {
      const parsed = new URL(avatarUrl);
      if (parsed.protocol === "https:") output.avatarUrl = parsed.toString();
    } catch {}
  }

  const locale = cleanProfileText(profile.locale, 16);
  const localeMatch = /^([a-z]{2,3})(?:[_-]([A-Z]{2}))?$/.exec(locale);
  // Meta locale is a UI preference, not verified residence. Never infer country from it.
  if (localeMatch) output.language = localeMatch[1];

  const timezone = profile.timezone;
  if (typeof timezone === "number" && Number.isInteger(timezone) && timezone >= -12 && timezone <= 14) {
    const sign = timezone >= 0 ? "+" : "-";
    const absolute = Math.abs(timezone);
    output.timezone = `UTC${sign}${absolute.toString().padStart(2, "0")}:00`;
  }

  const location = profile.location && typeof profile.location === "object" && !Array.isArray(profile.location)
    ? profile.location as { name?: unknown }
    : undefined;
  const city = cleanProfileText(location?.name, 160);
  if (city) output.city = city;
  const email = cleanProfileEmail(profile.email);
  if (email) output.email = email;

  return output;
}

export function metaFacebookProfilePatch(before: ExistingMetaClientProfile, profile: NormalizedMetaFacebookProfile) {
  const patch: NormalizedMetaFacebookProfile = {};
  const technical = /^(Facebook|Instagram) \d+$/.test(before.displayName);
  if (technical) {
    const displayName = profile.displayName;
    const firstName = profile.firstName || displayName;
    if (displayName && displayName !== before.displayName) patch.displayName = displayName;
    if (firstName && firstName !== before.firstName) patch.firstName = firstName;
    if (profile.lastName && profile.lastName !== before.lastName) patch.lastName = profile.lastName;
  }
  if (
    profile.avatarUrl &&
    profile.avatarUrl !== before.avatarUrl &&
    (!before.avatarUrl || (isMetaManagedAvatarUrl(before.avatarUrl) && isMetaManagedAvatarUrl(profile.avatarUrl)))
  ) patch.avatarUrl = profile.avatarUrl;
  for (const key of ["city", "email", "language", "timezone"] as const) {
    if (!before[key] && profile[key]) patch[key] = profile[key];
  }
  if (profile.instagramUsername && profile.instagramUsername !== before.instagramUsername) patch.instagramUsername = profile.instagramUsername;
  return patch;
}

export async function persistMetaFacebookProfilePatch(
  before: ExistingMetaClientProfile,
  profile: NormalizedMetaFacebookProfile,
  updateActiveClient: (patch: NormalizedMetaFacebookProfile) => Promise<boolean>,
  recordHistory: (changedFields: string[]) => Promise<void>,
) {
  const patch = metaFacebookProfilePatch(before, profile);
  const changedFields = Object.keys(patch);
  if (!changedFields.length || !(await updateActiveClient(patch))) return false;
  await recordHistory(changedFields);
  return true;
}

export function metaIdentityLogRef(value: string | undefined) {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 12) : undefined;
}

export function safeMetaWebhookLogSummary(summary: MetaWebhookEventSummary) {
  const { senderId, recipientId, ...safe } = summary;
  return { ...safe, senderRef: metaIdentityLogRef(senderId), recipientRef: metaIdentityLogRef(recipientId) };
}

export function uniqueMetaControlTarget<T extends { conversationExternalId: string }>(candidates: T[], receiverId: string | undefined) {
  if (!receiverId) return undefined;
  const scoped = candidates.filter(candidate => candidate.conversationExternalId.startsWith(receiverId + ":"));
  return scoped.length === 1 ? scoped[0] : undefined;
}

export function metaWebhookReceiverMatches(
  channel: "FACEBOOK" | "INSTAGRAM" | "WHATSAPP",
  receiverId: string | undefined,
  settings: Record<string, unknown>,
) {
  if (!receiverId) return false;
  if (channel === "FACEBOOK") return receiverId === settings.pageId;
  if (channel === "WHATSAPP") return receiverId === settings.whatsappPhoneNumberId;
  const oauthAccountId = typeof settings.instagramAccountId === "string" && /^\d+$/.test(settings.instagramAccountId)
    ? settings.instagramAccountId
    : "";
  const verifiedReceiverId = typeof settings.instagramWebhookReceiverId === "string" && /^\d+$/.test(settings.instagramWebhookReceiverId)
    ? settings.instagramWebhookReceiverId
    : "";
  return receiverId === oauthAccountId || receiverId === verifiedReceiverId;
}

export function metaConnectedAccountLabel(channel: string | undefined, settings: Record<string, unknown>) {
  if (channel === "FACEBOOK") {
    return typeof settings.pageName === "string" && settings.pageName.trim()
      ? settings.pageName.trim()
      : typeof settings.pageId === "string" ? settings.pageId.trim() : "";
  }
  if (channel === "INSTAGRAM") {
    const username = typeof settings.instagramUsername === "string" ? settings.instagramUsername.trim().replace(/^@/, "") : "";
    if (username) return `@${username}`;
    return typeof settings.instagramAccountId === "string" ? settings.instagramAccountId.trim() : "";
  }
  return "";
}

export function metaConversationInboxUrl(channel: string | undefined, externalId: string | null | undefined, settings: Record<string, unknown>) {
  if (channel !== "FACEBOOK" && channel !== "INSTAGRAM") return "";
  const match = /^(\d+):(\d+)$/.exec(externalId || "");
  if (!match) return "";
  if (channel === "FACEBOOK") {
    const pageId = typeof settings.pageId === "string" ? settings.pageId.trim() : "";
    if (!/^\d+$/.test(pageId)) return "";
    if (match[1] !== pageId) return "";
    return `https://business.facebook.com/latest/inbox/messenger?asset_id=${pageId}&selected_item_id=${match[2]}`;
  }
  const username = typeof settings.instagramClientUsername === "string"
    ? settings.instagramClientUsername.trim().replace(/^@/, "")
    : "";
  return /^[A-Za-z0-9._]+$/.test(username) ? `https://ig.me/m/${username}` : "";
}

export function legacyConversationMatchesReceiver(metadata: unknown, receiverId: string | undefined) {
  if (!receiverId || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as AnyRecord).receiverId === receiverId;
}

export function metaEchoConversationExternalIds(receiverId: string | undefined, recipientId: string, legacyMetadata: unknown) {
  const scoped = metaConversationExternalId(receiverId, recipientId);
  return scoped !== recipientId && legacyConversationMatchesReceiver(legacyMetadata, receiverId) ? [scoped, recipientId] : [scoped];
}

function messengerMessages(payload: AnyRecord, channel: "FACEBOOK" | "INSTAGRAM") {
  const output: MetaInboundMessage[] = [];
  for (const entry of records(payload.entry)) for (const [source, event] of [
    ...records(entry.messaging).map(event => ["messages", event] as const),
    ...records(entry.standby).map(event => ["standby", event] as const),
  ]) {
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
    const reply = message.reply_to;
    const replyTo = reply?.story && (typeof reply.story.url === "string" || typeof reply.story.id === "string")
      ? { kind: "story" as const, ...(typeof reply.story.id === "string" ? { storyId: reply.story.id } : {}), ...(typeof reply.story.url === "string" ? { storyUrl: reply.story.url } : {}) }
      : typeof reply?.mid === "string" ? { kind: "message" as const, externalMessageId: reply.mid } : undefined;
    const attachmentLabel: Record<string, string> = { image: "[Фото]", video: "[Видео]", audio: "[Аудио]", file: "[Файл]", fallback: "[Вложение]", sticker: "[Стикер]" };
    const content = String(message.text || attachments.map(x => attachmentLabel[x.type] || "[Вложение]").join("\n")).trim().slice(0, 5000);
    if (!content) continue;
    output.push({ channel, externalSenderId: String(event.sender.id), externalMessageId: String(message.mid), content, receiverId: String(entry.id || event.recipient?.id || "") || undefined, receivedAt: asDate(event.timestamp), metadata: { messageType: message.text ? "text" : attachmentTypes[0] || "attachment", ...(source === "standby" ? { handoverSource: "standby" } : {}), ...(attachmentTypes.length ? { attachmentTypes, attachments } : {}), ...(replyTo ? { replyTo } : {}) } });
  }
  return output;
}

function whatsappAttachments(message: AnyRecord) {
  const type = String(message.type || "unknown"), typed = message[type];
  if (!typed || typeof typed !== "object" || !typed.id || !["image", "video", "audio", "document", "sticker"].includes(type)) return [];
  return [{
    type: type === "document" || type === "audio" ? "file" : type,
    mediaId: String(typed.id),
    ...(typeof typed.mime_type === "string" ? { mimeType: typed.mime_type } : {}),
    ...(typeof typed.filename === "string" ? { name: typed.filename.slice(0, 180) } : {}),
  }];
}

export function normalizeMetaEchoMessages(payload: unknown): MetaEchoMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as AnyRecord;
  if (value.object === "whatsapp_business_account") {
    const output: MetaEchoMessage[] = [];
    for (const entry of records(value.entry)) for (const change of records(entry.changes)) {
      const changeValue = change.value || {};
      for (const message of records(changeValue.message_echoes)) {
        if (message.type === "reaction") continue;
        if (!message.id || !message.to) continue;
        const type = String(message.type || "unknown"), typed = message[type] || {};
        const content = String(type === "text" ? message.text?.body : typed.caption || (type === "document" && typed.filename ? typed.filename : undefined) || ({ image: "[Фото]", video: "[Видео]", audio: "[Аудио]", document: "[Документ]", sticker: "[Стикер]", location: "[Геопозиция]", contacts: "[Контакт]" } as Record<string,string>)[type] || "[Сообщение]").trim().slice(0, 5000);
        if (!content) continue;
        const attachments = whatsappAttachments(message);
        const replyExternalMessageId = String(message.context?.id || "");
        output.push({ channel: "WHATSAPP", externalRecipientId: String(message.to), externalMessageId: String(message.id), content, receiverId: String(changeValue.metadata?.phone_number_id || "") || undefined, receivedAt: asDate(message.timestamp, true), metadata: { messageType: type, ...(replyExternalMessageId ? { replyTo: { kind: "message", externalMessageId: replyExternalMessageId } as const } : {}), ...(attachments.length ? { attachmentTypes: attachments.map(item => item.type), attachments } : {}) } });
      }
    }
    return output;
  }
  if (value.object !== "page" && value.object !== "instagram") return [];
  const channel: MetaEchoMessage["channel"] = value.object === "page" ? "FACEBOOK" : "INSTAGRAM", output: MetaEchoMessage[] = [];
  for (const entry of records(value.entry)) for (const event of [...records(entry.messaging), ...records(entry.standby)]) {
    const message = event.message;
    if (!message?.mid || message.is_echo !== true || !event.recipient?.id) continue;
    const attachments = records(message.attachments).map(x => ({
      type: String(x.type || "file"),
      ...(typeof x.payload?.url === "string" ? { url: x.payload.url } : {}),
    }));
    const attachmentTypes = attachments.map(x => x.type);
    const labels: Record<string, string> = { image: "[Фото]", video: "[Видео]", audio: "[Аудио]", file: "[Файл]", fallback: "[Вложение]", sticker: "[Стикер]" };
    const content = String(message.text || attachments.map(x => labels[x.type] || "[Вложение]").join("\n")).trim().slice(0, 5000);
    if (!content) continue;
    output.push({ channel, externalRecipientId: String(event.recipient.id), externalMessageId: String(message.mid), content, receiverId: String(entry.id || event.sender?.id || "") || undefined, receivedAt: asDate(event.timestamp), metadata: { messageType: message.text ? "text" : attachmentTypes[0] || "attachment", ...(attachmentTypes.length ? { attachmentTypes, attachments } : {}) } });
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
    if (object === "page" || object === "instagram") for (const event of [...records(entry.messaging), ...records(entry.standby)]) {
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
      const messages = records(change.value?.messages), echoes = records(change.value?.message_echoes);
      if (!messages.length && !echoes.length) output.push({ object, ...(entry.id !== undefined ? { entryId: String(entry.id) } : {}), eventType: records(change.value?.statuses).length ? "status" : String(change.field || "change"), hasText: false, attachmentCount: 0, attachmentTypes: [], isEcho: false, isTest: false });
      for (const message of messages) output.push({ object, ...(entry.id !== undefined ? { entryId: String(entry.id) } : {}), eventType: "message", ...(message.from !== undefined ? { senderId: String(message.from) } : {}), ...(change.value?.metadata?.phone_number_id !== undefined ? { recipientId: String(change.value.metadata.phone_number_id) } : {}), ...(message.id !== undefined ? { mid: String(message.id) } : {}), hasText: message.type === "text" && typeof message.text?.body === "string", attachmentCount: message.type === "text" ? 0 : 1, attachmentTypes: message.type === "text" ? [] : [String(message.type || "unknown")], isEcho: false, isTest: String(message.id || "").includes("test_message") });
      for (const message of echoes) output.push({ object, ...(entry.id !== undefined ? { entryId: String(entry.id) } : {}), eventType: "message_echo", ...(message.from !== undefined ? { senderId: String(message.from) } : {}), ...(message.to !== undefined ? { recipientId: String(message.to) } : {}), ...(message.id !== undefined ? { mid: String(message.id) } : {}), hasText: message.type === "text" && typeof message.text?.body === "string", attachmentCount: message.type === "text" ? 0 : 1, attachmentTypes: message.type === "text" ? [] : [String(message.type || "unknown")], isEcho: true, isTest: String(message.id || "").includes("test_message") });
    }
  }
  return output;
}

export function normalizeMetaControlEvents(payload: unknown): MetaControlEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as AnyRecord;
  if (value.object === "whatsapp_business_account") {
    const output: MetaControlEvent[] = [];
    for (const entry of records(value.entry)) for (const change of records(entry.changes)) {
      const receiverId = String(change.value?.metadata?.phone_number_id || "");
      for (const status of records(change.value?.statuses)) {
        if (status.status !== "read") continue;
        const externalMessageId = String(status.id || ""), externalPartyId = String(status.recipient_id || ""), receivedAt = strictWhatsAppTimestamp(status.timestamp);
        if (!receiverId || !externalMessageId || !externalPartyId || !receivedAt) continue;
        output.push({ channel: "WHATSAPP", receiverId, externalPartyId, externalMessageId, eventType: "read", receivedAt });
      }
      for (const message of records(change.value?.messages)) {
        if (message.type !== "reaction" || typeof message.reaction?.emoji !== "string") continue;
        const externalMessageId = String(message.reaction?.message_id || ""), externalPartyId = String(message.from || ""), receivedAt = strictWhatsAppTimestamp(message.timestamp);
        const reactionEmoji = [...message.reaction.emoji.trim()].slice(0, 16).join("");
        if (!receiverId || !externalMessageId || !externalPartyId || !receivedAt) continue;
        output.push({ channel: "WHATSAPP", receiverId, externalPartyId, externalMessageId, eventType: "reaction", receivedAt, reactionAction: reactionEmoji ? "react" : "unreact", reactionName: "whatsapp", ...(reactionEmoji ? { reactionEmoji } : {}), reactionActor: "CUSTOMER" });
      }
      for (const message of records(change.value?.message_echoes)) {
        if (message.type !== "reaction" || typeof message.reaction?.emoji !== "string") continue;
        const externalMessageId = String(message.reaction?.message_id || ""), externalPartyId = String(message.to || ""), receivedAt = strictWhatsAppTimestamp(message.timestamp);
        const reactionEmoji = [...message.reaction.emoji.trim()].slice(0, 16).join("");
        if (!receiverId || !externalMessageId || !externalPartyId || !receivedAt) continue;
        output.push({ channel: "WHATSAPP", receiverId, externalPartyId, externalMessageId, eventType: "reaction", receivedAt, reactionAction: reactionEmoji ? "react" : "unreact", reactionName: "whatsapp", ...(reactionEmoji ? { reactionEmoji } : {}), reactionActor: "BUSINESS" });
      }
    }
    return output;
  }
  if (value.object !== "page" && value.object !== "instagram") return [];
  const channel: MetaControlEvent["channel"] = value.object === "page" ? "FACEBOOK" : "INSTAGRAM", output: MetaControlEvent[] = [];
  for (const entry of records(value.entry)) for (const event of records(entry.messaging)) {
    const eventType = messengerEventType(event);
    if (!(["message_echo", "read", "delivery", "reaction", "message_edit", "postback"] as string[]).includes(eventType)) continue;
    const source = event.message_edit || event.reaction || event.message_reaction || event.postback || event.delivery || event.read || event.message || {};
    const mids = Array.isArray(source.mids) ? source.mids : [source.mid || event.message?.mid].filter(Boolean);
    const receiverId = String(entry.id || event.recipient?.id || "") || undefined;
    const externalPartyId = [event.sender?.id, event.recipient?.id].map(value => value === undefined ? "" : String(value)).find(value => value && value !== receiverId);
    const readWatermarkAt = eventType === "read" ? strictMetaTimestamp(source.watermark) : undefined;
    const reaction = eventType === "reaction" ? {
      reactionAction: source.action === "unreact" ? "unreact" as const : "react" as const,
      ...(typeof source.reaction === "string" && source.reaction ? { reactionName: source.reaction } : {}),
      ...(typeof source.emoji === "string" && source.emoji ? { reactionEmoji: source.emoji } : {}),
      reactionActor: String(event.sender?.id || "") === receiverId ? "BUSINESS" as const : "CUSTOMER" as const,
    } : {};
    const base = { channel, receiverId, ...(externalPartyId ? { externalPartyId } : {}), eventType: eventType as MetaControlEvent["eventType"], receivedAt: asDate(event.timestamp), ...(readWatermarkAt ? { readWatermarkAt } : {}), ...reaction };
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
      if (type === "reaction") continue;
      const content = String(type === "text" ? message.text?.body : typed.caption || (type === "document" && typed.filename ? typed.filename : undefined) || ({ image: "[Фото]", video: "[Видео]", audio: "[Аудио]", document: "[Документ]", sticker: "[Стикер]", location: "[Геопозиция]", contacts: "[Контакт]" } as Record<string,string>)[type] || "[Сообщение]").trim().slice(0, 5000);
      const attachments = whatsappAttachments(message);
      const replyExternalMessageId = String(message.context?.id || "");
      output.push({ channel: "WHATSAPP", externalSenderId: String(message.from), externalMessageId: String(message.id), content, displayName: contacts.get(String(message.from)) || undefined, receiverId: String(value.metadata?.phone_number_id || "") || undefined, phone: String(message.from), receivedAt: asDate(message.timestamp, true), metadata: { messageType: type, ...(replyExternalMessageId ? { replyTo: { kind: "message", externalMessageId: replyExternalMessageId } as const } : {}), ...(attachments.length ? { attachmentTypes: attachments.map(item => item.type), attachments } : {}) } });
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
