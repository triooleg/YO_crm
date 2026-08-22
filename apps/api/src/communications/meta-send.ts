export function metaRecipientId(pageId: string, conversationExternalId?: string | null) {
  const prefix = pageId + ":";
  return pageId && conversationExternalId?.startsWith(prefix)
    ? conversationExternalId.slice(prefix.length)
    : "";
}

export function metaTextMessageParams(recipientId: string, content: string) {
  return {
    recipient: JSON.stringify({ id: recipientId }),
    messaging_type: "RESPONSE",
    message: JSON.stringify({ text: content }),
  };
}

export type MetaFailureReason =
  | "TOKEN_EXPIRED"
  | "PERMISSION_REQUIRED"
  | "RECIPIENT_UNAVAILABLE"
  | "REPLY_WINDOW_CLOSED"
  | "RATE_LIMITED"
  | "PROVIDER_REJECTED";

export function metaSendFailure(error: { code?: number; error_subcode?: number } | undefined) {
  const code = Number(error?.code) || undefined;
  const subcode = Number(error?.error_subcode) || undefined;
  let reason: MetaFailureReason = "PROVIDER_REJECTED";
  if (subcode === 2018278) reason = "REPLY_WINDOW_CLOSED";
  else if (code === 190) reason = "TOKEN_EXPIRED";
  else if (code === 10) reason = "PERMISSION_REQUIRED";
  else if (code === 551) reason = "RECIPIENT_UNAVAILABLE";
  else if (code === 613) reason = "RATE_LIMITED";
  return { ...(code ? { code } : {}), ...(subcode ? { subcode } : {}), reason };
}

export class MetaGraphRequestError extends Error {
  constructor(public readonly failure: ReturnType<typeof metaSendFailure>) {
    super("Meta Graph request failed");
    this.name = "MetaGraphRequestError";
  }
}

export type MetaSendReservation<T> =
  | { kind: "NEW" }
  | { kind: "PENDING" }
  | { kind: "DONE"; result: T };

export async function runMetaSendOnce<T, P>(operations: {
  reserve: () => Promise<MetaSendReservation<T>>;
  deliver: () => Promise<P>;
  persistSuccess: (providerResult: P) => Promise<T>;
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
  return operations.persistSuccess(providerResult);
}
