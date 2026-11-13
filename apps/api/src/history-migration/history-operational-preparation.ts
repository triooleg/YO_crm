import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { OperationalBackupGrantContext } from '../backups/backup-operational-grant';
import { validateKeycrmArchiveApproval, type KeycrmArchiveApproval } from './history';
import { openHistoryEvidence, sealHistoryEvidence } from './history-evidence';
import type { MigrationTransaction } from './history-migration.repository';
import { migrationId, sha256 } from './intake-rules';

const SECTION = 'history.operational.preparation';
const MAX_AGE_MS = 7200000;
type Preparation = {version: 1; approval: KeycrmArchiveApproval; context: OperationalBackupGrantContext;
  verifiedPasswordHash: string; preparedAt: string; expiresAt: string};
function owner(tx: MigrationTransaction) {
  if (tx.job.status !== 'STAGING' || tx.actor.id !== tx.job.createdById || tx.actor.role !== 'OWNER' || !tx.actor.active || tx.actor.archivedAt)
    throw new ForbiddenException('Подготовка импорта недоступна текущему владельцу');
}
function validContext(tx: MigrationTransaction, context: OperationalBackupGrantContext) {
  const keys = ['actorId','candidateSnapshot','clientId','jobId','migrationSetDigest','previewDigest','sourceDigest','targetIdentity'];
  if (!context || Object.keys(context).sort().join(',') !== keys.sort().join(',') || context.jobId !== tx.job.id || context.actorId !== tx.actor.id ||
    typeof context.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(context.clientId) ||
    [context.candidateSnapshot,context.migrationSetDigest,context.previewDigest,context.sourceDigest].some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) ||
    !context.targetIdentity || Object.keys(context.targetIdentity).sort().join(',') !== 'cluster,databaseName,databaseOid' ||
    !/^[1-9][0-9]{0,19}$/.test(context.targetIdentity.cluster) || typeof context.targetIdentity.databaseName !== 'string' || !context.targetIdentity.databaseName ||
    !Number.isInteger(context.targetIdentity.databaseOid) || context.targetIdentity.databaseOid <= 0)
    throw new ConflictException('Контекст подготовки импорта изменился');
}
function instant(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new ConflictException('Неверный срок подготовки импорта');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new ConflictException('Неверный срок подготовки импорта');
  return time;
}
/** Only a reauthenticated operational prepare call may persist this record. It
 * authorizes host backup preparation, never Message writes or an apply bypass.
 */
export async function saveOperationalPreparation(tx: MigrationTransaction, approval: KeycrmArchiveApproval,
  context: OperationalBackupGrantContext, verifiedPasswordHash: string, now = new Date()) {
  owner(tx); migrationId(tx.job.id); validContext(tx, context);
  if (!verifiedPasswordHash || verifiedPasswordHash !== tx.actor.passwordHash) throw new ForbiddenException('Повторите подтверждение владельца');
  const preparedAt = now.toISOString(), expiresAt = new Date(now.getTime() + MAX_AGE_MS).toISOString();
  const preparation: Preparation = {version: 1, approval: validateKeycrmArchiveApproval(approval), context,
    verifiedPasswordHash, preparedAt, expiresAt};
  const payloadEncrypted = sealHistoryEvidence('OPERATIONAL_PREPARATION', tx.job.id, preparation);
  if (Buffer.byteLength(payloadEncrypted) > 1048576) throw new ConflictException('Подготовка импорта превышает лимит');
  const value = {version: 1, payloadEncrypted};
  await tx.db.appSetting.upsert({where: {section_key: {section: SECTION, key: tx.job.id}},
    create: {section: SECTION, key: tx.job.id, value}, update: {value}});
  await tx.audit('HISTORY_OPERATIONAL_PREPARATION_SAVED', {sourceDigest: context.sourceDigest, previewDigest: context.previewDigest, expiresAt});
  return {jobId: tx.job.id, sourceDigest: context.sourceDigest, previewDigest: context.previewDigest, expiresAt, preparationDigest: sha256(payloadEncrypted)};
}

/** Host-only context acquisition still reloads the current job/owner and verifies
 * password rotation. Caller JSON cannot create this authenticated preparation.
 */
export async function loadOperationalPreparation(tx: MigrationTransaction, now = new Date()) {
  owner(tx); migrationId(tx.job.id);
  const row = await tx.db.appSetting.findUnique({where: {section_key: {section: SECTION, key: tx.job.id}}});
  const value = row?.value;
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'payloadEncrypted,version' ||
    value.version !== 1 || typeof value.payloadEncrypted !== 'string' || Buffer.byteLength(value.payloadEncrypted) > 1048576)
    throw new ConflictException('Не найдена действующая подготовка импорта');
  const preparation = openHistoryEvidence<Preparation>('OPERATIONAL_PREPARATION', tx.job.id, value.payloadEncrypted);
  if (!preparation || Object.keys(preparation).sort().join(',') !== 'approval,context,expiresAt,preparedAt,verifiedPasswordHash,version' ||
    preparation.version !== 1 || preparation.verifiedPasswordHash !== tx.actor.passwordHash)
    throw new ConflictException('Подтверждение подготовки импорта изменилось');
  validContext(tx, preparation.context);
  const start = instant(preparation.preparedAt), end = instant(preparation.expiresAt), time = now.getTime();
  if (!Number.isFinite(time) || end !== start + MAX_AGE_MS || start > time || time >= end) throw new ConflictException('Подготовка импорта истекла');
  return {approval: validateKeycrmArchiveApproval(preparation.approval), context: preparation.context,
    expiresAt: preparation.expiresAt, digest: sha256(value.payloadEncrypted)};
}
