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

export function metaTextMessageParams(recipientId: string, content: string) {
  return {
    recipient: JSON.stringify({ id: recipientId }),
    messaging_type: "RESPONSE",
    message: JSON.stringify({ text: content }),
  };
}

export function metaAttachmentMessageParams(recipientId: string, type: "image" | "file", url: string) {
  return {
    recipient: JSON.stringify({ id: recipientId }),
    messaging_type: "RESPONSE",
    message: JSON.stringify({ attachment: { type, payload: { url, is_reusable: true } } }),
  };
}

export function whatsappTextMessageParams(recipientId: string, content: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientId,
    type: "text",
    text: { preview_url: true, body: content },
  };
}

export function whatsappAttachmentMessageParams(recipientId: string, type: "image" | "file", url: string, name: string) {
  return type === "image"
    ? { messaging_product: "whatsapp", recipient_type: "individual", to: recipientId, type: "image", image: { link: url, caption: name } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to: recipientId, type: "document", document: { link: url, filename: name } };
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
