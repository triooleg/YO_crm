import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { HistoryScope } from './intake-rules';

export type MigrationJob = HistoryScope & { id: string; createdById: string; status: 'STAGING' | 'CLOSED';
  tokenHash: string | null; agentExpiresAt: Date | null; agentRevision: number;
  batchCount: number; messageCount: number; payloadBytes: number; createdAt: Date; updatedAt: Date };
export type MigrationActor = { id: string; role: string; active: boolean; archivedAt: Date | null; passwordHash: string };
export type MigrationBatch = { id: string; jobId: string; batchId: string; checksum: string;
  encryptedPayload: string; messageCount: number; payloadBytes: number; createdAt: Date };
export type OwnerJobMetadata = Omit<MigrationJob, 'tokenHash' | 'createdById' | 'updatedAt'>;
export type OwnerJobCursor = { createdAt: string; id: string };
export type OwnerTargetMetadata = { targetId: string; dialogueId: string; mode: 'EXISTING' | 'CREATE_PROPOSAL'; clientId: string | null; revision: number };

/** All staging writes serialize on the job row; owner role is reloaded under a shared lock.
 * No operational message/client writer is reachable from this repository.
 */
export class MigrationTransaction {
  constructor(readonly db: Prisma.TransactionClient, readonly job: MigrationJob, readonly actor: MigrationActor) {}
  async audit(action: string, after: Record<string, unknown>) {
    await this.db.$executeRaw`INSERT INTO "AuditLog" ("id","actorId","action","entityType","entityId","after","createdAt")
      VALUES (${randomUUID()},${this.actor.id},${action},'HistoryMigrationJob',${this.job.id},${JSON.stringify(after)}::jsonb,CURRENT_TIMESTAMP)`;
  }
  async batch(batchId: string, checksum: string) {
    return this.db.$queryRaw<MigrationBatch[]>`SELECT * FROM "HistoryMigrationBatch" WHERE "jobId"=${this.job.id} AND ("batchId"=${batchId} OR "checksum"=${checksum})`;
  }
  async batches() {
    return this.db.$queryRaw<MigrationBatch[]>`SELECT * FROM "HistoryMigrationBatch" WHERE "jobId"=${this.job.id} ORDER BY "createdAt","id" LIMIT 101`;
  }
  async pair(tokenHash: string, expiresAt: Date) {
    await this.db.$executeRaw`UPDATE "HistoryMigrationJob" SET "tokenHash"=${tokenHash},"agentExpiresAt"=${expiresAt},"agentRevision"="agentRevision"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${this.job.id}`;
    await this.audit('HISTORY_AGENT_PAIRED', { expiresAt: expiresAt.toISOString(), revision: this.job.agentRevision + 1 });
  }
  async close(closeJob: boolean) {
    await this.db.$executeRaw`UPDATE "HistoryMigrationJob" SET "tokenHash"=NULL,"agentExpiresAt"=NULL,"agentRevision"="agentRevision"+1,"status"=${closeJob ? 'CLOSED' : this.job.status},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${this.job.id}`;
    await this.audit(closeJob ? 'HISTORY_JOB_CLOSED' : 'HISTORY_AGENT_REVOKED', { revision: this.job.agentRevision + 1 });
  }
  async stage(batch: Omit<MigrationBatch, 'id' | 'jobId' | 'createdAt'>) {
    await this.db.$executeRaw`INSERT INTO "HistoryMigrationBatch" ("id","jobId","batchId","checksum","encryptedPayload","messageCount","payloadBytes")
      VALUES (${randomUUID()},${this.job.id},${batch.batchId},${batch.checksum},${batch.encryptedPayload},${batch.messageCount},${batch.payloadBytes})`;
    await this.db.$executeRaw`UPDATE "HistoryMigrationJob" SET "batchCount"="batchCount"+1,"messageCount"="messageCount"+${batch.messageCount},"payloadBytes"="payloadBytes"+${batch.payloadBytes},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${this.job.id}`;
    await this.audit('HISTORY_BATCH_STAGED', { batchId: batch.batchId, checksum: batch.checksum, messageCount: batch.messageCount, payloadBytes: batch.payloadBytes });
  }
}

@Injectable()
export class HistoryMigrationRepository {
  constructor(private readonly prisma: PrismaService) {}
  async listOwned(actorId: string, limit: number, cursor?: OwnerJobCursor) {
    return this.prisma.$transaction(async db => {
      const [actor] = await db.$queryRaw<Pick<MigrationActor, 'id' | 'role' | 'active' | 'archivedAt'>[]>`SELECT "id","role","active","archivedAt" FROM "User" WHERE "id"=${actorId} FOR SHARE`;
      if (!actor?.active || actor.archivedAt || actor.role !== 'OWNER') throw new ForbiddenException('Недостаточно прав');
      return db.$queryRaw<OwnerJobMetadata[]>`SELECT "id","status","source","channel","account","batchCount","messageCount","payloadBytes","agentRevision","agentExpiresAt","createdAt"
        FROM "HistoryMigrationJob" WHERE "createdById"=${actorId}
        AND (${cursor === undefined} OR ("createdAt","id") < (${cursor?.createdAt ?? '1970-01-01T00:00:00.000Z'}::timestamp,${cursor?.id ?? ''}))
        ORDER BY "createdAt" DESC,"id" DESC LIMIT ${limit + 1}`;
    }, { maxWait: 5000, timeout: 15000 });
  }
  async ownerTargets(tx: MigrationTransaction) {
    return tx.db.$queryRaw<OwnerTargetMetadata[]>`SELECT "id" AS "targetId","dialogueId","mode","clientId","revision"
      FROM "HistoryMigrationTarget" WHERE "jobId"=${tx.job.id} AND "archivedAt" IS NULL ORDER BY "dialogueId","id" LIMIT 1001`;
  }
  async create(scope: HistoryScope, actorId: string, verifiedPasswordHash: string) {
    return this.prisma.$transaction(async db => {
      const [actor] = await db.$queryRaw<MigrationActor[]>`SELECT "id","role","active","archivedAt","passwordHash" FROM "User" WHERE "id"=${actorId} FOR UPDATE`;
      if (!actor?.active || actor.archivedAt || actor.role !== 'OWNER') throw new ForbiddenException('Недостаточно прав');
      if (!verifiedPasswordHash || actor.passwordHash !== verifiedPasswordHash) throw new ForbiddenException('Пароль изменился: повторите подтверждение');
      const [count] = await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM "HistoryMigrationJob" WHERE "createdById"=${actorId} AND "status"='STAGING'`;
      if ((count?.count ?? 5) >= 5) throw new ForbiddenException('Сначала закройте одно из пяти заданий');
      const [job] = await db.$queryRaw<MigrationJob[]>`INSERT INTO "HistoryMigrationJob" ("id","createdById","source","account","channel","updatedAt")
        VALUES (${randomUUID()},${actorId},${scope.source},${scope.account},${scope.channel},CURRENT_TIMESTAMP) RETURNING *`;
      if (!job) throw new Error('Не удалось создать задание');
      await new MigrationTransaction(db, job, actor).audit('HISTORY_JOB_CREATED', { source: scope.source, channel: scope.channel });
      return job;
    });
  }
  async withJob<T>(id: string, action: (transaction: MigrationTransaction) => Promise<T>, beforeJobLock?: (db: Prisma.TransactionClient) => Promise<void>): Promise<T> {
    return this.prisma.$transaction(async db => {
      // Internal executors may establish the common ingress/client/history lock
      // order before the job row. Owner authorization remains mandatory below.
      if (beforeJobLock) await beforeJobLock(db);
      else await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'client-merge-global'},0))`;
      const [job] = await db.$queryRaw<MigrationJob[]>`SELECT * FROM "HistoryMigrationJob" WHERE "id"=${id} FOR UPDATE`;
      if (!job) throw new NotFoundException('Задание не найдено');
      const [actor] = await db.$queryRaw<MigrationActor[]>`SELECT "id","role","active","archivedAt","passwordHash" FROM "User" WHERE "id"=${job.createdById} FOR SHARE`;
      if (!actor?.active || actor.archivedAt || actor.role !== 'OWNER') throw new ForbiddenException('Доступ владельца отозван');
      return action(new MigrationTransaction(db, job, actor));
    }, { maxWait: 5000, timeout: 15000 });
  }
}
