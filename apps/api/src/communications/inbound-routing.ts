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

export function isSyntheticFacebookEmail(value: unknown) {
  return typeof value === "string" && /^\s*\d+@facebook\.com\s*$/i.test(value);
}

export function customerEmail(value: unknown, channel: string) {
  if (typeof value !== "string") return undefined;
  const email = value.trim().toLowerCase();
  if (!email || (channel === "FACEBOOK" && isSyntheticFacebookEmail(email))) return undefined;
  return email;
}

export function presentClientContact<T extends { email?: string | null; facebook?: string | null; source?: string | null }>(client: T): T {
  const isFacebook = Boolean(client.facebook) || client.source === "FACEBOOK";
  return isFacebook && isSyntheticFacebookEmail(client.email) ? { ...client, email: null } : client;
}

export function shouldRefreshInboundDisplayName(current: string, incoming: string, provider: string, channel: string) {
  const next = incoming.trim();
  if (!next || next === current.trim()) return false;
  if (provider === "META") return /^(Facebook|Instagram) \d+$/.test(current);
  if (provider !== "CHATWOOT" || channel !== "CHATWOOT") return false;
  return /^Chatwoot \S+$/.test(current) || /^[a-z][a-z0-9]*-[a-z][a-z0-9]*-\d{3,}$/.test(current);
}
