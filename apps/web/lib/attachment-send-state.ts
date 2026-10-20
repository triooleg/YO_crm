export type PendingAttachmentSend<TFile, TUploaded> = {
  file?: TFile;
  uploaded?: TUploaded;
  requestId?: string;
  attachmentDelivered?: boolean;
};

export function prepareAttachmentAttempt<TFile, TUploaded>(
  state: PendingAttachmentSend<TFile, TUploaded>,
  createRequestId: () => string,
) {
  const requestId = state.requestId || createRequestId();
  return { state: { ...state, requestId }, requestId };
}

export function settleAttachmentAttempt<TFile, TUploaded>(
  state: PendingAttachmentSend<TFile, TUploaded>,
  status: string | undefined,
) {
  return status === "FAILED"
    ? { file: state.file }
    : { ...state, attachmentDelivered: true };
}

export function shouldResetAttachmentForClient(previousClientId: string | undefined, nextClientId: string) {
  return Boolean(previousClientId && previousClientId !== nextClientId);
}

export function latestSuccessfulMessage<T extends { status?: string }>(messages: T[]) {
  return messages.findLast((message) => message.status !== "FAILED");
}
