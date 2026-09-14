type InboxMessage = {
  id: string;
  status?: string;
  channel?: string;
  content: string;
  createdAt: string;
  metadata?: { composerDraftKey?: string };
};

export function prepareInboxMessages<T extends InboxMessage>(messages: T[], channel: string) {
  const visible = messages.filter(message => message.status !== "DRAFT");
  const draft = messages
    .filter(message => message.status === "DRAFT" && message.channel === channel)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  return {
    visible,
    draft,
    draftKey: draft?.metadata?.composerDraftKey,
  };
}

export function restoreInboxDraft<T extends InboxMessage>(messages: T[], channel: string, volatileContent?: string) {
  const prepared = prepareInboxMessages(messages, channel);
  return {
    ...prepared,
    content: volatileContent !== undefined ? volatileContent : prepared.draft?.content || "",
  };
}
