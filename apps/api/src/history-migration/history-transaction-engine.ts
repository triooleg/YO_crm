import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { BackupService } from '../backups/backup.service';
import { softDeleteMetadata } from '../communications/message-deletion';
import { normalizeMessage, sourceKey, keycrmArchiveEligible, keycrmArchiveMetadata, validateKeycrmArchiveApproval, type KeycrmArchiveApproval } from './history';
import { buildHistoryPlan, type IdentityEvidence } from './history-plan';
import { openHistoryEvidence, sealHistoryEvidence } from './history-evidence';
import { type MigrationTransaction } from './history-migration.repository';
import { migrationId, sha256 } from './intake-rules';
import { captureIsolatedHistoryState, type PilotRecordIds } from './isolated-history-state';
import type { OriginEvidence } from './history-planning.repository';
import { subjectIdentityKey } from './history-targets';

export type HistoryExecutionMode = 'ISOLATED_WASM' | 'OPERATIONAL_NATIVE';
export type NativeBinding = { conversationId: string; accountId: string; customerId: string };
export type HistoryPlan = Awaited<ReturnType<typeof buildHistoryPlan>>;
export type PilotResult = { runId: string; added: number; alreadyExists: number; createdClients: number; replayed: boolean; productionImport: boolean };
export type PilotRun = { id: string; jobId: string; actorId: string; environment: HistoryExecutionMode; nativeConversationId?: string | null; nativeAccountId?: string | null; nativeCustomerId?: string | null; sourceDigest: string; previewDigest: string; status: string; snapshotEncrypted: string; result: PilotResult };
export type PilotSnapshot = PilotRecordIds & { runId: string; jobId: string; sourceDigest: string; previewDigest: string; stateDigest: string };

/** Internal transaction algorithm, deliberately not a Nest provider or controller.
 * A concrete executor must validate its owned database and serialize all relevant
 * writers BEFORE loading/locking the job. This module grants no native target.
 * The existing public pilot supplies its mandatory WASM-only executor.
 */
export abstract class HistoryMigrationTransactionEngine {
  constructor(private readonly backups: BackupService) {}
  protected readonly executionMode: HistoryExecutionMode = 'ISOLATED_WASM';
  protected abstract withJob<T>(jobId: string, action: (tx: MigrationTransaction) => Promise<T>): Promise<T>;
  protected buildPlan(tx: MigrationTransaction, archive?: KeycrmArchiveApproval): Promise<HistoryPlan> {
    return buildHistoryPlan(tx, archive);
  }
  /** The executor validates and installs its run evidence in this transaction,
   * after the run exists and before any client/conversation/message writes. */
  protected async beforeApply(_tx: MigrationTransaction, _plan: HistoryPlan, _runId: string): Promise<void> {}
  protected async nativeBinding(_tx: MigrationTransaction, _plan: HistoryPlan): Promise<NativeBinding | null> { return null; }
  /** Read-only integrity checks; replay never reinstalls missing run evidence. */
  protected async beforeReplay(_tx: MigrationTransaction, _plan: HistoryPlan, _run: PilotRun): Promise<void> {}
  protected async beforeRollback(_tx: MigrationTransaction, _run: PilotRun): Promise<void> {}
  private checkRunEnvironment(run: PilotRun) {
    if (run.environment !== this.executionMode) throw new ForbiddenException('Среда выполнения импорта не соответствует исполнителю');
  }
  private check(tx: MigrationTransaction, actor: User, passwordHash: string) {
    if (actor?.id !== tx.job.createdById || actor.role !== 'OWNER' || tx.actor.passwordHash !== passwordHash) throw new ForbiddenException('Повторите подтверждение владельца');
    if (tx.job.status !== 'STAGING') throw new ConflictException('Задание закрыто');
  }
  private snapshot(run: PilotRun) {
    const snapshot = openHistoryEvidence<PilotSnapshot>('PILOT_SNAPSHOT', run.id, run.snapshotEncrypted);
    if (snapshot.runId !== run.id || snapshot.jobId !== run.jobId || snapshot.sourceDigest !== run.sourceDigest || snapshot.previewDigest !== run.previewDigest) throw new ConflictException('Неверная привязка контрольной точки');
    if (snapshot.custodyVersion !== undefined && snapshot.custodyVersion !== 2) throw new ConflictException('Неизвестная версия контрольной точки');
    const lists = [snapshot.createdMessageIds, snapshot.createdClientIds, snapshot.createdConversationIds, snapshot.allConversationIds];
    if (snapshot.custodyVersion === 2) lists.push(snapshot.createdIdentityIds!);
    if (!/^[a-f0-9]{64}$/.test(snapshot.stateDigest) || lists.some(ids => !Array.isArray(ids) || ids.length > 10000 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id || id.length > 256)) || snapshot.createdConversationIds.some(id => !snapshot.allConversationIds.includes(id)) || (snapshot.createdMessageIds.length > 0 && !snapshot.allConversationIds.length)) throw new ConflictException('Некорректные записи контрольной точки');
    return snapshot;
  }
  private async archiveGrouping(tx:MigrationTransaction,sourceDigest:string){
    const runs=await tx.db.$queryRaw<{sourceDigest:string}[]>`SELECT "sourceDigest" FROM "HistoryMigrationPilotRun" WHERE "jobId"=${tx.job.id}`;
    if(runs.some(run=>run.sourceDigest!==sourceDigest))throw new ConflictException('Интерпретация применённого архива зафиксирована: новые данные требуют отдельного задания');
  }
  async apply(jobId: string, approvedDigest: string, password: string, actor: User): Promise<PilotResult> {
    return this.applyMode(jobId,approvedDigest,password,actor);
  }
  async previewArchive(jobId:string,approval:KeycrmArchiveApproval,actor:User){
    migrationId(jobId);const archive=validateKeycrmArchiveApproval(approval);
    return this.withJob(jobId,async tx=>{this.check(tx,actor,tx.actor.passwordHash);const plan=await this.buildPlan(tx,archive);await this.archiveGrouping(tx,plan.sourceDigest);return plan;});
  }
  async applyArchive(jobId:string,approvedDigest:string,approval:KeycrmArchiveApproval,password:string,actor:User){
    return this.applyMode(jobId,approvedDigest,password,actor,validateKeycrmArchiveApproval(approval));
  }
  private async applyMode(jobId: string, approvedDigest: string, password: string, actor: User, archive?:KeycrmArchiveApproval): Promise<PilotResult> {
    migrationId(jobId);
    if (!/^[a-f0-9]{64}$/.test(approvedDigest)) throw new ConflictException('Требуется подтверждённый предпросмотр');
    const verified = await this.backups.reauthenticate(actor, password);
    return this.withJob(jobId, async tx => {
      this.check(tx, actor, verified.passwordHash);
      await tx.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'history-isolated-pilot'},0))`;
      const plan = await this.buildPlan(tx,archive);
      if(archive)await this.archiveGrouping(tx,plan.sourceDigest);
      const [previous] = await tx.db.$queryRaw<PilotRun[]>`SELECT * FROM "HistoryMigrationPilotRun" WHERE "jobId"=${jobId} AND "sourceDigest"=${plan.sourceDigest}`;
      if (previous) {
        this.checkRunEnvironment(previous);
        if (previous.status !== 'APPLIED') throw new ConflictException('Импорт отозван: повторное создание запрещено');
        const previousSnapshot = this.snapshot(previous);
        const exactOwnedReplay = previousSnapshot.custodyVersion === 2 && plan.actions.length > 0 && plan.newCandidates === 0 && plan.review === 0 && plan.conflicts === 0 &&
          plan.actions.every(action => action.kind === 'EXACT_DUPLICATE' && (!action.message.attachments.length||!!archive&&keycrmArchiveEligible(action.message)) && !action.attachmentAdditions.length) &&
          plan.blockers.every(blocker => blocker === 'UNVERIFIED_EXISTING_PROVENANCE');
        if ((previousSnapshot.custodyVersion === 2 ? !exactOwnedReplay : plan.blockers.length > 0) || plan.review || plan.conflicts) throw new ConflictException('Сначала устраните замечания: состояние истории изменилось');
        if (await captureIsolatedHistoryState(tx.db, previousSnapshot) !== previousSnapshot.stateDigest) throw new ConflictException('Состояние изменилось или появились зависимости: повторное подтверждение запрещено');
        if (approvedDigest !== previous.previewDigest && approvedDigest !== plan.previewDigest) throw new ConflictException('Предпросмотр изменился');
        await this.beforeReplay(tx, plan, previous);
        return { ...previous.result, added: 0, alreadyExists: plan.alreadyExists, createdClients: 0, replayed: true, productionImport: this.executionMode === 'OPERATIONAL_NATIVE' };
      }
      if (approvedDigest !== plan.previewDigest) throw new ConflictException('Предпросмотр изменился: повторите сверку');
      if (plan.blockers.length || plan.review || plan.conflicts || !plan.discovered) throw new ConflictException('Сначала устраните замечания сопоставления и сообщений');
      const runId = randomUUID(), result: PilotResult = { runId, added: 0, alreadyExists: plan.alreadyExists, createdClients: 0, replayed: false, productionImport: this.executionMode === 'OPERATIONAL_NATIVE' };
      const ids: PilotRecordIds = { custodyVersion: 2, createdIdentityIds: [], createdMessageIds: [], createdClientIds: [], createdConversationIds: [], allConversationIds: [] };
      const nativeBinding = await this.nativeBinding(tx, plan);
      // Default WASM execution also works with its original schema, which has
      // no operational binding columns. Native CHECK constraints require all
      // three identifiers on INSERT, independently of later window evidence.
      const nativeColumn = nativeBinding === null ? Prisma.empty : Prisma.sql`,"nativeConversationId","nativeAccountId","nativeCustomerId"`;
      const nativeValue = nativeBinding === null ? Prisma.empty : Prisma.sql`,${nativeBinding.conversationId},${nativeBinding.accountId},${nativeBinding.customerId}`;
      await tx.db.$executeRaw(Prisma.sql`INSERT INTO "HistoryMigrationPilotRun" ("id","jobId","actorId","environment"${nativeColumn},"sourceDigest","previewDigest","result","snapshotEncrypted")
        VALUES (${runId},${jobId},${actor.id},${this.executionMode}${nativeValue},${plan.sourceDigest},${plan.previewDigest},${JSON.stringify(result)}::jsonb,${sealHistoryEvidence('PILOT_SNAPSHOT', runId, { state: 'PENDING' })})`);
      await this.beforeApply(tx, plan, runId);
      const clients = new Map<string, string>(), conversations = new Map<string, string>();
      const uniqueTargets = new Map(plan.targets.filter(t => t.state !== 'REVIEW').map(t => [t.groupKey, t]));
      for (const [groupKey, target] of uniqueTargets) {
        let clientId = target.clientId;
        const messages = plan.actions.filter(action => action.groupKey === groupKey).map(action => action.message);
        if (!messages.length) continue;
        if (!clientId) {
          if (target.state !== 'CREATE_PROPOSAL' || !target.subjectId || !target.displayName) throw new ConflictException('Не подтверждено создание клиента');
          clientId = randomUUID();
          const first = new Date(Math.min(...messages.map(message => Date.parse(message.time.utc!))));
          await tx.db.$executeRaw`INSERT INTO "Client" ("id","firstName","displayName","source","status","firstContactAt","updatedAt")
            VALUES (${clientId},${target.displayName},${target.displayName},${tx.job.channel}::"ContactChannel",'LEAD'::"ClientStatus",${first.toISOString()}::timestamp(3),CURRENT_TIMESTAMP)`;
          ids.createdClientIds.push(clientId); result.createdClients++;
        }
        clients.set(groupKey, clientId);
        const subjects = [...new Set(plan.targets.filter(row => row.groupKey === groupKey && row.state !== 'REVIEW').map(row => row.subjectId).filter((id): id is string => Boolean(id)))];
        for (const subjectId of subjects) {
          const identityId = subjectIdentityKey(tx.job, subjectId);
          const [known] = await tx.db.$queryRaw<{ clientId: string }[]>`SELECT "clientId" FROM "HistoryMigrationIdentity" WHERE "id"=${identityId}`;
          if (known && known.clientId !== clientId) throw new ConflictException('Идентичность уже занята другим клиентом');
          if (!known) {
            const evidence: IdentityEvidence = { runId, clientId, source: tx.job.source, account: tx.job.account, channel: tx.job.channel, subjectId };
            await tx.db.$executeRaw`INSERT INTO "HistoryMigrationIdentity" ("id","runId","clientId","payloadEncrypted") VALUES
              (${identityId},${runId},${clientId},${sealHistoryEvidence('IDENTITY', identityId, evidence)})`;
            ids.createdIdentityIds!.push(identityId);
          }
        }
        const existing = plan.databaseHistories.get(groupKey)?.conversations[0];
        if (existing) conversations.set(groupKey, existing.id);
        else {
          const id = randomUUID(), first = new Date(Math.min(...messages.map(message => Date.parse(message.time.utc!)))),
            last = new Date(Math.max(...messages.map(message => Date.parse(message.time.utc!))));
          await tx.db.$executeRaw`INSERT INTO "Conversation" ("id","clientId","channel","lastMessageAt","createdAt","updatedAt")
            VALUES (${id},${clientId},${tx.job.channel}::"ContactChannel",${last.toISOString()}::timestamp(3),${first.toISOString()}::timestamp(3),CURRENT_TIMESTAMP)`;
          ids.createdConversationIds.push(id); conversations.set(groupKey, id);
        }
      }
      ids.allConversationIds = [...new Set(conversations.values())].sort();
      const rawBySource = new Map<string, unknown[]>();
      for (const raw of plan.raw) {
        const key = sourceKey(normalizeMessage(raw)); rawBySource.set(key, [...(rawBySource.get(key) ?? []), raw]);
      }
      for (const action of plan.actions) {
        if (action.kind !== 'NEW') continue;
        const message = action.message;
        if (!message.time.utc || (archive?!action.sourceMessages.every(keycrmArchiveEligible):message.time.precision !== 'SECOND' || message.attachments.length)) throw new ConflictException('Пилот принимает только подтверждённые исходные данные');
        const id = randomUUID(), time = new Date(message.time.utc), conversationId = conversations.get(action.groupKey);
        if (!conversationId || !clients.get(action.groupKey)) throw new ConflictException('Не подтверждена история клиента');
        const metadata = { provider: 'YO_HISTORY_PILOT', historyMigration: { runId, source: tx.job.source, account: tx.job.account, dialogueId: message.dialogueId, sourceMessageId: message.sourceMessageId },...(archive?{historyArchive:keycrmArchiveMetadata(action.sourceMessages)}:{}) };
        await tx.db.$executeRaw`INSERT INTO "Message" ("id","conversationId","direction","status","content","normalizedText","metadata","sentAt","receivedAt","createdAt")
          VALUES (${id},${conversationId},${message.direction}::"MessageDirection",${message.direction === 'OUTBOUND' ? 'SENT' : 'RECEIVED'}::"MessageStatus",${message.text},${message.normalizedText},${JSON.stringify(metadata)}::jsonb,
          ${message.direction === 'OUTBOUND' ? time.toISOString() : null}::timestamp(3),${message.direction === 'INBOUND' ? time.toISOString() : null}::timestamp(3),${time.toISOString()}::timestamp(3))`;
        ids.createdMessageIds.push(id); result.added++;
        for (const alias of action.aliases) {
          const key = sha256(alias), variants = rawBySource.get(alias) ?? [];
          const expectedVariant=action.sourceMessages.find(m=>sourceKey(m)===alias);
          const raw = archive?variants.find(raw=>{const m=normalizeMessage(raw);return m.text===expectedVariant?.text&&m.ordinal===expectedVariant.ordinal;}):variants.find(raw => normalizeMessage(raw).text === message.text) ?? variants[0];
          if (!raw) throw new ConflictException('Отсутствует исходное сообщение');
          const evidence: OriginEvidence = { runId, messageId: id, raw,...(archive?{archivePolicy:archive.policy}:{}) };
          await tx.db.$executeRaw`INSERT INTO "HistoryMigrationOrigin" ("id","runId","messageId","payloadEncrypted","createdMessage")
            VALUES (${key},${runId},${id},${sealHistoryEvidence('ORIGIN', key, evidence)},true)`;
        }
      }
      const snapshot: PilotSnapshot = { ...ids, runId, jobId, sourceDigest: plan.sourceDigest, previewDigest: plan.previewDigest,
        stateDigest: await captureIsolatedHistoryState(tx.db, ids) };
      await tx.db.$executeRaw`UPDATE "HistoryMigrationPilotRun" SET "result"=${JSON.stringify(result)}::jsonb,"snapshotEncrypted"=${sealHistoryEvidence('PILOT_SNAPSHOT', runId, snapshot)} WHERE "id"=${runId}`;
      await tx.audit(this.executionMode === 'OPERATIONAL_NATIVE' ? 'HISTORY_OPERATIONAL_NATIVE_APPLIED' : 'HISTORY_ISOLATED_PILOT_APPLIED', { runId, sourceDigest: plan.sourceDigest, previewDigest: plan.previewDigest, added: result.added, createdClients: result.createdClients });
      return result;
    });
  }
  async rollback(jobId: string, runId: string, password: string, actor: User) {
    migrationId(jobId); migrationId(runId); const verified = await this.backups.reauthenticate(actor, password);
    return this.withJob(jobId, async tx => {
       this.check(tx, actor, verified.passwordHash);
      await tx.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'history-isolated-pilot'},0))`;
      const [run] = await tx.db.$queryRaw<PilotRun[]>`SELECT * FROM "HistoryMigrationPilotRun" WHERE "id"=${runId} AND "jobId"=${jobId} FOR UPDATE`;
      if (!run) throw new ConflictException('Пилот не найден');
      this.checkRunEnvironment(run);
      await this.beforeRollback(tx, run);
      if (run.status === 'ROLLED_BACK') return { runId, rolledBack: true, replayed: true, productionImport: this.executionMode === 'OPERATIONAL_NATIVE' };
      const snapshot = this.snapshot(run);
      if (await captureIsolatedHistoryState(tx.db, snapshot) !== snapshot.stateDigest) throw new ConflictException('Состояние изменилось или появились зависимости: откат запрещён');
      for (const id of snapshot.createdMessageIds) {
        const [message] = await tx.db.$queryRaw<{ metadata: unknown }[]>`SELECT "metadata" FROM "Message" WHERE "id"=${id} FOR UPDATE`;
        if (!message) throw new ConflictException('Изменилось сообщение пилота');
        const metadata = softDeleteMetadata(message.metadata, { actorId: actor.id, deletedAt: new Date(), mode: 'CRM' });
        await tx.db.$executeRaw`UPDATE "Message" SET "metadata"=${JSON.stringify(metadata)}::jsonb WHERE "id"=${id}`;
      }
      for (const id of snapshot.createdConversationIds) await tx.db.$executeRaw`UPDATE "Conversation" SET "archivedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${id}`;
      for (const id of snapshot.createdClientIds) await tx.db.$executeRaw`UPDATE "Client" SET "archivedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${id}`;
      await tx.db.$executeRaw`UPDATE "HistoryMigrationPilotRun" SET "status"='ROLLED_BACK',"rolledBackAt"=CURRENT_TIMESTAMP WHERE "id"=${runId}`;
      await tx.audit(this.executionMode === 'OPERATIONAL_NATIVE' ? 'HISTORY_OPERATIONAL_NATIVE_ROLLED_BACK' : 'HISTORY_ISOLATED_PILOT_ROLLED_BACK', { runId, hiddenMessages: snapshot.createdMessageIds.length, archivedClients: snapshot.createdClientIds.length });
      return { runId, rolledBack: true, replayed: false, productionImport: this.executionMode === 'OPERATIONAL_NATIVE' };
    });
  }
}
