const META_MEDIA_HOST = /(^|\.)(?:fbcdn\.net|cdninstagram\.com|fbsbx\.com|facebook\.com|instagram\.com)$/i;

export function chatwootConversationId(messages: Array<{ metadata: unknown }>) {
  for (const message of messages) {
    if (!message.metadata || typeof message.metadata !== "object" || Array.isArray(message.metadata)) continue;
    const value = (message.metadata as Record<string, unknown>).chatwootConversationId;
    if (typeof value === "string" && /^\d+$/.test(value)) return value;
  }
}

export function chatwootConversationInboxUrl(baseUrl: unknown, accountId: unknown, conversationId: unknown) {
  if (typeof baseUrl !== "string" || typeof accountId !== "string" || typeof conversationId !== "string" || !/^\d+$/.test(accountId) || !/^\d+$/.test(conversationId)) return "";
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return `${url.origin}/app/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}`;
  } catch { return ""; }
}

export function remoteMediaUrl(value: unknown, additionalOrigin?: string) {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && (META_MEDIA_HOST.test(url.hostname) || url.origin === additionalOrigin)) return url;
  } catch {}
}

export function chatwootMultipartBody(content: string, attachment: { bytes: Uint8Array; name: string; mimeType: string }) {
  const form = new FormData();
  form.set("message_type", "outgoing");
  form.set("private", "false");
  if (content) form.set("content", content);
  form.append("attachments[]", new Blob([Uint8Array.from(attachment.bytes).buffer], { type: attachment.mimeType }), attachment.name);
  return form;
}

export function chatwootEchoDecision(
  previousMetadata: Record<string, unknown>,
  eventMetadata: Record<string, unknown>,
  payloadHash: string,
  context: { seenAt: string; accountId?: string; inboxId?: string },
) {
  if (previousMetadata.chatwootWebhookPayloadHash === payloadHash) return { kind: "UNCHANGED" as const };
  return {
    kind: "SYNC" as const,
    metadata: {
      ...previousMetadata,
      chatwootWebhook: eventMetadata,
      chatwootWebhookPayloadHash: payloadHash,
      webhookSeenAt: context.seenAt,
      accountId: context.accountId,
      inboxId: context.inboxId,
    },
  };
}
