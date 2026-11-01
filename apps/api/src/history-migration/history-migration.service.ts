import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BackupService } from '../backups/backup.service';
import { decryptSecret, encryptSecret } from '../secret-box';
import { normalizeMessage, planTimelineMerge } from './history';
import { loadHistorySources } from './history-plan';
import { assertHistoryJobMutationAllowed, historyOperationalJobState } from './history-planning.repository';
import { parseBackupJson } from '../backups/backup.json';
import { HistoryMigrationRepository, type MigrationJob, type MigrationTransaction, type OwnerJobMetadata, type OwnerJobCursor } from './history-migration.repository';
import { MAX_JOB_BATCHES, MAX_JOB_BYTES, migrationId, sha256, validateHistoryScope, validateIntakePacket } from './intake-rules';
import { openStagedPayload, sealStagedPayload } from './staged-payload';

function publicJob(job: OwnerJobMetadata) {
  return { jobId: job.id, status: job.status, source: job.source, channel: job.channel, account: job.account,
    batchCount: job.batchCount, messageCount: job.messageCount, payloadBytes: job.payloadBytes,
    agentRevision: job.agentRevision, agentExpiresAt: job.agentExpiresAt?.toISOString() ?? null, importEnabled: false as const };
}
const ownerJob = (job: OwnerJobMetadata) => ({ ...publicJob(job), createdAt: job.createdAt.toISOString() });

function ownerPage(input: unknown): { limit: number; cursor?: OwnerJobCursor } {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['limit', 'cursor'].includes(key))) throw new Error();
    const { limit = 50, cursor } = input as { limit?: unknown; cursor?: unknown };
    if ((typeof limit !== 'number' && (typeof limit !== 'string' || !/^[1-9][0-9]?$/.test(limit))) ||
        !Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 50) throw new Error();
    if (cursor === undefined) return { limit: Number(limit) };
    if (typeof cursor !== 'string' || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error();
    const parsed = parseBackupJson(bytes) as OwnerJobCursor;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'createdAt,id' ||
        typeof parsed.createdAt !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed.createdAt) ||
        new Date(parsed.createdAt).toISOString() !== parsed.createdAt) throw new Error();
    migrationId(parsed.id);
    return { limit: Number(limit), cursor: parsed };
  } catch { throw new BadRequestException('Некорректная страница заданий'); }
}
@Injectable()
export class HistoryMigrationService {
  constructor(private readonly repository: HistoryMigrationRepository, private readonly backups: BackupService) {}
  private enabled() { if (process.env.HISTORY_MIGRATION_ENABLED !== 'true') throw new NotFoundException('Миграция истории не включена'); }
  private id(value: unknown): asserts value is string { try { migrationId(value); } catch { throw new BadRequestException('Некорректный идентификатор'); } }
  private owner(tx: MigrationTransaction, actor: User, verifiedPasswordHash?: string) {
    if (!actor || actor.id !== tx.job.createdById || actor.role !== 'OWNER') throw new ForbiddenException('Задание другого владельца');
    if (verifiedPasswordHash !== undefined && (!verifiedPasswordHash || tx.actor.passwordHash !== verifiedPasswordHash)) throw new ForbiddenException('Пароль изменился: повторите подтверждение');
  }
  private open(job: MigrationJob) { if (job.status !== 'STAGING') throw new ConflictException('Задание закрыто'); }
  private agent(tx: MigrationTransaction, authorization: unknown) {
    this.open(tx.job);
    if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization) || !tx.job.tokenHash ||
      !/^[a-f0-9]{64}$/.test(tx.job.tokenHash) || !tx.job.agentExpiresAt || tx.job.agentExpiresAt.getTime() <= Date.now() ||
      !timingSafeEqual(Buffer.from(sha256(authorization.slice(7)), 'hex'), Buffer.from(tx.job.tokenHash, 'hex'))) throw new UnauthorizedException('Доступ агента недействителен');
  }
  async list(actor: User, input: unknown = {}) {
    this.enabled();
    if (!actor?.id || actor.role !== 'OWNER') throw new ForbiddenException('Недостаточно прав');
    const { limit, cursor } = ownerPage(input);
    const rows = await this.repository.listOwned(actor.id, limit, cursor);
    const jobs = rows.slice(0, limit).map(ownerJob), last = rows[limit - 1];
    return { jobs, nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null };
  }
  async ownerDetail(id: string, actor: User) {
    this.enabled(); this.id(id);
    return this.repository.withJob(id, async tx => {
      this.owner(tx, actor);
      if (!Number.isInteger(tx.job.payloadBytes) || tx.job.payloadBytes < 0 || tx.job.payloadBytes > MAX_JOB_BYTES ||
          !Number.isInteger(tx.job.messageCount) || tx.job.messageCount < 0 || tx.job.messageCount > 1000 ||
          !Number.isInteger(tx.job.batchCount) || tx.job.batchCount < 0 || tx.job.batchCount > MAX_JOB_BATCHES) throw new ConflictException('Некорректные счётчики задания');
      const { raw } = await loadHistorySources(tx);
      const dialogs = new Map<string, { dialogueId: string; channel: string; messageCount: number }>();
      for (const value of raw) {
        const message = normalizeMessage(value), row = dialogs.get(message.dialogueId);
        if (row) row.messageCount++;
        else dialogs.set(message.dialogueId, { dialogueId: message.dialogueId, channel: message.channel, messageCount: 1 });
      }
      const planningEnabled = process.env.HISTORY_MIGRATION_PLANNING_ENABLED === 'true';
      const targets = planningEnabled ? await this.repository.ownerTargets(tx) : [];
      if (targets.length > 1000) throw new ConflictException('Слишком много сопоставлений');
      return { ...ownerJob(tx.job), planningEnabled, ...await historyOperationalJobState(tx),
        agentPaired: tx.job.status === 'STAGING' && Boolean(tx.job.tokenHash && tx.job.agentExpiresAt && tx.job.agentExpiresAt.getTime() > Date.now()),
        dialogs: [...dialogs.values()].sort((a, b) => a.dialogueId < b.dialogueId ? -1 : a.dialogueId > b.dialogueId ? 1 : 0), targets };
    });
  }
  async create(input: unknown, password: string, actor: User) {
    this.enabled();
    if (actor?.role !== 'OWNER') throw new ForbiddenException('Недостаточно прав');
    const verified = await this.backups.reauthenticate(actor, password);
    let scope; try { scope = validateHistoryScope(input); } catch { throw new BadRequestException('Некорректная область источника'); }
    // Fail closed before storing any history when the existing installation key is absent.
    decryptSecret(encryptSecret('history-staging-key-check'));
    return publicJob(await this.repository.create(scope, actor.id, verified.passwordHash));
  }
  async pair(id: string, password: string, actor: User) {
    this.enabled(); this.id(id); const verified = await this.backups.reauthenticate(actor, password);
    return this.repository.withJob(id, async tx => {
      this.owner(tx, actor, verified.passwordHash); this.open(tx.job);
      await assertHistoryJobMutationAllowed(tx, 'SOURCE');
      const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 86400000);
      await tx.pair(sha256(token), expiresAt);
      return { jobId: id, token, expiresAt: expiresAt.toISOString(), importEnabled: false };
    });
  }
  async revoke(id: string, password: string, actor: User, closeJob = false) {
    this.enabled(); this.id(id); const verified = await this.backups.reauthenticate(actor, password);
    return this.repository.withJob(id, async tx => {
      this.owner(tx, actor, verified.passwordHash);
      if (closeJob) await assertHistoryJobMutationAllowed(tx, 'CLOSE');
      await tx.close(closeJob); return { jobId: id, revoked: true, importEnabled: false };
    });
  }
  async status(id: string, authorization: unknown) {
    this.enabled(); this.id(id);
    return this.repository.withJob(id, async tx => { this.agent(tx, authorization); return { jobId: id, status: tx.job.status, importEnabled: false }; });
  }
  async stage(id: string, authorization: unknown, input: unknown) {
    this.enabled(); this.id(id);
    return this.repository.withJob(id, async tx => {
      this.agent(tx, authorization);
      let packet; try { packet = validateIntakePacket(input, tx.job); } catch { throw new BadRequestException('Неверный пакет, область источника или контрольная сумма'); }
      const existing = await tx.batch(packet.batchId, packet.checksum);
      if (existing.length) {
        if (existing.length !== 1 || existing[0]!.batchId !== packet.batchId || existing[0]!.checksum !== packet.checksum ||
          openStagedPayload(tx.job, existing[0]!) !== packet.payloadJson) throw new ConflictException('Идентификатор или содержимое пакета уже использовано');
      } else {
        await assertHistoryJobMutationAllowed(tx, 'SOURCE');
        if (tx.job.batchCount >= MAX_JOB_BATCHES || tx.job.messageCount + packet.messageCount > 1000 || tx.job.payloadBytes + packet.payloadBytes > MAX_JOB_BYTES) throw new ConflictException('Достигнут лимит пилотного задания');
        await tx.stage({ batchId: packet.batchId, checksum: packet.checksum, encryptedPayload: sealStagedPayload(tx.job, packet),
          messageCount: packet.messageCount, payloadBytes: packet.payloadBytes });
      }
      // Returned only when the enclosing transaction COMMIT resolves, including the audit record.
      return { jobId: id, batchId: packet.batchId, checksum: packet.checksum, status: 'STAGED' as const };
    });
  }
  async preview(id: string, actor: User) {
    this.enabled(); this.id(id);
    return this.repository.withJob(id, async tx => {
      this.owner(tx, actor);
      const batches = await tx.batches();
      if (batches.length > MAX_JOB_BATCHES) throw new ConflictException('Некорректный размер задания');
      const messages: unknown[] = [];
      for (const batch of batches) {
        const checked = validateIntakePacket({ batchId: batch.batchId, checksum: batch.checksum, payloadJson: openStagedPayload(tx.job, batch) }, tx.job);
        if (checked.messageCount !== batch.messageCount || checked.payloadBytes !== batch.payloadBytes) throw new ConflictException('Повреждён пакет задания');
        messages.push(...checked.rawMessages);
      }
      const result = planTimelineMerge(messages, []); // No agent-provided proof IDs are approved here.
      return { ...publicJob(tx.job), previewDigest: sha256(JSON.stringify(batches.map(b => [b.batchId, b.checksum]))),
        crmCompared: false, sourceCompleteness: 'UNVERIFIED', discovered: result.discovered,
        inBatchDuplicates: result.inBatchDuplicates, conflicts: result.conflicts,
        requiresReview: result.new + result.review, addedToCrm: 0,
        blockers: ['CLIENT_MAPPING_REQUIRED', 'LIVE_HISTORY_COMPARISON_REQUIRED', 'BACKUP_AND_OWNER_APPROVAL_REQUIRED'] };
    });
  }
}
