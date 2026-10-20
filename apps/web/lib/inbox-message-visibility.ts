type InboxMessage = {
  id: string;
  status?: string;
  channel?: string;
  content: string;
  createdAt: string;
  direction?:string;
  sentAt?:string|null;
  receivedAt?:string|null;
  metadata?: { composerDraftKey?: string; aiRunId?: string };
};

export function prepareInboxMessages<T extends InboxMessage>(messages: T[], channel: string) {
  const visible = messages.filter(message => message.status !== "DRAFT").sort((left,right)=>new Date(inboxMessageTimestamp(left)).getTime()-new Date(inboxMessageTimestamp(right)).getTime());
  const draft = messages
    .filter(message => message.status === "DRAFT" && message.channel === channel)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  return {
    visible,
    draft,
    draftKey: draft?.metadata?.composerDraftKey,
    draftAiRunId: draft?.metadata?.aiRunId,
  };
}

export function inboxMessageTimestamp(message:Pick<InboxMessage,'createdAt'|'sentAt'|'receivedAt'|'direction'|'status'>){
  return message.direction==='OUTBOUND'&&message.status==='SENT' ? message.sentAt||message.createdAt
    : message.direction==='INBOUND' ? message.receivedAt||message.createdAt : message.createdAt;
}

export function restoreInboxDraft<T extends InboxMessage>(messages: T[], channel: string, volatileContent?: string) {
  const prepared = prepareInboxMessages(messages, channel);
  return {
    ...prepared,
    content: volatileContent !== undefined ? volatileContent : prepared.draft?.content || "",
  };
}

export function inboxDraftNeedsSave(
  savedText: string,
  savedAiRunId: string | undefined,
  nextText: string,
  nextAiRunId: string | undefined,
) {
  const normalizedText = nextText.trim();
  return Boolean(normalizedText) && (normalizedText !== savedText || nextAiRunId !== savedAiRunId);
}
