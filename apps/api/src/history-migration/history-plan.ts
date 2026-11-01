import { ConflictException } from '@nestjs/common';
import type { MigrationTransaction } from './history-migration.repository';
import { MAX_JOB_BATCHES, validateIntakePacket } from './intake-rules';
import { openStagedPayload } from './staged-payload';
import { HistoryPlanningRepository } from './history-planning.repository';
import { openHistoryEvidence } from './history-evidence';
import { subjectIdentityKey, validateTargetRequest } from './history-targets';
import { historyDigest, historyMessageTime, planMappedTimeline, projectExistingHistory, type ProjectedHistory, type ResolvedTarget } from './history-planning-model';
import { normalizeMessage, sourceKey, keycrmArchiveEligible, keycrmArchiveMetadata, validateKeycrmArchiveApproval, validateKeycrmArchiveOrder, type KeycrmArchiveApproval } from './history';
import { sha256 } from './intake-rules';

export async function loadHistorySources(tx: MigrationTransaction) {
  const batches = await tx.batches();
  if (batches.length > MAX_JOB_BATCHES) throw new ConflictException('Слишком много пакетов');
  const raw: unknown[] = []; let bytes = 0;
  for (const batch of batches) {
    const checked = validateIntakePacket({ batchId: batch.batchId, checksum: batch.checksum, payloadJson: openStagedPayload(tx.job, batch) }, tx.job);
    if (batch.messageCount !== checked.messageCount || batch.payloadBytes !== checked.payloadBytes) throw new ConflictException('Повреждён пакет задания');
    raw.push(...checked.rawMessages); bytes += checked.payloadBytes;
  }
  if (raw.length !== tx.job.messageCount || bytes !== tx.job.payloadBytes || batches.length !== tx.job.batchCount || raw.length > 1000) throw new ConflictException('Счётчики задания не соответствуют пакетам');
  return { batches, raw };
}
export type IdentityEvidence = { runId: string; clientId: string; source: string; account: string; channel: string; subjectId: string };
export async function resolveSubjectIdentity(repository: HistoryPlanningRepository, subjectId: string) {
  const id = subjectIdentityKey(repository.tx.job, subjectId), row = await repository.identity(id);
  if (!row) return { id, client: null, rejected: false };
  const evidence = openHistoryEvidence<IdentityEvidence>('IDENTITY', id, row.payloadEncrypted);
  if (evidence.runId !== row.runId || evidence.clientId !== row.clientId || evidence.source !== repository.tx.job.source ||
    evidence.account !== repository.tx.job.account || evidence.channel !== repository.tx.job.channel || evidence.subjectId !== subjectId) throw new ConflictException('Конфликт идентичности источника');
  const client = (await repository.canonical(row.clientId)).target;
  return { id, client, rejected: !client || row.status !== 'APPLIED' };
}
/** Internal projection seam. HTTP callers supply no projector or trusted IDs;
 * operational execution must derive any additional provenance from its locked DB. */
export type HistoryProjector = (history: Awaited<ReturnType<HistoryPlanningRepository['history']>>, raw: readonly unknown[]) => Promise<ProjectedHistory>;
export async function buildHistoryPlan(tx: MigrationTransaction, archiveInput?:KeycrmArchiveApproval, project?: HistoryProjector) {
  const archive=archiveInput===undefined?undefined:validateKeycrmArchiveApproval(archiveInput);
  const repository = new HistoryPlanningRepository(tx);
  await repository.mergeReadLock();
  const { batches, raw } = await loadHistorySources(tx), rows = await repository.targets();
  if (rows.length > 1000) throw new ConflictException('Слишком много сопоставлений');
  const targets: ResolvedTarget[] = [], clientRows = new Map<string, unknown>();
  for (const row of rows) {
    const evidence = validateTargetRequest(repository.evidence(row));
    let target: ResolvedTarget = { dialogueId: row.dialogueId, groupKey: `unresolved:${row.id}`, clientId: null, state: 'REVIEW', reason: 'Сопоставление не подтверждено' };
    if (!row.archivedAt && evidence.mode === 'EXISTING') {
      const selected = (await repository.canonical(evidence.clientId!)).target;
      if (selected) { target = { dialogueId: row.dialogueId, groupKey: `client:${selected.id}`, clientId: selected.id, state: 'MATCHED', subjectId: evidence.subjectId }; clientRows.set(selected.id, selected); }
      if (selected && evidence.subjectId) {
        const identity = await resolveSubjectIdentity(repository, evidence.subjectId);
        if (identity.rejected || (identity.client && identity.client.id !== selected.id)) target = { ...target, state: 'REVIEW', reason: 'Идентичность указывает на другого или архивного клиента' };
      }
    } else if (!row.archivedAt && evidence.mode === 'CREATE_PROPOSAL') {
      const identity = await resolveSubjectIdentity(repository, evidence.subjectId!);
      if (!identity.rejected && identity.client) {
        target = { dialogueId: row.dialogueId, groupKey: `client:${identity.client.id}`, clientId: identity.client.id, state: 'MATCHED', subjectId: evidence.subjectId, identityKey: identity.id };
        clientRows.set(identity.client.id, identity.client);
      } else if (!identity.rejected) target = { dialogueId: row.dialogueId, groupKey: `create:${identity.id}`, clientId: null, state: 'CREATE_PROPOSAL',
        subjectId: evidence.subjectId, displayName: evidence.displayName, identityKey: identity.id };
    }
    targets.push(target);
  }
  const histories = new Map<string, ProjectedHistory>();
  const sourceIndex = new Map(raw.map(row => { const message = normalizeMessage(row); return [sha256(sourceKey(message)), message] as const; }));
  const globalOrigins = await repository.incomingOrigins([...sourceIndex.keys()]);
  for (const origin of globalOrigins) {
    const source = sourceIndex.get(origin.id)!;
    const target = targets.find(row => row.dialogueId === source.dialogueId);
    if (target && target.clientId !== origin.clientId) {
      target.state = 'REVIEW'; target.reason = 'Исходное сообщение уже принадлежит другому клиенту';
    }
  }
  const databaseHistories = new Map<string, Awaited<ReturnType<HistoryPlanningRepository['history']>>>();
  let existingTotal = 0, existingBytes = 0;
  for (const target of targets) {
    if (target.state === 'REVIEW' || histories.has(target.groupKey)) continue;
    if (target.clientId) {
      const history = await repository.history(target.clientId);
      existingTotal += history.messages.length;
      existingBytes += Buffer.byteLength(JSON.stringify(history));
      if (existingTotal > 10000 || existingBytes > 33554432) throw new ConflictException('Общая история превышает лимит пилотной сверки');
      databaseHistories.set(target.groupKey, history); histories.set(target.groupKey, project ? await project(history, raw) : projectExistingHistory(history));
    } else histories.set(target.groupKey, { existing: [], blockers: [], fingerprint: 'NEW_CLIENT_NO_HISTORY', unverifiedCount: 0, hiddenIds: [], conflicts: [] });
  }
  const result = planMappedTimeline(raw, targets, histories,archive);
  if (archive) {
    // Validate the future visible timeline before preview/preparation AND apply,
    // including existing archived variants. Explicit approvals cannot bypass it.
    const timeline = [...databaseHistories].flatMap(([groupKey, history]) => history.messages
      .filter(message => message.messageType !== 'reaction' && !histories.get(groupKey)!.hiddenIds.includes(message.id))
      .map(message => ({id:message.id,conversationId:message.conversationId,effectiveAt:historyMessageTime(message),metadata:message.metadata})));
    for (const action of result.actions) if (action.kind === 'NEW' && action.sourceMessages.every(keycrmArchiveEligible)) {
      timeline.push({id:action.key,conversationId:databaseHistories.get(action.groupKey)?.conversations[0]?.id ?? action.groupKey,
        effectiveAt:new Date(action.message.time.utc!),metadata:{historyArchive:keycrmArchiveMetadata(action.sourceMessages)}});
    }
    validateKeycrmArchiveOrder(timeline);
  }
  if (!raw.length) result.blockers.push('NO_STAGED_MESSAGES');
  if (existingTotal + result.newCandidates > 10000) result.blockers.push('PILOT_HISTORY_LIMIT');
  const sourceDigest = historyDigest({ jobId: tx.job.id, scope: [tx.job.source, tx.job.account, tx.job.channel], batches: batches.map(row => [row.batchId, row.checksum]),
    targets: rows.map(row => [row.id, row.revision, row.clientId, row.archivedAt, row.evidenceEncrypted]),...(archive?{archive}: {}) });
  const previewDigest = historyDigest({ sourceDigest, targets, clients: [...clientRows], histories: [...histories].map(([key, history]) => [key, history.fingerprint]),
    actions: result.actions.map(a => [a.key, a.kind, a.existingId, a.groupKey]), blockers: result.blockers });
  return { ...result, raw, targets, rows, databaseHistories, sourceDigest, previewDigest,
    crmCompared: raw.length > 0 && result.unmapped === 0, sourceCompleteness: 'UNVERIFIED' as const };
}
