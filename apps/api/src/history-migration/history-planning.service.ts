import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { BackupService } from '../backups/backup.service';
import { HistoryMigrationRepository, type MigrationTransaction } from './history-migration.repository';
import { migrationId } from './intake-rules';
import { buildHistoryPlan, loadHistorySources, resolveSubjectIdentity } from './history-plan';
import { HistoryPlanningRepository } from './history-planning.repository';
import { matchCanonicalTargets, validateTargetRequest, type TargetRequest } from './history-targets';
import { normalizeMessage } from './history';

@Injectable()
export class HistoryMigrationPlanningService {
  constructor(private readonly repository: HistoryMigrationRepository, private readonly backups: BackupService) {}
  private enabled(id: string) {
    if (process.env.HISTORY_MIGRATION_ENABLED !== 'true' || process.env.HISTORY_MIGRATION_PLANNING_ENABLED !== 'true') throw new NotFoundException('Сверка истории не включена');
    try { migrationId(id); } catch { throw new BadRequestException('Некорректное задание'); }
  }
  private owner(tx: MigrationTransaction, actor: User, passwordHash?: string) {
    if (actor?.id !== tx.job.createdById || actor.role !== 'OWNER') throw new ForbiddenException('Задание другого владельца');
    if (passwordHash !== undefined && tx.actor.passwordHash !== passwordHash) throw new ForbiddenException('Пароль изменился: повторите подтверждение');
  }
  async resolve(id: string, input: { dialogueId: string; email?: string; phone?: string }, actor: User) {
    this.enabled(id);
    return this.repository.withJob(id, async tx => {
      this.owner(tx, actor); const repository = new HistoryPlanningRepository(tx); await repository.mergeReadLock();
      const { raw } = await loadHistorySources(tx);
      if (!raw.some(row => normalizeMessage(row).dialogueId === input.dialogueId)) throw new BadRequestException('Исходный диалог отсутствует в задании');
      const { clients, redirects } = await repository.candidates(input.email, input.phone);
      const match = matchCanonicalTargets(input, clients, redirects);
      return { ...match, candidates: match.candidates.map(clientId => ({ clientId, displayName: clients.find(row => row.id === clientId)?.displayName ?? '',
        archived: Boolean(clients.find(row => row.id === clientId)?.archivedAt) })), persisted: false, importEnabled: false };
    });
  }
  async bind(id: string, input: unknown, password: string, actor: User) {
    this.enabled(id); const verified = await this.backups.reauthenticate(actor, password);
    let request: TargetRequest; try { request = validateTargetRequest(input); } catch { throw new BadRequestException('Некорректное сопоставление'); }
    return this.repository.withJob(id, async tx => {
      this.owner(tx, actor, verified.passwordHash);
      if (tx.job.status !== 'STAGING') throw new ConflictException('Задание закрыто');
      const repository = new HistoryPlanningRepository(tx); await repository.mergeReadLock();
      const { raw } = await loadHistorySources(tx);
      if (!raw.some(row => normalizeMessage(row).dialogueId === request.dialogueId)) throw new BadRequestException('Исходный диалог отсутствует в задании');
      if (request.mode === 'EXISTING') {
        const selected = (await repository.canonical(request.clientId!)).target;
        if (!selected) throw new ConflictException('Клиент архивирован, заблокирован или требует ручной проверки');
        request = { ...request, clientId: selected.id };
      }
      if (request.subjectId) {
        const identity = await resolveSubjectIdentity(repository, request.subjectId);
        if (identity.rejected || (identity.client && request.clientId && identity.client.id !== request.clientId)) throw new ConflictException('Идентичность требует ручной проверки');
      }
      const target = await repository.bind(request);
      return { targetId: target.id, dialogueId: target.dialogueId, revision: target.revision, mode: target.mode, clientId: target.clientId, importEnabled: false };
    });
  }
  async dryRun(id: string, actor: User) {
    this.enabled(id);
    return this.repository.withJob(id, async tx => {
      this.owner(tx, actor); const plan = await buildHistoryPlan(tx);
      return { jobId: id, previewDigest: plan.previewDigest, crmCompared: plan.crmCompared, sourceCompleteness: plan.sourceCompleteness,
        discovered: plan.discovered, newCandidates: plan.newCandidates, alreadyExists: plan.alreadyExists, review: plan.review,
        conflicts: plan.conflicts, inBatchDuplicates: plan.inBatchDuplicates, targets: plan.targets,
        blockers: plan.blockers, productionBlockers: ['BACKUP_AND_OWNER_APPROVAL_REQUIRED', 'MULTI_SESSION_WRITER_NOT_VALIDATED'],
        importEnabled: false, addedToCrm: 0, actions: plan.actions.map(a => ({ key: a.key, kind: a.kind, clientId: a.clientId,
          existingId: a.existingId ?? null, dialogueId: a.message.dialogueId, sourceMessageId: a.message.sourceMessageId, reason: a.reason })) };
    });
  }
}
