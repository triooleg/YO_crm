import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { metaWebhookReceiverMatches } from '../communications/meta-webhook';
import { qualifyNativeHistoryBaseline, type NativeHistorySnapshot } from './history-native-evidence';
import { historyDigest, projectExistingHistory, type ProjectedHistory } from './history-planning-model';
import type { HistoryPlanningRepository } from './history-planning.repository';
import { readOriginalInstagramMessages } from './history-provider-originals';

type History = Awaited<ReturnType<HistoryPlanningRepository['history']>>;

/** Operational coordinator only: run after its canonical-client and exclusive
 * conversation locks. No HTTP-provided evidence, verified-ID list or name match.
 * Later, independently proven native rows cannot overlap this archive window;
 * leave them intact and out of the archive candidate matcher, without aliases.
 */
export async function readQualifiedNativeProjection(db: Prisma.TransactionClient, history: History, archive: readonly unknown[], transport: typeof fetch = fetch): Promise<ProjectedHistory> {
  const conversation = history.conversations[0];
  if (history.conversations.length !== 1 || !conversation || conversation.channel !== 'INSTAGRAM' || conversation.archivedAt ||
    typeof conversation.externalId !== 'string' || !/^[1-9][0-9]{0,39}:[1-9][0-9]{0,39}$/.test(conversation.externalId))
    throw new ConflictException('Требуется однозначная действующая Instagram-переписка');
  const receiverId = conversation.externalId.split(':')[0]!;
  const [client] = await db.$queryRaw<NativeHistorySnapshot['client'][]>`SELECT "id","instagram","instagramUsername","archivedAt" FROM "Client" WHERE "id"=${conversation.clientId}`;
  if (!client) throw new ConflictException('Клиент переписки недоступен');
  const settings = await db.$queryRaw<{key: string; value: unknown}[]>`SELECT "key","value" FROM "AppSetting"
    WHERE "section"='integration.meta' AND "key" IN ('instagramAccountId','instagramWebhookReceiverId','instagramAccessTokenEncrypted')`;
  if (!metaWebhookReceiverMatches('INSTAGRAM', receiverId, Object.fromEntries(settings.map(row => [row.key, row.value]))))
    throw new ConflictException('Аккаунт переписки не подтверждён текущей интеграцией');
  const ids = history.messages.map(row => row.id), envelopeIds = history.messages.map(row => row.webhookEnvelopeId).filter((id): id is string => id !== null);
  const [budget] = await db.$queryRaw<{count: number; bytes: string}[]>`WITH evidence AS (
    SELECT row_to_json(e)::text AS body FROM "WebhookEnvelope" e WHERE e."id"=ANY(${envelopeIds}::text[])
    UNION ALL SELECT row_to_json(a)::text FROM "MessageDeliveryAttempt" a WHERE a."messageId"=ANY(${ids}::text[])
    UNION ALL SELECT row_to_json(a)::text FROM "MessageAttachment" a WHERE a."messageId"=ANY(${ids}::text[])
  ) SELECT count(*)::int AS count,COALESCE(sum(octet_length(body)),0)::text AS bytes FROM (SELECT body FROM evidence LIMIT 10001) bounded`;
  if (!budget || budget.count > 10000 || !/^\d+$/.test(budget.bytes) || Number(budget.bytes) > 33554432)
    throw new ConflictException('Доказательства Instagram превышают лимит сверки');
  const envelopes = await db.$queryRaw<NativeHistorySnapshot['envelopes'][number][]>`SELECT * FROM "WebhookEnvelope" WHERE "id"=ANY(${envelopeIds}::text[]) ORDER BY "id" LIMIT 10001`;
  const deliveryAttempts = await db.$queryRaw<NativeHistorySnapshot['deliveryAttempts'][number][]>`SELECT * FROM "MessageDeliveryAttempt" WHERE "messageId"=ANY(${ids}::text[]) ORDER BY "id" LIMIT 10001`;
  const attachments = await db.$queryRaw<NativeHistorySnapshot['attachments'][number][]>`SELECT "messageId","type","externalUrl","metadata" FROM "MessageAttachment" WHERE "messageId"=ANY(${ids}::text[]) ORDER BY "id" LIMIT 10001`;
  const originIds = new Set(history.origins.map(row => row.messageId));
  const legacy = history.messages.filter(message => {
    if (originIds.has(message.id)) return false;
    const raw = message.rawPayload;
    return !(message.direction === 'INBOUND' && raw && typeof raw === 'object' && !Array.isArray(raw) &&
      'originalTimestamp' in raw && typeof raw.originalTimestamp === 'string' && message.receivedAt?.toISOString() === raw.originalTimestamp);
  });
  const providerObservations = await readOriginalInstagramMessages(legacy, receiverId, client.instagram ?? '',
    settings.find(row => row.key === 'instagramAccessTokenEncrypted')?.value, transport);
  const snapshot = {client, receiverId, archive, conversations: history.conversations, messages: history.messages,
    origins: history.origins, envelopes, deliveryAttempts, attachments, providerObservations};
  const proof = qualifyNativeHistoryBaseline(snapshot);
  if (proof.status !== 'QUALIFIED' || !proof.fingerprint) throw new ConflictException('Исходная история Instagram требует дополнительной сверки');
  const nativeIds = new Set(proof.validatedMessageIds);
  const projected = projectExistingHistory({...history, messages: history.messages.filter(message => !nativeIds.has(message.id))});
  return {...projected, fingerprint: historyDigest({history, nativeProof: proof.fingerprint})};
}
