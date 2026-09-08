export function metaRecipientId(pageId: string, conversationExternalId?: string | null) {
  const prefix = pageId + ":";
  return pageId && conversationExternalId?.startsWith(prefix)
    ? conversationExternalId.slice(prefix.length)
    : "";
}

export function metaRecipientIdForReceivers(receiverIds: string[], conversationExternalId?: string | null) {
  for (const receiverId of new Set(receiverIds.filter(Boolean))) {
    const recipientId = metaRecipientId(receiverId, conversationExternalId);
    if (recipientId) return recipientId;
  }
  return "";
}

export function metaTextMessageParams(recipientId: string, content: string, replyExternalMessageId?: string) {
  return {
    recipient: JSON.stringify({ id: recipientId }),
    messaging_type: "RESPONSE",
    message: JSON.stringify({ text: content, ...(replyExternalMessageId ? { reply_to: { mid: replyExternalMessageId } } : {}) }),
  };
}

export function metaCommentReplyParams(channel: "FACEBOOK" | "INSTAGRAM", commentId: string, content: string) {
  if (!/^[A-Za-z0-9_:-]{1,300}$/.test(commentId)) throw new RangeError("Invalid Meta comment id");
  return { path: commentId + (channel === "INSTAGRAM" ? "/replies" : "/comments"), params: { message: content } };
}

export function instagramReactionMessageParams(recipientId: string, externalMessageId: string, action: "react" | "unreact") {
  return {
    recipient: JSON.stringify({ id: recipientId }),
    sender_action: action,
    payload: JSON.stringify({ message_id: externalMessageId, ...(action === "react" ? { reaction: "love" } : {}) }),
  };
}

const whatsappReactionEmojis = ["❤️", "😂", "😮", "😢", "😡", "👍"] as const;

export function whatsappReactionMessageParams(recipientId: string, externalMessageId: string, action: "react" | "unreact", emoji?: string) {
  if (action === "react" && !whatsappReactionEmojis.includes(emoji as typeof whatsappReactionEmojis[number])) {
    throw new RangeError("Unsupported WhatsApp reaction emoji");
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientId,
    type: "reaction",
    reaction: { message_id: externalMessageId, emoji: action === "react" ? emoji! : "" },
  };
}

export function metaAttachmentMessageParams(recipientId: string, type: "image" | "video" | "file", url: string, replyExternalMessageId?: string) {
  return {
    recipient: JSON.stringify({ id: recipientId }),
    messaging_type: "RESPONSE",
    message: JSON.stringify({ attachment: { type, payload: { url, is_reusable: true } }, ...(replyExternalMessageId ? { reply_to: { mid: replyExternalMessageId } } : {}) }),
  };
}

export function whatsappTextMessageParams(recipientId: string, content: string, replyExternalMessageId?: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientId,
    ...(replyExternalMessageId ? { context: { message_id: replyExternalMessageId } } : {}),
    type: "text",
    text: { preview_url: true, body: content },
  };
}

export function whatsappImageMimeAllowed(mimeType: string) {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}

export function whatsappVideoMimeAllowed(mimeType: string) {
  return mimeType === "video/mp4";
}

export function whatsappAttachmentHistoryContent(type: "image" | "video" | "file", name: string, content = "") {
  const caption = content.trim();
  return caption || (type === "image" ? "[Фото]" : type === "video" ? "[Видео]" : name);
}

export function whatsappAttachmentMessageParams(recipientId: string, type: "image" | "video" | "file", url: string, name: string, content = "", replyExternalMessageId?: string) {
  const caption = content.trim();
  if ([...caption].length > 1024) throw new RangeError("WhatsApp media caption exceeds 1024 characters");
  const context = replyExternalMessageId ? { context: { message_id: replyExternalMessageId } } : {};
  if (type === "image") return { messaging_product: "whatsapp", recipient_type: "individual", to: recipientId, ...context, type: "image", image: { link: url, ...(caption ? { caption } : {}) } };
  if (type === "video") return { messaging_product: "whatsapp", recipient_type: "individual", to: recipientId, ...context, type: "video", video: { link: url, ...(caption ? { caption } : {}) } };
  return { messaging_product: "whatsapp", recipient_type: "individual", to: recipientId, ...context, type: "document", document: { link: url, filename: name, ...(caption ? { caption } : {}) } };
}

export function whatsappMessageId(result: { messages?: Array<{ id?: string }> }) {
  return typeof result.messages?.[0]?.id === "string" ? result.messages[0].id : "";
}

export function metaThreadControlParams(recipientId: string) {
  return { recipient: JSON.stringify({ id: recipientId }) };
}

export type MetaFailureReason =
  | "TOKEN_EXPIRED"
  | "PERMISSION_REQUIRED"
  | "RECIPIENT_UNAVAILABLE"
  | "THREAD_CONTROL_REQUIRED"
  | "REPLY_WINDOW_CLOSED"
  | "RATE_LIMITED"
  | "PROVIDER_REJECTED";

export function metaSendFailure(error: { code?: number; error_subcode?: number } | undefined) {
  const code = Number(error?.code) || undefined;
  const subcode = Number(error?.error_subcode) || undefined;
  let reason: MetaFailureReason = "PROVIDER_REJECTED";
  if (subcode === 2018278) reason = "REPLY_WINDOW_CLOSED";
  else if (subcode === 2018300 || subcode === 2018171 || (code === 27 && subcode === 1893034)) reason = "THREAD_CONTROL_REQUIRED";
  else if (code === 190) reason = "TOKEN_EXPIRED";
  else if (code === 10) reason = "PERMISSION_REQUIRED";
  else if (code === 551) reason = "RECIPIENT_UNAVAILABLE";
  else if (code === 613) reason = "RATE_LIMITED";
  return { ...(code ? { code } : {}), ...(subcode ? { subcode } : {}), reason };
}

export async function deliverMetaWithThreadControl<T>(operations: {
  send: () => Promise<T>;
  takeControl: () => Promise<unknown>;
  isThreadControlError: (error: unknown) => boolean;
  onTakeControlSuccess: () => Promise<unknown>;
  onTakeControlFailure: () => Promise<unknown>;
}) {
  try {
    return await operations.send();
  } catch (error) {
    if (!operations.isThreadControlError(error)) throw error;
    try {
      await operations.takeControl();
    } catch (takeError) {
      await operations.onTakeControlFailure();
      throw takeError;
    }
    await operations.onTakeControlSuccess();
    return operations.send();
  }
}

export function deliverMetaMessage<T>(channel: "FACEBOOK" | "INSTAGRAM" | "WHATSAPP", operations: Parameters<typeof deliverMetaWithThreadControl<T>>[0]) {
  return channel === "FACEBOOK"
    ? deliverMetaWithThreadControl(operations)
    : operations.send();
}

export async function deliverInstagramReplyWithFallback<T>(operations: {
  sendReply: () => Promise<T>;
  sendPlain: () => Promise<T>;
  isReplyContextRejection: (error: unknown) => boolean;
}) {
  try {
    return { result: await operations.sendReply(), usedFallback: false };
  } catch (error) {
    if (!operations.isReplyContextRejection(error)) throw error;
    return { result: await operations.sendPlain(), usedFallback: true };
  }
}

export class MetaGraphRequestError extends Error {
  readonly failure: ReturnType<typeof metaSendFailure>;
  constructor(failure: ReturnType<typeof metaSendFailure>) {
    super("Meta Graph request failed");
    this.failure = failure;
    this.name = "MetaGraphRequestError";
  }
}

export class MetaDeliveryUncertainError extends Error {
  constructor() {
    super("Meta did not confirm the delivery result");
    this.name = "MetaDeliveryUncertainError";
  }
}

export async function releaseUncertainWhatsappAttempt<T>(operations: {
  claim: () => Promise<boolean>;
  releaseAttachment: () => Promise<unknown>;
  recordResolution: () => Promise<T>;
  changedError: () => Error;
}) {
  if (!(await operations.claim())) throw operations.changedError();
  await operations.releaseAttachment();
  return operations.recordResolution();
}

export type MetaSendReservation<T> =
  | { kind: "NEW" }
  | { kind: "PENDING" }
  | { kind: "DONE"; result: T };

export async function runMetaSendOnce<T, P>(operations: {
  reserve: () => Promise<MetaSendReservation<T>>;
  deliver: () => Promise<P>;
  persistSuccess: (providerResult: P) => Promise<T>;
  persistSuccessFailure?: (providerResult: P, error: unknown) => Promise<T>;
  persistFailure: (error: unknown) => Promise<T>;
  pendingError: () => Error;
}) {
  const reservation = await operations.reserve();
  if (reservation.kind === "DONE") return reservation.result;
  if (reservation.kind === "PENDING") throw operations.pendingError();
  let providerResult: P;
  try {
    providerResult = await operations.deliver();
  } catch (error) {
    return operations.persistFailure(error);
  }
  try { return await operations.persistSuccess(providerResult); }
  catch (error) { if (operations.persistSuccessFailure) return operations.persistSuccessFailure(providerResult,error); throw error; }
}
