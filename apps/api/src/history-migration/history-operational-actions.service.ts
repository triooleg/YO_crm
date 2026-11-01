import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { proposeKeycrmArchiveApproval } from './history';
import { HistoryMigrationRepository, type MigrationTransaction } from './history-migration.repository';
import { HistoryPlanningRepository } from './history-planning.repository';
import { loadHistorySources } from './history-plan';
import { HistoryOperationalService } from './history-operational.service';
import { loadOperationalPreparation } from './history-operational-preparation';
import { migrationId } from './intake-rules';

const enabled = () => process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED === 'true';
function owner(tx: MigrationTransaction, actor: User) {
  if (!actor || actor.role !== 'OWNER' || actor.id !== tx.actor.id || actor.id !== tx.job.createdById) throw new ForbiddenException('Задание другого владельца');
}
type PublishedGrant = {version: 1; grantId: string; sourceDigest: string; previewDigest: string; ciphertextDigest: string; expiresAt: string};
function publication(value: unknown, context: {sourceDigest: string; previewDigest: string}): PublishedGrant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as PublishedGrant;
  if (Object.keys(row).sort().join(',') !== 'ciphertextDigest,expiresAt,grantId,previewDigest,sourceDigest,version' || row.version !== 1 ||
    row.sourceDigest !== context.sourceDigest || row.previewDigest !== context.previewDigest || typeof row.ciphertextDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.ciphertextDigest) ||
    typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.now()) return null;
  try { migrationId(row.grantId); } catch { return null; }
  return row;
}

/** Owner-facing commands never accept source aliases, provenance flags, DB
 * context or grant IDs. Publication metadata is only UI/routing state: apply
 * independently authenticates the host file and verifies physical artifacts.
 */
@Injectable()
export class HistoryOperationalActionsService {
  constructor(private readonly repository: HistoryMigrationRepository, private readonly operational: HistoryOperationalService) {}
  private async proposal(jobId: string, actor: User) {
    if (!enabled()) throw new NotFoundException('Операционный перенос истории не включён');
    migrationId(jobId);
    return this.repository.withJob(jobId, async tx => {
      owner(tx, actor);
      if (tx.job.status !== 'STAGING' || tx.job.source !== 'KEYCRM' || tx.job.channel !== 'INSTAGRAM') throw new ConflictException('Задание не готово к переносу');
      const repository = new HistoryPlanningRepository(tx); await repository.mergeReadLock();
      const {raw} = await loadHistorySources(tx), rows = await repository.targets(), clients = new Map<string,string>();
      for (const row of rows) {
        if (row.archivedAt || row.mode !== 'EXISTING') throw new ConflictException('Подтвердите существующего клиента для всех диалогов');
        const evidence = repository.evidence(row), client = (await repository.canonical(evidence.clientId!)).target;
        if (!client) throw new ConflictException('Клиент требует дополнительной проверки');
        clients.set(row.dialogueId, client.id);
      }
      if (new Set(clients.values()).size !== 1) throw new ConflictException('Для пилота требуется один подтверждённый клиент');
      return proposeKeycrmArchiveApproval(raw, clients);
    });
  }
  async preview(jobId: string, actor: User) {
    const approval = await this.proposal(jobId, actor);
    return {...await this.operational.prepareContext(jobId, approval, actor), equivalenceCount: approval.equivalences.length};
  }
  async prepare(jobId: string, password: string, actor: User) {
    const approval = await this.proposal(jobId, actor);
    return {...await this.operational.prepare(jobId, approval, password, actor), equivalenceCount: approval.equivalences.length};
  }
  async status(jobId: string, actor: User) {
    const empty = {enabled: enabled(), prepared: false, expiresAt: null as string | null, grantReady: false, previewDigest: null as string | null};
    if (!enabled()) return {...empty, run: null};
    migrationId(jobId);
    return this.repository.withJob(jobId, async tx => {
      owner(tx, actor);
      const [run] = await tx.db.$queryRaw<{id: string; status: string; result: {added?: unknown}}[]>`SELECT "id","status","result" FROM "HistoryMigrationPilotRun"
        WHERE "jobId"=${jobId} AND "environment"='OPERATIONAL_NATIVE' ORDER BY "createdAt" DESC,"id" DESC LIMIT 1`;
      if (run && (!['APPLIED','ROLLED_BACK'].includes(run.status) || !Number.isSafeInteger(run.result?.added) || Number(run.result.added) < 0)) throw new ConflictException('Не подтверждено состояние импорта');
      const state = {...empty, run: run ? {runId: run.id, status: run.status, added: Number(run.result.added)} : null};
      if (run) return state;
      const stored = await tx.db.appSetting.findUnique({where: {section_key: {section: 'history.operational.preparation', key: jobId}}});
      if (!stored) return state;
      let preparation;
      try { preparation = await loadOperationalPreparation(tx); }
      catch (error) { if (error instanceof ConflictException || error instanceof ForbiddenException) return state; throw error; }
      const row = await tx.db.appSetting.findUnique({where: {section_key: {section: 'history.operational.grant', key: jobId}}});
      return {...state, prepared: true, expiresAt: preparation.expiresAt, previewDigest: preparation.context.previewDigest,
        grantReady: publication(row?.value, preparation.context) !== null};
    });
  }
  async apply(jobId: string, digest: string, password: string, actor: User) {
    const approval = await this.proposal(jobId, actor);
    const grantId = await this.repository.withJob(jobId, async tx => {
      owner(tx, actor);
      const [run] = await tx.db.$queryRaw<{id: string}[]>`SELECT "id" FROM "HistoryMigrationPilotRun" WHERE "jobId"=${jobId} AND "environment"='OPERATIONAL_NATIVE' LIMIT 1`;
      // An existing run must pass the engine's exact replay/rollback checks;
      // it never needs another grant or a refreshed preparation timestamp.
      if (run) return undefined;
      const preparation = await loadOperationalPreparation(tx);
      if (digest !== preparation.context.previewDigest) throw new ConflictException('Предпросмотр изменился: подготовьте перенос заново');
      const row = await tx.db.appSetting.findUnique({where: {section_key: {section: 'history.operational.grant', key: jobId}}});
      const saved = publication(row?.value, preparation.context);
      if (!saved) throw new ConflictException('Ожидается проверенная резервная копия');
      return saved.grantId;
    });
    return this.operational.applyArchive(jobId, digest, approval, password, actor, grantId);
  }
  rollback(jobId: string, runId: string, password: string, actor: User) { return this.operational.rollback(jobId, runId, password, actor); }
}
