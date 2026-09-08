type JsonRecord = Record<string, unknown>;

export const DRAFT_DELIVERY_STALE_MS = 120_000;

type DraftDeliveryAttempt = {
  id: string;
  status: string;
  messageId?: string | null;
  updatedAt: Date | string;
};

export function classifyDraftDeliveryRecovery(input: {
  draftMessageId: string;
  visibleDraftIds: string[];
  attempts: DraftDeliveryAttempt[];
  uncertaintyDraftIds: Map<string, string>;
  now: Date;
  staleAfterMs?: number;
}) {
  const staleBefore = input.now.getTime() - (input.staleAfterMs ?? DRAFT_DELIVERY_STALE_MS);
  const active = input.attempts.filter(attempt => attempt.status === "PENDING" || attempt.status === "UNCERTAIN");
  const singleLegacyDraft = input.visibleDraftIds.length === 1 && input.visibleDraftIds[0] === input.draftMessageId && active.length === 1;
  const recoverableIds: string[] = [], blockingIds: string[] = [];
  for (const attempt of active) {
    const linked = attempt.messageId === input.draftMessageId || input.uncertaintyDraftIds.get(attempt.id) === input.draftMessageId;
    const stale = new Date(attempt.updatedAt).getTime() <= staleBefore;
    const recoverable = (attempt.status === "UNCERTAIN" && linked)
      || (attempt.status === "PENDING" && stale && (linked || (!attempt.messageId && !input.uncertaintyDraftIds.has(attempt.id) && singleLegacyDraft)));
    (recoverable ? recoverableIds : blockingIds).push(attempt.id);
  }
  return { recoverableIds, blockingIds };
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function isSoftDeletedMessage(metadata: unknown) {
  const deletion = record(record(metadata).deletion);
  return typeof deletion.deletedAt === "string" && !Number.isNaN(Date.parse(deletion.deletedAt));
}

export function softDeleteMetadata(
  metadata: unknown,
  input: { mode: "CRM" | "CLIENT"; actorId: string; deletedAt: Date; providerDeletedAt?: Date },
) {
  const current = record(metadata);
  const previous = record(current.deletion);
  const previousDeletedAt = typeof previous.deletedAt === "string" && !Number.isNaN(Date.parse(previous.deletedAt))
    ? previous.deletedAt
    : undefined;
  const previousProviderDeletedAt = typeof previous.providerDeletedAt === "string" && !Number.isNaN(Date.parse(previous.providerDeletedAt))
    ? previous.providerDeletedAt
    : undefined;
  return {
    ...current,
    deletion: {
      mode: previous.mode === "CLIENT" || input.mode === "CLIENT" ? "CLIENT" : "CRM",
      deletedAt: previousDeletedAt ?? input.deletedAt.toISOString(),
      deletedById: typeof previous.deletedById === "string" ? previous.deletedById : input.actorId,
      ...(previousProviderDeletedAt || input.providerDeletedAt ? { providerDeletedAt: previousProviderDeletedAt ?? input.providerDeletedAt!.toISOString() } : {}),
      updatedAt: input.deletedAt.toISOString(),
      updatedById: input.actorId,
    },
  };
}

export function chatwootDeleteTarget(externalId: unknown, configuredAccountId: unknown) {
  if (typeof externalId !== "string" || typeof configuredAccountId !== "string" || !/^\d+$/.test(configuredAccountId)) return;
  const match = /^chatwoot:(\d+):(\d+)$/.exec(externalId);
  if (!match || match[1] !== configuredAccountId) return;
  return { accountId: match[1]!, messageId: match[2]! };
}
