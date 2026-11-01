import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { MigrationTransaction } from './history-migration.repository';
import { canonicalTargetId, type ClientRedirect, type TargetClient, type TargetRequest } from './history-targets';
import { openHistoryEvidence, sealHistoryEvidence } from './history-evidence';

export type TargetRow = { id: string; jobId: string; dialogueId: string; mode: 'EXISTING' | 'CREATE_PROPOSAL'; clientId: string | null;
  evidenceEncrypted: string; revision: number; archivedAt: Date | null; createdAt: Date; updatedAt: Date };
export type IdentityRow = { id: string; runId: string; clientId: string; payloadEncrypted: string; status: string };
export type TargetEvidence = TargetRequest & { confirmedById: string; confirmedAt: string; source: string; account: string; channel: string };
export type HistoryDbMessage = { id: string; conversationId: string; direction: string; status: string; content: string;
  normalizedText: string | null; language: string | null; messageType: string; externalId: string | null; metadata: unknown;
  rawPayload: unknown; webhookEnvelopeId: string | null; sentAt: Date | null; receivedAt: Date | null; createdAt: Date;
  replyToMessageId: string | null; aiProcessedAt: Date | null; aiAnalysisVersion: string | null; authorId: string | null };
export type HistoryDbConversation = { id: string; clientId: string; channel: string; externalId: string | null; subject: string | null;
  lastMessageAt: Date | null; unreadCount: number; unreadVersion: number; createdAt: Date; updatedAt: Date; archivedAt: Date | null };
export type OriginRow = { id: string; messageId: string; runId: string; payloadEncrypted: string; createdMessage: boolean; status: string };
export type OriginEvidence = { runId: string; messageId: string; raw: unknown; archivePolicy?:'KEYCRM_SOURCE_ARCHIVE_V1' };
export const MAX_EXISTING_MESSAGES = 10000;

/** Current job row must already be held by withJob. C1 has no run table;
 * a partial operational schema is never treated as an unused intake job. */
export async function historyOperationalJobState(tx: MigrationTransaction) {
  const [schema] = await tx.db.$queryRaw<{ runs: boolean; windows: boolean; reviews: boolean }[]>`SELECT
    to_regclass('public."HistoryMigrationPilotRun"') IS NOT NULL AS runs,
    to_regclass('public."HistoryMigrationNativeWindow"') IS NOT NULL AS windows,
    to_regclass('public."HistoryMigrationNativeReview"') IS NOT NULL AS reviews`;
  if (!schema || [schema.runs, schema.windows, schema.reviews].some(value => typeof value !== 'boolean') ||
      schema.windows !== schema.reviews || (!schema.runs && (schema.windows || schema.reviews))) throw new ConflictException('Не подтверждена схема операционного импорта');
  if (!schema.runs) return { intakeLocked: false, operationalApplied: false };
  const [state] = await tx.db.$queryRaw<{ runs: number; applied: number; invalid: number }[]>`SELECT
    count(*)::int AS runs, count(*) FILTER (WHERE "status"='APPLIED')::int AS applied,
    count(*) FILTER (WHERE "status" IS NULL OR "status" NOT IN ('APPLIED','ROLLED_BACK'))::int AS invalid
    FROM public."HistoryMigrationPilotRun" WHERE "jobId"=${tx.job.id} AND "environment"='OPERATIONAL_NATIVE'`;
  if (!state || !Number.isSafeInteger(state.runs) || state.runs < 0 || !Number.isSafeInteger(state.applied) ||
      state.applied < 0 || state.applied > state.runs || state.invalid !== 0) throw new ConflictException('Не подтверждено состояние операционного импорта');
  return { intakeLocked: state.runs > 0, operationalApplied: state.applied > 0 };
}
export async function assertHistoryJobMutationAllowed(tx: MigrationTransaction, operation: 'SOURCE' | 'CLOSE') {
  const state = await historyOperationalJobState(tx);
  if (operation === 'CLOSE' ? state.operationalApplied : state.intakeLocked)
    throw new ConflictException(operation === 'CLOSE' ? 'Сначала отмените операционный импорт: закрытие скроет доступ к откату' : 'Источники и сопоставления операционного импорта зафиксированы');
}

export class HistoryPlanningRepository {
  constructor(readonly tx: MigrationTransaction) {}
  get db(): Prisma.TransactionClient { return this.tx.db; }
  async mergeReadLock() {
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'client-merge-global'},0))`;
  }
  async clientRows(ids: readonly string[]) {
    if (!ids.length) return [];
    return this.db.$queryRaw<TargetClient[]>`SELECT "id","displayName","email","phone","whatsapp","status","archivedAt" FROM "Client" WHERE "id"=ANY(${[...ids]}::text[]) ORDER BY "id"`;
  }
  async withCanonicalClients(initial: readonly TargetClient[]) {
    const rows = new Map(initial.map(row => [row.id, row])), redirects: ClientRedirect[] = [];
    let pending = [...rows.keys()];
    for (let depth = 0; pending.length && depth <= 20; depth++) {
      const found = await this.db.$queryRaw<ClientRedirect[]>`SELECT "sourceClientId","targetClientId" FROM "ClientMergeRedirect" WHERE "sourceClientId"=ANY(${pending}::text[]) ORDER BY "sourceClientId"`;
      const unseen = found.filter(next => !redirects.some(row => row.sourceClientId === next.sourceClientId));
      redirects.push(...unseen);
      pending = [...new Set(unseen.map(row => row.targetClientId))];
      for (const client of await this.clientRows(pending)) rows.set(client.id, client);
    }
    return { clients: [...rows.values()], redirects };
  }
  async candidates(email?: string, phone?: string) {
    const normalizedEmail = email?.trim().toLowerCase() ?? '';
    const digits = phone?.replace(/[\s().-]/g, '').replace(/^\+/, '') ?? '';
    const rows = await this.db.$queryRaw<TargetClient[]>`SELECT "id","displayName","email","phone","whatsapp","status","archivedAt" FROM "Client"
      WHERE (${normalizedEmail}<>'' AND lower(trim("email"))=${normalizedEmail}) OR (${digits}<>'' AND
      (regexp_replace(COALESCE("phone",''),'[^0-9]','','g')=${digits} OR regexp_replace(COALESCE("whatsapp",''),'[^0-9]','','g')=${digits})) ORDER BY "id" LIMIT 201`;
    if (rows.length > 200) throw new ConflictException('Слишком много совпадений: требуется ручное сопоставление');
    return this.withCanonicalClients(rows);
  }
  async canonical(id: string) {
    const data = await this.withCanonicalClients(await this.clientRows([id]));
    const targetId = canonicalTargetId(id, data.clients, data.redirects);
    return { ...data, target: data.clients.find(row => row.id === targetId) ?? null };
  }
  async targets() {
    return this.db.$queryRaw<TargetRow[]>`SELECT * FROM "HistoryMigrationTarget" WHERE "jobId"=${this.tx.job.id} ORDER BY "dialogueId" LIMIT 1001`;
  }
  evidence(row: TargetRow): TargetEvidence {
    const evidence = openHistoryEvidence<TargetEvidence>('TARGET', `${row.jobId}:${row.id}:${row.revision}`, row.evidenceEncrypted);
    if (evidence.dialogueId !== row.dialogueId || evidence.mode !== row.mode || (evidence.clientId ?? null) !== row.clientId ||
      evidence.confirmedById !== this.tx.job.createdById || !Number.isFinite(Date.parse(evidence.confirmedAt)) ||
      evidence.source !== this.tx.job.source || evidence.account !== this.tx.job.account || evidence.channel !== this.tx.job.channel) throw new ConflictException('Некорректное доказательство сопоставления');
    return evidence;
  }
  async bind(request: TargetRequest) {
    await assertHistoryJobMutationAllowed(this.tx, 'SOURCE');
    const [previous] = await this.db.$queryRaw<TargetRow[]>`SELECT * FROM "HistoryMigrationTarget" WHERE "jobId"=${this.tx.job.id} AND "dialogueId"=${request.dialogueId}`;
    const id = previous?.id ?? randomUUID(), revision = (previous?.revision ?? 0) + 1;
    const evidenceEncrypted = sealHistoryEvidence('TARGET', `${this.tx.job.id}:${id}:${revision}`,
      { ...request, confirmedById: this.tx.actor.id, confirmedAt: new Date().toISOString(), source: this.tx.job.source, account: this.tx.job.account, channel: this.tx.job.channel });
    const [row] = await this.db.$queryRaw<TargetRow[]>`INSERT INTO "HistoryMigrationTarget"
      ("id","jobId","dialogueId","mode","clientId","evidenceEncrypted","revision","updatedAt")
      VALUES (${id},${this.tx.job.id},${request.dialogueId},${request.mode},${request.clientId ?? null},${evidenceEncrypted},${revision},CURRENT_TIMESTAMP)
      ON CONFLICT ("jobId","dialogueId") DO UPDATE SET "mode"=EXCLUDED."mode","clientId"=EXCLUDED."clientId",
      "evidenceEncrypted"=EXCLUDED."evidenceEncrypted","revision"=EXCLUDED."revision","archivedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP RETURNING *`;
    await this.db.$executeRaw`UPDATE "HistoryMigrationJob" SET "mappingRevision"="mappingRevision"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${this.tx.job.id}`;
    await this.tx.audit('HISTORY_TARGET_BOUND', { targetId: id, revision, mode: request.mode, clientId: request.clientId ?? null,
      previous: previous ? { mode: previous.mode, clientId: previous.clientId, revision: previous.revision, evidenceEncrypted: previous.evidenceEncrypted } : null });
    if (!row) throw new Error('Не удалось сохранить сопоставление');
    return row;
  }
  async identity(id: string) {
    const [row] = await this.db.$queryRaw<IdentityRow[]>`SELECT i.*,r."status" FROM "HistoryMigrationIdentity" i JOIN "HistoryMigrationPilotRun" r ON r."id"=i."runId" WHERE i."id"=${id}`;
    return row;
  }
  async history(clientId: string) {
    const conversations = await this.db.$queryRaw<HistoryDbConversation[]>`SELECT * FROM "Conversation" WHERE "clientId"=${clientId} AND "channel"::text=${this.tx.job.channel} ORDER BY "id"`;
    const [budget] = await this.db.$queryRaw<{ count: number; bytes: string }[]>`SELECT count(*)::int AS count,COALESCE(sum(octet_length(row_to_json(bounded)::text)),0)::text AS bytes FROM
      (SELECT m.* FROM "Message" m JOIN "Conversation" c ON c."id"=m."conversationId" WHERE c."clientId"=${clientId} AND c."channel"::text=${this.tx.job.channel} LIMIT 10001) bounded`;
    if (!budget || budget.count > MAX_EXISTING_MESSAGES || Number(budget.bytes) > 33554432) throw new ConflictException('История превышает лимит пилотной сверки');
    const messages = await this.db.$queryRaw<HistoryDbMessage[]>`SELECT m.* FROM "Message" m JOIN "Conversation" c ON c."id"=m."conversationId"
      WHERE c."clientId"=${clientId} AND c."channel"::text=${this.tx.job.channel} ORDER BY m."id" LIMIT 10001`;
    if (messages.length > MAX_EXISTING_MESSAGES) throw new ConflictException('История превышает лимит пилотной сверки; сокращение до последних сообщений запрещено');
    const ids = messages.map(row => row.id);
    if (ids.length) {
      const [originBudget] = await this.db.$queryRaw<{ count: number; bytes: string }[]>`SELECT count(*)::int AS count,COALESCE(sum(octet_length("payloadEncrypted")),0)::text AS bytes
        FROM (SELECT "payloadEncrypted" FROM "HistoryMigrationOrigin" WHERE "messageId"=ANY(${ids}::text[]) LIMIT 10001) bounded`;
      if (!originBudget || originBudget.count > 10000 || Number(originBudget.bytes) > 33554432) throw new ConflictException('Доказательства истории превышают лимит пилотной сверки');
    }
    const origins = !ids.length ? [] : await this.db.$queryRaw<OriginRow[]>`SELECT o.*,r."status" FROM "HistoryMigrationOrigin" o JOIN "HistoryMigrationPilotRun" r ON r."id"=o."runId" WHERE o."messageId"=ANY(${ids}::text[]) ORDER BY o."id" LIMIT 10001`;
    const attachments = !ids.length ? [] : await this.db.$queryRaw<{ messageId: string; count: number }[]>`SELECT "messageId",count(*)::int AS count FROM "MessageAttachment" WHERE "messageId"=ANY(${ids}::text[]) GROUP BY "messageId"`;
    const history = { conversations, messages, origins, attachments };
    if (Buffer.byteLength(JSON.stringify(history)) > 33554432) throw new ConflictException('История превышает лимит пилотной сверки');
    return history;
  }
  async incomingOrigins(keys: string[]) {
    if (!keys.length) return [];
    if (keys.length > 1000) throw new ConflictException('Слишком много исходных идентификаторов');
    // Ownership only here. Ciphertext is loaded exclusively through the budgeted history reader.
    return this.db.$queryRaw<(Pick<OriginRow, 'id' | 'messageId' | 'runId' | 'status'> & { clientId: string })[]>`SELECT o."id",o."messageId",o."runId",r."status",c."clientId" FROM "HistoryMigrationOrigin" o
      JOIN "HistoryMigrationPilotRun" r ON r."id"=o."runId" JOIN "Message" m ON m."id"=o."messageId" JOIN "Conversation" c ON c."id"=m."conversationId"
      WHERE o."id"=ANY(${keys}::text[]) ORDER BY o."id"`;
  }
}
