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
