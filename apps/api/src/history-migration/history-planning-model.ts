import { normalizeMessage, planTimelineMerge, sourceKey, keycrmArchiveEligible, keycrmArchiveMetadata, validateKeycrmArchiveApproval, type KeycrmArchiveApproval, type ExistingMessage, type HistoricalMessage, type MergeDecision } from './history';
import type { HistoryDbMessage, HistoryPlanningRepository, OriginEvidence } from './history-planning.repository';
import { openHistoryEvidence } from './history-evidence';
import { sha256 } from './intake-rules';
import { isSoftDeletedMessage } from '../communications/message-deletion';

export type ResolvedTarget = { dialogueId: string; groupKey: string; clientId: string | null;
  state: 'MATCHED' | 'CREATE_PROPOSAL' | 'REVIEW'; reason?: string; subjectId?: string; displayName?: string; identityKey?: string };
export type ProjectedHistory = { existing: ExistingMessage[]; blockers: string[]; fingerprint: string; unverifiedCount: number; hiddenIds: string[]; conflicts: string[] };
export type PlannedAction = MergeDecision & { groupKey: string; clientId: string | null };
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonical(value)]));
  return value;
}
export function historyDigest(value: unknown) { return sha256(JSON.stringify(canonical(value))); }
export function historyMessageTime(row: HistoryDbMessage) {
  return row.direction === 'OUTBOUND' && row.status === 'SENT' ? row.sentAt ?? row.createdAt
    : row.direction === 'INBOUND' ? row.receivedAt ?? row.createdAt : row.createdAt;
}

/** Hidden messages remain in duplicate detection; uncertain native wrappers are not invented as proof. */
export function projectExistingHistory(history: Awaited<ReturnType<HistoryPlanningRepository['history']>>): ProjectedHistory {
  const existing: ExistingMessage[] = [], blockers = new Set<string>(), hiddenIds: string[] = [], conflicts: string[] = [];
  let unverifiedCount = 0;
  if (history.conversations.some(row => row.archivedAt)) blockers.add('ARCHIVED_CONVERSATION');
  for (const row of history.messages) {
    const archive=!!row.metadata&&typeof row.metadata==='object'&&!Array.isArray(row.metadata)&&'historyArchive' in row.metadata;
    const hidden = isSoftDeletedMessage(row.metadata) || Boolean(row.metadata && typeof row.metadata === 'object' && 'deduplicatedIntoMessageId' in row.metadata);
    if (hidden) hiddenIds.push(row.id);
    const origins = history.origins.filter(origin => origin.messageId === row.id);
    if (!origins.length) { unverifiedCount++; continue; }
    const sourceMessages: HistoricalMessage[] = [];let sealedArchive=false;
    for (const origin of origins) {
      const evidence = openHistoryEvidence<OriginEvidence>('ORIGIN', origin.id, origin.payloadEncrypted);
      if(evidence.archivePolicy!==undefined){if(evidence.archivePolicy!=='KEYCRM_SOURCE_ARCHIVE_V1')throw Error('Неизвестная политика исходного архива');sealedArchive=true;}
      const message = normalizeMessage(evidence.raw);
      if (evidence.runId !== origin.runId || evidence.messageId !== row.id || sha256(sourceKey(message)) !== origin.id) throw new Error('Некорректное происхождение сообщения');
      if (message.text.normalize('NFC') !== row.content.normalize('NFC') || message.direction !== row.direction || message.time.utc !== historyMessageTime(row).toISOString() ||
        !['RECEIVED', 'SENT'].includes(row.status) || (message.attachments.length>0&&!(archive&&keycrmArchiveEligible(message))) || history.attachments.some(a => a.messageId === row.id && a.count > 0)) conflicts.push(row.id);
      if (origin.status !== 'APPLIED') blockers.add('PREVIOUS_IMPORT_ROLLED_BACK');
      sourceMessages.push(message);
    }
    if(archive!==sealedArchive)conflicts.push(row.id);
    if(archive){try{if(historyDigest((row.metadata as {historyArchive:unknown}).historyArchive)!==historyDigest(keycrmArchiveMetadata(sourceMessages)))conflicts.push(row.id);}catch{conflicts.push(row.id);}}
    existing.push({ id: row.id, message: sourceMessages[0]!, aliases: sourceMessages.map(sourceKey) });
  }
  if (unverifiedCount) blockers.add('UNVERIFIED_EXISTING_PROVENANCE');
  if (conflicts.length) blockers.add('ORIGIN_CURRENT_MESSAGE_CONFLICT');
  return { existing, blockers: [...blockers].sort(), unverifiedCount, hiddenIds, conflicts: [...new Set(conflicts)], fingerprint: historyDigest(history) };
}

export function planMappedTimeline(rawMessages: unknown[], targets: readonly ResolvedTarget[], histories: ReadonlyMap<string, ProjectedHistory>, archiveInput?:KeycrmArchiveApproval) {
  const archive=archiveInput===undefined?undefined:validateKeycrmArchiveApproval(archiveInput);
  const groups = new Map<string, { raw: unknown[]; targets: ResolvedTarget[] }>();
  const unmapped: string[] = [];
  for (const raw of rawMessages) {
    const m = normalizeMessage(raw), target = targets.find(row => row.dialogueId === m.dialogueId);
    if (!target || target.state === 'REVIEW') { unmapped.push(sourceKey(m)); continue; }
    const group = groups.get(target.groupKey) ?? { raw: [], targets: [] };
    group.raw.push(raw); if (!group.targets.some(row => row.dialogueId === target.dialogueId)) group.targets.push(target);
    groups.set(target.groupKey, group);
  }
  const actions: PlannedAction[] = [], blockers = new Set<string>();
  const byKey=new Map(rawMessages.map(raw=>{const m=normalizeMessage(raw);return[sourceKey(m),m] as const;}));
  if(archive)for(const[left,right]of archive.equivalences){const a=byKey.get(left),b=byKey.get(right),x=targets.find(t=>t.dialogueId===a?.dialogueId),y=targets.find(t=>t.dialogueId===b?.dialogueId);if(!a||!b||!x||!y||x.state==='REVIEW'||y.state==='REVIEW'||x.groupKey!==y.groupKey)throw Error('Подтверждение объединяет разных или неподтверждённых клиентов');}
  let inBatchDuplicates = 0;
  if (unmapped.length) blockers.add('CLIENT_MAPPING_REQUIRED');
  for (const [groupKey, group] of groups) {
    const history = histories.get(groupKey);
    if (!history) { blockers.add('CLIENT_HISTORY_NOT_LOADED'); continue; }
    for (const blocker of history.blockers) blockers.add(blocker);
    if (new Set(group.targets.filter(row => row.state === 'CREATE_PROPOSAL').map(row => row.displayName)).size > 1) blockers.add('CONFLICTING_CLIENT_CREATION_PROPOSALS');
    const groupKeys=new Set(group.raw.map(raw=>sourceKey(normalizeMessage(raw))));
    const scopedArchive=archive?{...archive,equivalences:archive.equivalences.filter(([left])=>groupKeys.has(left))}:undefined;
    const result = planTimelineMerge(group.raw, history.existing,{archive:scopedArchive}); // No inferred provider identity.
    inBatchDuplicates += result.inBatchDuplicates;
    for (const decision of result.decisions) {
      let kind = decision.kind, reason = decision.reason;
      const crossDialogue = result.decisions.some(other => other !== decision && other.message.dialogueId !== decision.message.dialogueId &&
        other.message.account === decision.message.account && other.message.direction === decision.message.direction &&
        (other.message.sender === decision.message.sender || !!archive&&other.message.direction==='INBOUND'&&other.message.sender===`contact:${other.message.dialogueId}`&&decision.message.sender===`contact:${decision.message.dialogueId}`) && other.message.normalizedText === decision.message.normalizedText &&
        other.message.time.utc === decision.message.time.utc && other.message.time.original === decision.message.time.original);
      if (history.conflicts.length) { kind = 'CONFLICT'; reason = 'Существующее сообщение противоречит сохранённому происхождению'; }
      else if (decision.existingId && history.hiddenIds.includes(decision.existingId)) { kind = 'POSSIBLE_DUPLICATE'; reason = 'Сообщение скрыто: повторный импорт не должен возвращать его в интерфейс'; }
      else if (history.blockers.includes('PREVIOUS_IMPORT_ROLLED_BACK')) { kind = 'POSSIBLE_DUPLICATE'; reason = 'Предыдущий импорт отозван; требуется отдельное решение'; }
      else if(kind!=='CONFLICT'&&archive&&!decision.sourceMessages.every(keycrmArchiveEligible)){kind='POSSIBLE_DUPLICATE';reason='Архив требует однозначную исходную минуту и только недоступные файлы';}
      else if (kind !== 'CONFLICT' && ((!archive&&decision.message.attachments.length > 0) || decision.attachmentAdditions.length > 0)) {
        kind = 'POSSIBLE_DUPLICATE'; reason = 'Файлы или дополнение существующего сообщения ещё не проверены сервером';
      }
      else if (kind === 'NEW' && (history.unverifiedCount > 0 || crossDialogue || !archive&&decision.message.attachments.length > 0)) {
        kind = 'POSSIBLE_DUPLICATE'; reason = crossDialogue ? 'Похожее сообщение в другом исходном диалоге: нет подтверждённого общего ID'
          : history.unverifiedCount ? 'История CRM содержит сообщения без проверенного происхождения' : 'Файлы ещё не проверены сервером';
      }
      actions.push({ ...decision, kind, reason, groupKey, clientId: group.targets[0]!.clientId });
    }
  }
  const review = actions.filter(a => a.kind === 'POSSIBLE_DUPLICATE').length + unmapped.length;
  const conflicts = actions.filter(a => a.kind === 'CONFLICT').length;
  if (review) blockers.add('MESSAGE_REVIEW_REQUIRED');
  if (conflicts) blockers.add('MESSAGE_CONFLICTS');
  return { discovered: rawMessages.length, unmapped: unmapped.length, inBatchDuplicates,
    newCandidates: actions.filter(a => a.kind === 'NEW').length, alreadyExists: actions.filter(a => a.kind === 'EXACT_DUPLICATE').length,
    review, conflicts, actions, blockers: [...blockers].sort() };
}
