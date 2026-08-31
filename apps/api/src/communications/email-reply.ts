type EmailReplyMetadata = Record<string, unknown>;

export function latestInboundEmailReplyLookup(conversationId: string) {
  return {
    where: { conversationId, direction: "INBOUND" as const, metadata: { path: ["messageId"], string_contains: "" } },
    orderBy: { createdAt: "desc" as const },
    select: { id: true, metadata: true },
  };
}

export function emailReplyHeaders(metadata: EmailReplyMetadata, displayName: string) {
  const subject = typeof metadata.subject === "string"
    ? (/^re:/i.test(metadata.subject) ? metadata.subject : `Re: ${metadata.subject}`)
    : `Сообщение от YOLeotard для ${displayName}`;
  const parent = typeof metadata.messageId === "string" ? metadata.messageId : undefined;
  const chain = Array.isArray(metadata.references) ? metadata.references.filter((item): item is string => typeof item === "string") : [];
  return { subject, parent, references: parent ? [...new Set([...chain, parent])] : chain };
}
