import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { BackupService } from '../backups/backup.service';
import type { OperationalBackupGrantContext } from '../backups/backup-operational-grant';
import { metaWebhookReceiverMatches } from '../communications/meta-webhook';
import { normalizeMessage, validateKeycrmArchiveApproval, type KeycrmArchiveApproval } from './history';
import { sealHistoryEvidence } from './history-evidence';
import { HistoryMigrationRepository, type MigrationTransaction } from './history-migration.repository';
import { archiveCutoffExclusive } from './history-native-evidence';
import { readQualifiedNativeProjection } from './history-native-projection';
import { PrismaHistoryNativeStorage } from './history-native-storage';
import type { HistoryNativeWindow } from './history-native-reconciliation';
import { loadOperationalPreparation, saveOperationalPreparation } from './history-operational-preparation';
import { buildHistoryPlan } from './history-plan';
import { historyDigest } from './history-planning-model';
import { canonicalTargetId, type ClientRedirect, type TargetClient } from './history-targets';
import { HistoryMigrationTransactionEngine, type HistoryPlan, type NativeBinding, type PilotRun } from './history-transaction-engine';
import { migrationId } from './intake-rules';

type Target = { id: string; mode: string; clientId: string | null; archivedAt: Date | null; revision: number; evidenceEncrypted: string };
type Scope = NativeBinding & { clientId: string; targetDigest: string };
export type OperationalPreparedContext = OperationalBackupGrantContext & {
  preview: Pick<HistoryPlan, 'discovered' | 'newCandidates' | 'alreadyExists' | 'review' | 'conflicts' | 'blockers' | 'sourceCompleteness'>;
};

function enabled() {
  if (process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED !== 'true') throw new NotFoundException('Операционный перенос истории не включён');
}
function candidate() {
  enabled();
  const value = process.env.CRM_COMMIT;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new ConflictException('Не подтверждена точная установленная сборка CRM');
  return value;
}
const conflict = () => new ConflictException('Требуется один подтверждённый существующий клиент и его действующая Instagram-переписка');

/** Shared global merge lock protects this bounded redirect walk. No job read. */
async function readScope(db: Prisma.TransactionClient, jobId: string): Promise<Scope> {
  const targets = await db.$queryRaw<Target[]>`SELECT "id","mode","clientId","archivedAt","revision","evidenceEncrypted"
    FROM "HistoryMigrationTarget" WHERE "jobId"=${jobId} ORDER BY "id" LIMIT 1001`;
  if (!targets.length || targets.length > 1000 || targets.some(row => row.archivedAt || row.mode !== 'EXISTING' || !row.clientId)) throw conflict();
  const clients = new Map<string, TargetClient>(), redirects: ClientRedirect[] = [];
  let pending = [...new Set(targets.map(row => row.clientId!))];
  for (let depth = 0; pending.length && depth <= 20; depth++) {
    for (const row of await db.$queryRaw<TargetClient[]>`SELECT "id","displayName","email","phone","whatsapp","status","archivedAt" FROM "Client" WHERE "id"=ANY(${pending}::text[])`)
      clients.set(row.id, row);
    const found = await db.$queryRaw<ClientRedirect[]>`SELECT "sourceClientId","targetClientId" FROM "ClientMergeRedirect" WHERE "sourceClientId"=ANY(${pending}::text[])`;
    const next = found.filter(row => !redirects.some(known => known.sourceClientId === row.sourceClientId));
    redirects.push(...next); pending = [...new Set(next.map(row => row.targetClientId))];
  }
  const canonical = targets.map(row => canonicalTargetId(row.clientId!, [...clients.values()], redirects));
  const clientId = canonical[0];
  if (!clientId || canonical.some(id => id !== clientId)) throw conflict();
  const [client] = await db.$queryRaw<{instagram: string | null; archivedAt: Date | null; status: string}[]>`SELECT "instagram","archivedAt","status" FROM "Client" WHERE "id"=${clientId}`;
  const conversations = await db.$queryRaw<{id: string; externalId: string | null; archivedAt: Date | null}[]>`SELECT "id","externalId","archivedAt" FROM "Conversation"
    WHERE "clientId"=${clientId} AND "channel"='INSTAGRAM' ORDER BY "id" LIMIT 2`;
  const conversation = conversations[0];
  if (!client || client.archivedAt || client.status === 'BLOCKED' || !/^[1-9][0-9]{0,39}$/.test(client.instagram ?? '') ||
    conversations.length !== 1 || !conversation || conversation.archivedAt || !/^[1-9][0-9]{0,39}:[1-9][0-9]{0,39}$/.test(conversation.externalId ?? '')) throw conflict();
  const [accountId, customerId] = conversation.externalId!.split(':') as [string, string];
  const settings = await db.$queryRaw<{key: string; value: unknown}[]>`SELECT "key","value" FROM "AppSetting"
    WHERE "section"='integration.meta' AND "key" IN ('instagramAccountId','instagramWebhookReceiverId')`;
  if (customerId !== client.instagram || !metaWebhookReceiverMatches('INSTAGRAM', accountId, Object.fromEntries(settings.map(row => [row.key, row.value])))) throw conflict();
  return {clientId, conversationId: conversation.id, accountId, customerId, targetDigest: historyDigest(targets)};
}

function counts(plan: HistoryPlan): OperationalPreparedContext['preview'] {
  return {discovered: plan.discovered, newCandidates: plan.newCandidates, alreadyExists: plan.alreadyExists,
    review: plan.review, conflicts: plan.conflicts, blockers: [...plan.blockers], sourceCompleteness: plan.sourceCompleteness};
}

function requirePreparationReady(plan: HistoryPlan): void {
  if (!(plan.discovered > 0 && plan.newCandidates > 0) || plan.blockers.length || plan.review !== 0 || plan.conflicts !== 0)
    throw new ConflictException('План импорта не готов к резервному копированию (HISTORY_OPERATIONAL_PLAN_NOT_READY)');
}

/** Fresh executor per request; transaction-keyed state is never shared by callers. */
class OperationalExecutor extends HistoryMigrationTransactionEngine {
  protected readonly executionMode = 'OPERATIONAL_NATIVE' as const;
  private readonly scopes = new WeakMap<MigrationTransaction, Scope>();
  private readonly contexts = new WeakMap<HistoryPlan, OperationalBackupGrantContext>();
  private readonly candidateSnapshot = candidate();
  constructor(private readonly repository: HistoryMigrationRepository, private readonly operationalBackups: BackupService,
    private readonly request: {grantId?: string; preparation?: {archive: KeycrmArchiveApproval; passwordHash: string}} = {}) { super(operationalBackups); }

  protected withJob<T>(jobId: string, action: (tx: MigrationTransaction) => Promise<T>): Promise<T> {
    let locked: Scope | undefined;
    return this.repository.withJob(jobId, async tx => {
      enabled();
      if (!locked || tx.job.source !== 'KEYCRM' || tx.job.channel !== 'INSTAGRAM' || tx.job.status !== 'STAGING') throw conflict();
      const current = await readScope(tx.db, jobId);
      if (historyDigest(current) !== historyDigest(locked)) throw new ConflictException('Сопоставление или область переписки изменились во время блокировки');
      this.scopes.set(tx, current);
      try {
        const result = await action(tx);
        if (this.request.preparation) {
          const plan = result as HistoryPlan, context = this.contexts.get(plan);
          if (!context) throw new ConflictException('Не подтверждён контекст подготовки');
          requirePreparationReady(plan);
          await saveOperationalPreparation(tx, this.request.preparation.archive, context, this.request.preparation.passwordHash);
        }
        return result;
      } finally { this.scopes.delete(tx); }
    }, async db => {
      enabled();
      const [row] = await db.$queryRaw<{version: string}[]>`SELECT pg_catalog.version() AS version`;
      if (!row || !/^PostgreSQL \d+\./.test(row.version) || /PGlite|wasm/i.test(row.version))
        throw new ForbiddenException('Операционный перенос разрешён только в нативном PostgreSQL');
      await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'history-runtime-deployment'},0))`;
      await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'client-merge-global'},0))`;
      const initial = await readScope(db, jobId);
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'client-merge:' + initial.clientId},0))`;
      locked = await readScope(db, jobId);
      if (historyDigest(initial) !== historyDigest(locked)) throw conflict();
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'history-conversation:' + locked.conversationId},0))`;
      try {
        // NOWAIT avoids a cycle with existing writers that lock Conversation
        // before Client. A busy scope aborts this transaction before job/grant use.
        const clients = await db.$queryRaw<{id: string}[]>`SELECT "id" FROM "Client" WHERE "id"=${locked.clientId} FOR SHARE NOWAIT`;
        const conversations = await db.$queryRaw<{id: string}[]>`SELECT "id" FROM "Conversation" WHERE "id"=${locked.conversationId} FOR SHARE NOWAIT`;
        if (clients.length !== 1 || conversations.length !== 1) throw conflict();
      } catch (error) {
        if ((error as {meta?: {code?: unknown}} | null)?.meta?.code === '55P03')
          throw new ConflictException('Карточка или переписка изменяется: повторите сверку (HISTORY_OPERATIONAL_SCOPE_BUSY)');
        throw error;
      }
      if (historyDigest(await readScope(db, jobId)) !== historyDigest(locked)) throw conflict();
    });
  }
  private scope(tx: MigrationTransaction) {
    const scope = this.scopes.get(tx);
    if (!scope) throw new ConflictException('Не установлены блокировки операционного переноса');
    return scope;
  }
  private async unchangedScope(tx: MigrationTransaction) {
    if (historyDigest(await readScope(tx.db, tx.job.id)) !== historyDigest(this.scope(tx)))
      throw new ConflictException('Сопоставление или область переписки изменились');
  }
  private async context(tx: MigrationTransaction, plan: HistoryPlan): Promise<OperationalBackupGrantContext> {
    if (candidate() !== this.candidateSnapshot) throw new ConflictException('Сборка CRM изменилась');
    const [identity] = await tx.db.$queryRaw<{cluster: string; databaseName: string; databaseOid: string}[]>`SELECT system_identifier::text AS "cluster",current_database() AS "databaseName",
      (SELECT oid::bigint FROM pg_database WHERE datname=current_database())::text AS "databaseOid" FROM pg_control_system()`;
    if (!identity || !/^[1-9][0-9]{0,19}$/.test(identity.cluster) || !identity.databaseName ||
      !/^[1-9][0-9]{0,9}$/.test(identity.databaseOid) || Number(identity.databaseOid) > 4294967295) throw new ConflictException('Не подтверждена идентичность рабочей базы');
    const migrations = await tx.db.$queryRaw<{migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null}[]>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name LIMIT 1001`;
    if (!migrations.length || migrations.length > 1000 ||
      migrations.some(row => !/^[a-zA-Z0-9_-]{1,200}$/.test(row.migration_name) || !/^[a-f0-9]{64}$/.test(row.checksum)))
      throw new ConflictException('Набор применённых миграций не подтверждён');
    const active = migrations.filter(row => row.rolled_back_at === null);
    const successful = new Map(active.map(row => [row.migration_name, row.checksum]));
    // A historical failed attempt is harmless only after an exact successful retry.
    if (!active.length || successful.size !== active.length || active.some(row => !row.finished_at) ||
      !active.some(row => row.migration_name === '20261101010000_history_operational_native') ||
      migrations.some(row => row.rolled_back_at !== null && (row.finished_at !== null || successful.get(row.migration_name) !== row.checksum)))
      throw new ConflictException('Набор применённых миграций не подтверждён');
    const pairs = active.map(row => [row.migration_name, row.checksum]).sort(([a], [b]) => a! < b! ? -1 : a! > b! ? 1 : 0);
    return {jobId: tx.job.id, actorId: tx.actor.id, clientId: this.scope(tx).clientId, sourceDigest: plan.sourceDigest, previewDigest: plan.previewDigest,
      candidateSnapshot: this.candidateSnapshot, targetIdentity: {...identity, databaseOid: Number(identity.databaseOid)}, migrationSetDigest: historyDigest(pairs)};
  }
  protected async buildPlan(tx: MigrationTransaction, archive?: KeycrmArchiveApproval): Promise<HistoryPlan> {
    if (!archive) throw new ConflictException('Операционный перенос требует подтверждённую группировку архива');
    const scope = this.scope(tx);
    const plan = await buildHistoryPlan(tx, archive, (history, raw) => readQualifiedNativeProjection(tx.db, history, raw));
    if (!plan.targets.length || plan.targets.some(target => target.state !== 'MATCHED' || target.clientId !== scope.clientId) ||
      plan.databaseHistories.size !== 1 || plan.databaseHistories.get('client:' + scope.clientId)?.conversations[0]?.id !== scope.conversationId) throw conflict();
    // Host context uses the same grouping refusal without a nested transaction.
    const runs = await tx.db.$queryRaw<{sourceDigest: string}[]>`SELECT "sourceDigest" FROM "HistoryMigrationPilotRun" WHERE "jobId"=${tx.job.id}`;
    if (runs.some(run => run.sourceDigest !== plan.sourceDigest)) throw new ConflictException('Интерпретация применённого архива зафиксирована');
    this.contexts.set(plan, await this.context(tx, plan));
    return plan;
  }
  async prepared(jobId: string) {
    return this.withJob(jobId, async tx => {
      const saved = await loadOperationalPreparation(tx);
      const plan = await this.buildPlan(tx, saved.approval), current = this.contexts.get(plan)!;
      requirePreparationReady(plan);
      if (historyDigest(current) !== historyDigest(saved.context)) throw new ConflictException('Контекст подготовки импорта изменился: подготовьте заново');
      return {...current, preview: counts(plan)};
    });
  }
  async prepare(jobId: string, archive: KeycrmArchiveApproval, actor: User) {
    // withJob persists preparation after inherited preview/grouping succeeds,
    // before that exact transaction commits. Read-only preparation omits it.
    const plan = await this.previewArchive(jobId, archive, actor);
    return {...this.contexts.get(plan)!, preview: counts(plan)};
  }
  protected async nativeBinding(tx: MigrationTransaction): Promise<NativeBinding> {
    const scope = this.scope(tx), existing = await new PrismaHistoryNativeStorage(tx.db).loadBinding(scope.conversationId);
    if (existing.kind !== 'NONE') throw new ConflictException('Переписка уже связана с операционным импортом');
    return {conversationId: scope.conversationId, accountId: scope.accountId, customerId: scope.customerId};
  }
  protected async beforeApply(tx: MigrationTransaction, plan: HistoryPlan, runId: string): Promise<void> {
    if (!this.request.grantId) throw new ConflictException('Требуется действующее разрешение проверенной резервной копии');
    migrationId(this.request.grantId);
    const context = await this.context(tx, plan), receipt = await this.operationalBackups.verifyOperationalGrant(this.request.grantId, context, tx.db);
    if (!/^[a-f0-9]{64}$/.test(receipt.digest)) throw new ConflictException('Не подтверждено разрешение резервной копии');
    await this.unchangedScope(tx);
    await tx.audit('HISTORY_OPERATIONAL_BACKUP_GRANT_USED', {grantId: this.request.grantId, digest: receipt.digest, runId,
      clientId: context.clientId, sourceDigest: context.sourceDigest, previewDigest: context.previewDigest, candidateSnapshot: context.candidateSnapshot});
    const scope = this.scope(tx), start = new Date(Math.min(...plan.raw.map(raw => Date.parse(normalizeMessage(raw).time.utc!)))).toISOString();
    const window: HistoryNativeWindow = {version: 1, runId, conversationId: scope.conversationId, channel: 'INSTAGRAM', accountId: scope.accountId,
      customerId: scope.customerId, status: 'APPLIED', archiveStartAt: start, cutoffAt: archiveCutoffExclusive(plan.raw)};
    const encrypted = sealHistoryEvidence('NATIVE_WINDOW', `${runId}:${scope.conversationId}`, window);
    await tx.db.$executeRaw`INSERT INTO "HistoryMigrationNativeWindow" ("runId","payloadEncrypted") VALUES (${runId},${encrypted})`;
  }
  private async verifyWindow(tx: MigrationTransaction, run: PilotRun, plan?: HistoryPlan) {
    enabled(); await this.unchangedScope(tx);
    const scope = this.scope(tx), storage = new PrismaHistoryNativeStorage(tx.db), binding = await storage.loadBinding(scope.conversationId);
    if (binding.kind !== 'PROTECTED' || binding.runId !== run.id || binding.accountId !== scope.accountId || binding.customerId !== scope.customerId ||
      run.environment !== 'OPERATIONAL_NATIVE' || run.nativeConversationId !== scope.conversationId || run.nativeAccountId !== scope.accountId || run.nativeCustomerId !== scope.customerId)
      throw new ConflictException('Нарушена долговечная привязка операционного импорта');
    const value = await storage.loadWindow(binding);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConflictException('Не подтверждено окно операционного импорта');
    const window = value as HistoryNativeWindow;
    const keys = ['version','runId','conversationId','channel','accountId','customerId','status','archiveStartAt','cutoffAt'].sort();
    const instant = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
    if (Object.keys(window).sort().join(',') !== keys.join(',') || window.version !== 1 || window.runId !== run.id || window.conversationId !== scope.conversationId ||
      window.channel !== 'INSTAGRAM' || window.accountId !== scope.accountId || window.customerId !== scope.customerId ||
      !['APPLIED','ROLLED_BACK'].includes(window.status) || run.status === 'APPLIED' && window.status !== 'APPLIED' ||
      !instant(window.archiveStartAt) || !instant(window.cutoffAt) || Date.parse(window.archiveStartAt) >= Date.parse(window.cutoffAt) || !window.cutoffAt.endsWith(':00.000Z'))
      throw new ConflictException('Не подтверждено окно операционного импорта');
    if (plan && (window.cutoffAt !== archiveCutoffExclusive(plan.raw) || window.archiveStartAt !== new Date(Math.min(...plan.raw.map(raw => Date.parse(normalizeMessage(raw).time.utc!)))).toISOString()))
      throw new ConflictException('Диапазон исходного архива изменился');
  }
  protected async beforeReplay(tx: MigrationTransaction, plan: HistoryPlan, run: PilotRun) { await this.verifyWindow(tx, run, plan); }
  protected async beforeRollback(tx: MigrationTransaction, run: PilotRun) { await this.verifyWindow(tx, run); }
}

/** Feature-gated application executor. No URL, database factory, caller guard,
 * client merge or provider send can be supplied by a request. */
@Injectable()
export class HistoryOperationalService {
  constructor(private readonly repository: HistoryMigrationRepository, private readonly backups: BackupService) {}
  /** Internal plan contains staged bodies; HTTP consumers must use prepareContext. */
  async previewArchive(jobId: string, archive: KeycrmArchiveApproval, actor: User) {
    enabled();
    return new OperationalExecutor(this.repository, this.backups).previewArchive(jobId, validateKeycrmArchiveApproval(archive), {...actor});
  }
  async prepareContext(jobId: string, archive: KeycrmArchiveApproval, actor: User): Promise<OperationalPreparedContext> {
    enabled();
    return new OperationalExecutor(this.repository, this.backups).prepare(jobId, validateKeycrmArchiveApproval(archive), {...actor});
  }
  async prepare(jobId: string, archive: KeycrmArchiveApproval, password: string, actor: User): Promise<OperationalPreparedContext> {
    enabled();
    const checked = validateKeycrmArchiveApproval(archive), user = {...actor}, verified = await this.backups.reauthenticate(user, password);
    return new OperationalExecutor(this.repository, this.backups, {preparation: {archive: checked, passwordHash: verified.passwordHash}}).prepare(jobId, checked, user);
  }
  async preparedContext(jobId: string): Promise<OperationalPreparedContext> {
    enabled(); migrationId(jobId);
    return new OperationalExecutor(this.repository, this.backups).prepared(jobId);
  }
  async applyArchive(jobId: string, digest: string, archive: KeycrmArchiveApproval, password: string, actor: User, grantId?: string) {
    enabled(); if (grantId !== undefined) migrationId(grantId);
    return new OperationalExecutor(this.repository, this.backups, {grantId}).applyArchive(jobId, digest, validateKeycrmArchiveApproval(archive), password, {...actor});
  }
  async rollback(jobId: string, runId: string, password: string, actor: User) {
    enabled();
    return new OperationalExecutor(this.repository, this.backups).rollback(jobId, runId, password, {...actor});
  }
}
