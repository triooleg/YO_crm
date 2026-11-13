import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { openHistoryEvidence, sealHistoryEvidence } from './history-evidence';
import type { HistoryNativeBinding, HistoryNativeReview, HistoryNativeStorage } from './history-native-reconciliation';

type ProtectedBinding = Extract<HistoryNativeBinding, {kind: 'PROTECTED'}>;
type NativeRun = {id: string; nativeConversationId: string; nativeAccountId: string; nativeCustomerId: string; status: string};
const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value);

/** Same-transaction adapter only. A missing schema, corrupt binding or damaged
 * ciphertext is an error, never permission to bypass historical reconciliation.
 * The ingress caller must commit review evidence before acknowledging delivery.
 */
export class PrismaHistoryNativeStorage implements HistoryNativeStorage {
  constructor(private readonly db: Prisma.TransactionClient) {}
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]) { return this.db.$executeRaw(query, ...values); }
  async loadBinding(conversationId: string): Promise<HistoryNativeBinding> {
    const runs = await this.db.$queryRaw<NativeRun[]>`SELECT "id","nativeConversationId","nativeAccountId","nativeCustomerId","status"
      FROM "HistoryMigrationPilotRun" WHERE "environment"='OPERATIONAL_NATIVE' AND "nativeConversationId"=${conversationId} ORDER BY "id" LIMIT 2`;
    if (!runs.length) return {kind: 'NONE'};
    const run = runs[0]!;
    if (runs.length !== 1 || run.nativeConversationId !== conversationId ||
      ![run.id, run.nativeAccountId, run.nativeCustomerId].every(identifier) || !['APPLIED', 'ROLLED_BACK'].includes(run.status))
      throw new ConflictException('Нарушена привязка импорта к переписке');
    return {kind: 'PROTECTED', conversationId, channel: 'INSTAGRAM', accountId: run.nativeAccountId,
      customerId: run.nativeCustomerId, runId: run.id, status: run.status as ProtectedBinding['status']};
  }
  async loadWindow(binding: ProtectedBinding): Promise<unknown | null> {
    const rows = await this.db.$queryRaw<{payloadEncrypted: string}[]>`SELECT "payloadEncrypted" FROM "HistoryMigrationNativeWindow" WHERE "runId"=${binding.runId}`;
    if (!rows.length) return null;
    if (rows.length !== 1) throw new ConflictException('Неоднозначное окно импорта');
    return openHistoryEvidence('NATIVE_WINDOW', `${binding.runId}:${binding.conversationId}`, rows[0]!.payloadEncrypted);
  }
  async insertReviewAndEnvelope(review: HistoryNativeReview): Promise<{id: string; created: boolean}> {
    if (!review.runId || !/^[a-f0-9]{64}$/.test(review.reviewKey) || !/^[a-f0-9]{64}$/.test(review.payloadHash))
      throw new ConflictException('Отсутствует привязка сверки к импорту');
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'history-native-review:' + review.reviewKey},0))`;
    const [existing] = await this.db.$queryRaw<{id: string; payloadEncrypted: string; runId: string; conversationId: string;
      scopeKey: string; payloadHash: string; reason: string; status: string}[]>`SELECT "id","payloadEncrypted","runId","conversationId","scopeKey","payloadHash","reason","status"
      FROM "HistoryMigrationNativeReview" WHERE "id"=${review.reviewKey}`;
    if (existing) {
      const evidence = openHistoryEvidence<HistoryNativeReview>('NATIVE_REVIEW', review.reviewKey, existing.payloadEncrypted);
      if (existing.id !== review.reviewKey || existing.id !== evidence.reviewKey ||
        !['PENDING','RESOLVED'].includes(existing.status) ||
        existing.runId !== evidence.runId || existing.conversationId !== evidence.conversationId || existing.scopeKey !== evidence.scopeKey ||
        existing.payloadHash !== evidence.payloadHash || existing.reason !== evidence.reason ||
        evidence.eventJson !== review.eventJson || evidence.scopeKey !== review.scopeKey || evidence.payloadHash !== review.payloadHash || evidence.runId !== review.runId ||
        evidence.conversationId !== review.conversationId)
        throw new ConflictException('Конфликт доказательств повторной доставки');
      return {id: existing.id, created: false};
    }
    const encrypted = sealHistoryEvidence('NATIVE_REVIEW', review.reviewKey, review), envelopeId = randomUUID();
    // The complete raw event/envelope remain authenticated in encrypted evidence.
    await this.db.$executeRaw`INSERT INTO "WebhookEnvelope" ("id","provider","payload","payloadHash")
      VALUES (${envelopeId},'HISTORY_NATIVE_REVIEW',${JSON.stringify({version: 1, reviewId: review.reviewKey, encryptedEvidence: encrypted})}::jsonb,${review.payloadHash})`;
    await this.db.$executeRaw`INSERT INTO "HistoryMigrationNativeReview"
      ("id","runId","conversationId","scopeKey","payloadHash","reason","payloadEncrypted","webhookEnvelopeId")
      VALUES (${review.reviewKey},${review.runId},${review.conversationId},${review.scopeKey},${review.payloadHash},${review.reason},${encrypted},${envelopeId})`;
    return {id: review.reviewKey, created: true};
  }
}
