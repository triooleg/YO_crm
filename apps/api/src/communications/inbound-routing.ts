export function chatwootScopeMatches(
  configured: { accountId?: unknown; inboxId?: unknown },
  event: { accountId?: string; inboxId?: string },
) {
  const accountId = typeof configured.accountId === "string" ? configured.accountId.trim() : "";
  const inboxId = typeof configured.inboxId === "string" ? configured.inboxId.trim() : "";
  return Boolean(accountId && inboxId && event.accountId === accountId && event.inboxId === inboxId);
}

export function uniqueCandidate<T>(items: readonly T[]): T | null {
  return items.length === 1 ? items[0]! : null;
}
