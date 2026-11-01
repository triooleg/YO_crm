import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { loadTargetModule } from './overview-target-loader.mjs';

export const pilotScope = { source: 'KEYCRM', account: 'synthetic-business', channel: 'INSTAGRAM' };
export const pilotOwner = { id: 'owner', role: 'OWNER', active: true, archivedAt: null };
export const pilotMessage = (id = 'one', extra = {}) => ({ ...pilotScope, dialogueId: 'thread-a', sourceMessageId: id,
  direction: 'INBOUND', sender: 'synthetic-person', timestamp: '2024-01-01T12:00:00Z', text: `Synthetic ${id}`, attachments: [], ordinal: 0, ...extra });

/** Real PostgreSQL storage shell for this bounded seam, not a complete CRM restore. */
const shell = `
CREATE TYPE "ContactChannel" AS ENUM ('WEBSITE','CHATWOOT','INSTAGRAM','FACEBOOK','WHATSAPP','EMAIL','TELEGRAM','REFERRAL','RETURNING_CUSTOMER','MANUAL','OTHER');
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND','OUTBOUND','INTERNAL');
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED','DRAFT','SENT','FAILED');
CREATE TYPE "ClientStatus" AS ENUM ('LEAD','ACTIVE','VIP','INACTIVE','BLOCKED');
CREATE TABLE "User" (id TEXT PRIMARY KEY,role TEXT NOT NULL,active BOOLEAN NOT NULL,"archivedAt" TIMESTAMP(3),"passwordHash" TEXT NOT NULL);
CREATE TABLE "Client" (id TEXT PRIMARY KEY,"firstName" TEXT NOT NULL,"lastName" TEXT,"displayName" TEXT NOT NULL,email TEXT,phone TEXT,whatsapp TEXT,
  source "ContactChannel" NOT NULL DEFAULT 'MANUAL',status "ClientStatus" NOT NULL DEFAULT 'LEAD',"firstContactAt" TIMESTAMP(3),"lastContactAt" TIMESTAMP(3),
  "nextActionAt" TIMESTAMP(3),"inboxSpamAt" TIMESTAMP(3),notes TEXT,preferences JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,"archivedAt" TIMESTAMP(3));
CREATE TABLE "ClientMergeRedirect" ("sourceClientId" TEXT PRIMARY KEY REFERENCES "Client"(id),"targetClientId" TEXT NOT NULL REFERENCES "Client"(id));
CREATE TABLE "Conversation" (id TEXT PRIMARY KEY,"clientId" TEXT NOT NULL REFERENCES "Client"(id),channel "ContactChannel" NOT NULL,"externalId" TEXT,
  subject TEXT,"lastMessageAt" TIMESTAMP(3),"unreadCount" INTEGER NOT NULL DEFAULT 0,"unreadVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,"archivedAt" TIMESTAMP(3),
  UNIQUE("clientId",channel),UNIQUE("externalId",channel));
CREATE TABLE "Message" (id TEXT PRIMARY KEY,"conversationId" TEXT NOT NULL REFERENCES "Conversation"(id),direction "MessageDirection" NOT NULL,status "MessageStatus" NOT NULL,
  content TEXT NOT NULL,"normalizedText" TEXT,language TEXT,"messageType" TEXT NOT NULL DEFAULT 'text',"externalId" TEXT,metadata JSONB,"rawPayload" JSONB,
  "webhookEnvelopeId" TEXT,"sentAt" TIMESTAMP(3),"receivedAt" TIMESTAMP(3),"replyToMessageId" TEXT REFERENCES "Message"(id),
  "aiProcessedAt" TIMESTAMP(3),"aiAnalysisVersion" TEXT,"authorId" TEXT REFERENCES "User"(id),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("conversationId","externalId"));
CREATE TABLE "MessageAttachment" (id TEXT PRIMARY KEY,"messageId" TEXT NOT NULL REFERENCES "Message"(id),type TEXT,"storageKey" TEXT,"externalUrl" TEXT,metadata JSONB);
CREATE TABLE "MessageAnalysis" (id TEXT PRIMARY KEY,"messageId" TEXT NOT NULL REFERENCES "Message"(id));
CREATE TABLE "AiJob" (id TEXT PRIMARY KEY,"messageId" TEXT REFERENCES "Message"(id));
CREATE TABLE "AiJobAttempt" (id TEXT PRIMARY KEY,"jobId" TEXT NOT NULL REFERENCES "AiJob"(id));
CREATE TABLE "WorkTask" (id TEXT PRIMARY KEY,"sourceMessageId" TEXT REFERENCES "Message"(id),"clientId" TEXT REFERENCES "Client"(id));
CREATE TABLE "Order" (id TEXT PRIMARY KEY,"clientId" TEXT NOT NULL REFERENCES "Client"(id),"priceMinor" INTEGER NOT NULL);
CREATE TABLE "Payment" (id TEXT PRIMARY KEY,"orderId" TEXT NOT NULL REFERENCES "Order"(id),"amountMinor" INTEGER NOT NULL);
CREATE TABLE "AuditLog" (id TEXT PRIMARY KEY,"actorId" TEXT REFERENCES "User"(id),action TEXT,"entityType" TEXT,"entityId" TEXT,"after" JSONB,"createdAt" TIMESTAMP(3));
INSERT INTO "User" VALUES ('owner','OWNER',true,NULL,'synthetic-password-hash'),('other-owner','OWNER',true,NULL,'synthetic-password-hash');
INSERT INTO "Client" (id,"firstName","displayName",email,phone,status,"updatedAt") VALUES ('existing','Existing','Existing','business@example.test','+380991234567','ACTIVE',CURRENT_TIMESTAMP);
INSERT INTO "Order" VALUES ('protected-order','existing',39000); INSERT INTO "Payment" VALUES ('protected-payment','protected-order',19500);
`;

export async function historyFixture() {
  const { PGlite } = await import('../../../.local/tracking-notifications/pg-test/node_modules/@electric-sql/pglite/dist/index.js');
  // Prisma treats its timestamp-without-time-zone DateTime columns as UTC.
  // PGlite's default JS timestamp parser uses Windows local time; mirror the ORM,
  // and separately assert original SQL timestamp literals in chronology tests.
  const db = new PGlite({ parsers: { 1114: text => new Date(text.replace(' ', 'T') + 'Z') } });
  const before = Object.fromEntries(['HISTORY_MIGRATION_ENABLED', 'HISTORY_MIGRATION_PLANNING_ENABLED', 'SETTINGS_ENCRYPTION_KEY'].map(name => [name, process.env[name]]));
  process.env.HISTORY_MIGRATION_ENABLED = 'true'; process.env.HISTORY_MIGRATION_PLANNING_ENABLED = 'true';
  process.env.SETTINGS_ENCRYPTION_KEY = 'synthetic-isolated-history-key-not-production';
  const port = query => ({
    $queryRaw: async (parts, ...values) => (await query(typeof parts.text === 'string' ? parts.text : parts.reduce((s, p, i) => s + (i ? `$${i}` : '') + p, ''), typeof parts.text === 'string' ? parts.values : values)).rows,
    $executeRaw: async (parts, ...values) => (await query(typeof parts.text === 'string' ? parts.text : parts.reduce((s, p, i) => s + (i ? `$${i}` : '') + p, ''), typeof parts.text === 'string' ? parts.values : values)).affectedRows,
  });
  let failCommit = false, pretendRealPostgres = false;
  const guardedQuery = pg => (sql, values) => {
    if (pretendRealPostgres && sql.includes('pg_catalog.version()')) return Promise.resolve({ rows: [{ version: 'PostgreSQL 18 on x86_64-linux' }], affectedRows: 0 });
    return pg.query(sql, values);
  };
  const prisma = { ...port(guardedQuery(db)), $transaction: callback => db.transaction(async pg => {
    const result = await callback(port(guardedQuery(pg))); if (failCommit) throw new Error('Synthetic transaction failure'); return result;
  }) };
  const backups = { reauthenticate: async (actor, password) => {
    if (password !== 'synthetic-password') throw new Error('Invalid password');
    return (await db.query('SELECT * FROM "User" WHERE id=$1', [actor.id])).rows[0];
  } };
  const { HistoryMigrationRepository } = loadTargetModule('history-migration/history-migration.repository.ts');
  const { HistoryMigrationService } = loadTargetModule('history-migration/history-migration.service.ts');
  const { HistoryMigrationPlanningService } = loadTargetModule('history-migration/history-planning.service.ts');
  const repository = new HistoryMigrationRepository(prisma), intake = new HistoryMigrationService(repository, backups), planning = new HistoryMigrationPlanningService(repository, backups);
  await db.exec(shell);
  for (const name of ['20261029150000_history_migration_staging', '20261029160000_history_migration_planning'])
    await db.exec(await readFile(new URL(`../../../packages/database/prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  return { db, prisma, repository, backups, intake, planning, failCommit: value => { failCommit = value; }, realPostgres: value => { pretendRealPostgres = value; },
    async stage(messages) {
      const job = await intake.create(pilotScope, 'synthetic-password', pilotOwner), paired = await intake.pair(job.jobId, 'synthetic-password', pilotOwner);
      const payloadJson = JSON.stringify({ version: 1, source: 'KEYCRM', messages, completeness: { status: 'PARTIAL' } });
      await intake.stage(job.jobId, `Bearer ${paired.token}`, { batchId: randomUUID(), payloadJson, checksum: createHash('sha256').update(payloadJson).digest('hex') });
      return { ...job, token: paired.token };
    },
    async close() { await db.close(); for (const [name, value] of Object.entries(before)) if (value === undefined) delete process.env[name]; else process.env[name] = value; },
  };
}
