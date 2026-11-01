import { createHash, randomUUID } from 'node:crypto';
import type { Backup, User } from '@prisma/client';
import type { BackupService } from '../backups/backup.service';
import type { BackupRepository } from '../backups/backup.repository';
import type { BackupStorage } from '../backups/backup.storage';
import { parseBackupJson } from '../backups/backup.json';
import { validateOperationalBackupGrant, type OperationalBackupGrantContext } from '../backups/backup-operational-grant';
import { encryptSecret } from '../secret-box';
import { openHistoryEvidence, sealHistoryEvidence } from './history-evidence';
import type { HistoryMigrationRepository, MigrationTransaction } from './history-migration.repository';
import type { HistoryOperationalService } from './history-operational.service';
import { loadOperationalPreparation } from './history-operational-preparation';
import { historyDigest } from './history-planning-model';

const operations = ['PREPARED_CONTEXT','QUEUE_DATA','QUEUE_DRILL','CAPTURE_STATUS','VERIFY_EVIDENCE','SEAL_GRANT','RECORD_GRANT'] as const;
type Operation = typeof operations[number];
type Input = {operation: Operation; jobId: string; payload?: unknown; grantId?: string};
type Capture = {context: OperationalBackupGrantContext; preparationDigest: string; backupId: string; drillId: string | null; captureStartedAt: string};
const SECTION = 'history.operational.capture';
const fail = (): never => { throw new Error('HISTORY_HOST_OPERATION_FAILED'); };
function requireValue(condition: unknown): asserts condition { if (!condition) fail(); }
function object(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: string[]) {
  const row = object(value);
  requireValue(Reflect.ownKeys(row).length === keys.length && keys.every(key => Object.hasOwn(row,key) && 'value' in Object.getOwnPropertyDescriptor(row,key)!));
  return row;
}
function uuid(value: unknown): asserts value is string { requireValue(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)); }
function instant(value: unknown): number {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value));
  const time = Date.parse(value); requireValue(Number.isFinite(time)); return time;
}
export function parseHistoryHostInput(bytes: Buffer): Input {
  requireValue(bytes.length > 0 && bytes.length <= 65536);
  const value = object(parseBackupJson(bytes));
  exact(value, value.operation === 'SEAL_GRANT' ? ['operation','jobId','payload'] : value.operation === 'RECORD_GRANT' ? ['operation','jobId','grantId'] : ['operation','jobId']);
  if (value.operation === 'RECORD_GRANT') uuid(value.grantId);
  requireValue(operations.includes(value.operation as Operation)); uuid(value.jobId);
  return value as Input;
}
function contextOnly(value: OperationalBackupGrantContext): OperationalBackupGrantContext {
  return {jobId:value.jobId,actorId:value.actorId,clientId:value.clientId,sourceDigest:value.sourceDigest,
    previewDigest:value.previewDigest,candidateSnapshot:value.candidateSnapshot,targetIdentity:{...value.targetIdentity},migrationSetDigest:value.migrationSetDigest};
}
/** Internal dependency seam. Not registered in Nest, never receives caller targets or credentials. */
export class HistoryHostHandler {
  constructor(private readonly repository: Pick<HistoryMigrationRepository,'withJob'>,
    private readonly backups: Pick<BackupRepository,'request'>,
    private readonly storage: Pick<BackupStorage,'verifyOperationalArtifacts'>,
    private readonly operational: Pick<HistoryOperationalService,'preparedContext'>,
    private readonly grants: Pick<BackupService,'verifyOperationalGrant'>) {}

  private async capture(tx: MigrationTransaction, preparation: Awaited<ReturnType<typeof loadOperationalPreparation>>, replaceOld = false): Promise<Capture | null> {
    const row = await tx.db.appSetting.findUnique({where:{section_key:{section:SECTION,key:tx.job.id}}});
    if (!row) return null;
    const wrapper = exact(row.value,['version','payloadEncrypted']);
    requireValue(wrapper.version === 1 && typeof wrapper.payloadEncrypted === 'string' && Buffer.byteLength(wrapper.payloadEncrypted) <= 65536);
    const value = exact(openHistoryEvidence('OPERATIONAL_CAPTURE',tx.job.id,wrapper.payloadEncrypted),['context','preparationDigest','backupId','drillId','captureStartedAt']) as unknown as Capture;
    if (replaceOld && value.preparationDigest !== preparation.digest) return null;
    requireValue(value.preparationDigest === preparation.digest && historyDigest(value.context) === historyDigest(preparation.context));
    requireValue(/^op-history-data-[a-f0-9-]{36}$/.test(value.backupId)); uuid(value.backupId.slice(16));
    requireValue(value.drillId === null || /^op-history-drill-[a-f0-9-]{36}$/.test(value.drillId));
    if (value.drillId) uuid(value.drillId.slice(17));
    const time = instant(value.captureStartedAt); requireValue(time <= Date.now() && Date.now()-time <= 7200000);
    return value;
  }
  private async save(tx: MigrationTransaction, capture: Capture) {
    const value = {version:1,payloadEncrypted:sealHistoryEvidence('OPERATIONAL_CAPTURE',tx.job.id,capture)};
    await tx.db.appSetting.upsert({where:{section_key:{section:SECTION,key:tx.job.id}},create:{section:SECTION,key:tx.job.id,value},update:{value}});
  }
  private async owned(tx: MigrationTransaction, id: string, kind: 'BACKUP'|'DRILL', complete: boolean, source?: string): Promise<Backup> {
    const row = await tx.db.backup.findUnique({where:{id}});
    requireValue(row && !row.archivedAt && row.createdById === tx.actor.id && row.type === 'DATA' && row.storageProvider === 'LOCAL');
    const metadata = object(row.metadata), job = object(metadata.job);
    requireValue(job.kind === kind && (!complete || (row.status === 'COMPLETED' && job.phase === 'COMPLETED' && row.completedAt)));
    requireValue((metadata.retentionClaim as {state?:string}|undefined)?.state !== 'DELETING');
    if (source) requireValue(job.sourceBackupId === source && metadata.sourceBackupId === source);
    return row;
  }
  async handle(input: Input): Promise<unknown> {
    // Revalidate injectable callers too; the executable parses before connecting.
    input = parseHistoryHostInput(Buffer.from(JSON.stringify(input)));
    const current = input.operation === 'CAPTURE_STATUS' ? null : await this.operational.preparedContext(input.jobId);
    const result = await this.repository.withJob(input.jobId, async tx => {
      const preparation = await loadOperationalPreparation(tx);
      if (current) requireValue(historyDigest(contextOnly(current)) === historyDigest(preparation.context));
      if (input.operation === 'PREPARED_CONTEXT') return {context:contextOnly(preparation.context),preview:current!.preview,preparationDigest:preparation.digest};
      if (input.operation === 'RECORD_GRANT') {
        requireValue(input.grantId);
        const context = contextOnly(preparation.context);
        const receipt = await this.grants.verifyOperationalGrant(input.grantId,context,tx.db);
        const again = await loadOperationalPreparation(tx); requireValue(again.digest === preparation.digest);
        const value = {version:1,grantId:input.grantId,previewDigest:context.previewDigest,sourceDigest:context.sourceDigest,
          ciphertextDigest:receipt.digest,expiresAt:receipt.grant.expiresAt};
        await tx.db.appSetting.upsert({where:{section_key:{section:'history.operational.grant',key:input.jobId}},
          create:{section:'history.operational.grant',key:input.jobId,value},update:{value}});
        await tx.audit('HISTORY_OPERATIONAL_GRANT_PUBLISHED',{grantId:input.grantId,previewDigest:context.previewDigest,
          sourceDigest:context.sourceDigest,ciphertextDigest:receipt.digest});
        return {grantId:input.grantId,expiresAt:receipt.grant.expiresAt};
      }
      let capture = await this.capture(tx,preparation,input.operation === 'QUEUE_DATA');
      if (!capture && input.operation === 'QUEUE_DATA') {
        capture = {context:contextOnly(preparation.context),preparationDigest:preparation.digest,
          backupId:'op-history-data-'+randomUUID(),drillId:null,captureStartedAt:new Date().toISOString()};
        await this.save(tx,capture);
      }
      requireValue(capture);
      if (input.operation === 'QUEUE_DATA') return {backupId:capture.backupId,captureStartedAt:capture.captureStartedAt,context:capture.context,preparationDigest:capture.preparationDigest};
      const backup = await this.owned(tx,capture.backupId,'BACKUP',input.operation !== 'CAPTURE_STATUS');
      if (input.operation === 'QUEUE_DRILL') {
        requireValue((backup.storagePath || backup.id) === backup.id && object(backup.metadata).sourceBackupId === backup.id);
        if (!capture.drillId) { capture.drillId='op-history-drill-'+randomUUID(); await this.save(tx,capture); }
        return {backupId:capture.backupId,drillJobId:capture.drillId};
      }
      const drill = capture.drillId ? await this.owned(tx,capture.drillId,'DRILL',input.operation !== 'CAPTURE_STATUS',capture.backupId) : null;
      if (input.operation === 'CAPTURE_STATUS') return {backupId:capture.backupId,backupStatus:backup.status,drillJobId:capture.drillId,drillStatus:drill?.status ?? null};
      requireValue(drill && this.storage.verifyOperationalArtifacts && backup.checksum && backup.sizeBytes !== null && (backup.storagePath || backup.id) === backup.id);
      // Same retention fence as the existing repository/agent, held through physical verification and sealing.
      await tx.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'backups-source:' + backup.id}))`;
      const data = await this.owned(tx,backup.id,'BACKUP',true);
      requireValue(data.checksum === backup.checksum && data.sizeBytes === backup.sizeBytes);
      const deletingAlias = await tx.db.backup.findFirst({where:{OR:[{storagePath:backup.id},{id:backup.id}],metadata:{path:['retentionClaim','state'],equals:'DELETING'}},select:{id:true}});
      requireValue(!deletingAlias);
      const archive = object(object(data.metadata).archive);
      requireValue(object(data.metadata).sourceBackupId === backup.id && typeof archive.checksum === 'string' && typeof archive.bytes === 'string' && /^[1-9][0-9]{0,19}$/.test(archive.bytes));
      const artifacts = await this.storage.verifyOperationalArtifacts(backup.id,{archiveChecksum:archive.checksum,archiveBytes:archive.bytes});
      requireValue(artifacts.manifestSha256 === backup.checksum && artifacts.archiveSha256 === archive.checksum && artifacts.archiveBytes === archive.bytes);
      const report = object(object(drill.metadata).drill), refs = object(report.references);
      requireValue(artifacts.type === 'data' && report.status === 'PASS' && report.cleanup === 'PASS' && report.sourceBackupId === backup.id &&
        refs.sourceBackupId === backup.id && refs.sourceStoragePath === backup.id && refs.sourceChecksum === artifacts.manifestSha256 &&
        refs.sourceManifestChecksum === artifacts.manifestSha256 && refs.sourceArtifactChecksum === artifacts.sha256sumsSha256 && refs.archiveChecksum === artifacts.archiveSha256);
      requireValue(drill.checksum === backup.checksum && drill.sizeBytes === backup.sizeBytes);
      const finish = instant(report.finishedAt); requireValue(finish >= instant(capture.captureStartedAt) && finish <= Date.now() && drill.completedAt && finish <= drill.completedAt.getTime());
      const evidence = {backupId:backup.id,captureStartedAt:capture.captureStartedAt,manifestSha256:artifacts.manifestSha256,
        sha256sumsSha256:artifacts.sha256sumsSha256,archiveSha256:artifacts.archiveSha256,archiveBytes:artifacts.archiveBytes,
        drillJobId:drill.id,drillReportSha256:artifacts.drillReportSha256,drillFinishedAt:report.finishedAt as string};
      // Physical verification can take time. Recheck expiry and current password before issuance.
      const again = await loadOperationalPreparation(tx);
      requireValue(again.digest === preparation.digest);
      if (input.operation === 'VERIFY_EVIDENCE') return {context:capture.context,evidence};
      const payload = object(input.payload); uuid(payload.grantId);
      const grant = validateOperationalBackupGrant(payload,payload.grantId,capture.context);
      requireValue(Object.entries(evidence).every(([key,value]) => grant[key as keyof typeof grant] === value));
      const ciphertext = encryptSecret(JSON.stringify(grant));
      await tx.audit('HISTORY_OPERATIONAL_GRANT_SEALED',{grantId:grant.grantId,backupId:backup.id});
      return {grantId:grant.grantId,ciphertext,digest:createHash('sha256').update(ciphertext).digest('hex')};
    });
    if (input.operation === 'QUEUE_DATA' || input.operation === 'QUEUE_DRILL') {
      // Intent committed first: a crash retries the same ID, never an unrelated backup.
      await this.repository.withJob(input.jobId,async tx => {
        const preparation = await loadOperationalPreparation(tx), capture = await this.capture(tx,preparation); requireValue(capture);
        const actor = await tx.db.user.findUnique({where:{id:tx.actor.id}});
        requireValue(actor && actor.active && !actor.archivedAt && actor.role === 'OWNER' && actor.passwordHash === tx.actor.passwordHash);
        if (input.operation === 'QUEUE_DATA') await this.backups.request(capture.backupId,'DATA',actor as User);
        else {
          await this.owned(tx,capture.backupId,'BACKUP',true); requireValue(capture.drillId);
          await this.backups.request(capture.drillId,'DATA',actor as User,{kind:'DRILL',sourceBackupId:capture.backupId});
        }
      });
    }
    return result;
  }
}

/** No Nest application or worker bootstrap. Configuration comes only from the installed process environment. */
async function main() {
  requireValue(process.platform === 'linux' && process.getuid?.() === 0 && process.env.HISTORY_OPERATIONAL_HOST_ENABLED === 'true' && process.argv.length === 2);
  const chunks: Buffer[]=[]; let length=0;
  for await (const chunk of process.stdin) { const bytes=Buffer.from(chunk); length+=bytes.length; requireValue(length<=65536); chunks.push(bytes); }
  const input = parseHistoryHostInput(Buffer.concat(chunks));
  const {PrismaService}=await import('../prisma.service');
  const {HistoryMigrationRepository}=await import('./history-migration.repository');
  const {BackupRepository}=await import('../backups/backup.repository');
  const {BackupService}=await import('../backups/backup.service');
  const {LocalBackupStorage}=await import('../backups/backup.storage');
  const {HistoryOperationalService}=await import('./history-operational.service');
  const prisma=new PrismaService(); let result: unknown;
  try {
    await prisma.$connect();
    const repository=new HistoryMigrationRepository(prisma), backups=new BackupRepository(prisma), storage=new LocalBackupStorage();
    const backupService=new BackupService(backups,storage), operational=new HistoryOperationalService(repository,backupService);
    result=await new HistoryHostHandler(repository,backups,storage,operational,backupService).handle(input);
  } finally { await prisma.$disconnect(); }
  process.stdout.write(JSON.stringify({ok:true,result})+'\n');
}
if (require.main === module) void main().catch(() => { process.stderr.write('HISTORY_HOST_OPERATION_FAILED\n'); process.exitCode=1; });
