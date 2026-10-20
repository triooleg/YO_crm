"use client";

import { type ReactNode, type RefObject, useEffect, useState } from 'react';
import { Avatar, Badge, Button, Group, Image, Modal, Paper, Select, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { ordersDashboardUi as ordersUi, designsInstancesUi as designsUi, parentMeasurementsStaffUi as ui } from '../../lib/i18n';
import { basicMeasurementNumbers, additionalMeasurementNumbers, measurementFieldLabels } from '../measurement-definition';
import { measurementSemanticLabel, measurementSemanticNote } from '../../lib/measurement-semantics';
import type { Athlete, ExpandedOrderItem, OrderItemInstanceView } from './order-expanded-tabs';
import type { ParentMeasurementsSubmission, ParentMeasurementsWorkspaceContext } from './parent-measurements-panel';

export type MeasurementsVersion = NonNullable<Athlete['measurements']>[number] & { source?: string | null };
export type MeasurementsAthlete = Athlete & { birthDate?: string | null; discipline?: string | null };
export type MeasurementsSelection = { athlete: MeasurementsAthlete; measurement?: MeasurementsVersion; assignment?: { id: string; item: ExpandedOrderItem; instance?: OrderItemInstanceView; measurement?: MeasurementsVersion } };
export type MeasurementsWorkspaceProps = {
  orderId: string;
  athletes: MeasurementsAthlete[];
  assignedAthleteIds: string[];
  items?: ExpandedOrderItem[];
  focusAthleteId?: string;
  focusInstanceId?: string;
  staff: ParentMeasurementsWorkspaceContext;
  addAthleteButtonRef?: RefObject<HTMLButtonElement | null>;
  onAddAthlete?: () => void;
  onAddManually?: (athlete?: MeasurementsAthlete) => void;
  onEdit?: (selection: MeasurementsSelection) => void;
  renderUsage?: (athleteId: string) => ReactNode;
  renderComment?: (athleteId: string) => ReactNode;
  renderLegacyActions?: (selection: MeasurementsSelection) => ReactNode;
};
export function measurementsAthleteAge(birthDate?: string | null, at = new Date()): number | undefined {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(birthDate)) return undefined;
  const birth = new Date(birthDate);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== birthDate.slice(0, 10)) return undefined;
  const years = at.getFullYear() - birth.getUTCFullYear() - (at.getMonth() < birth.getUTCMonth() || (at.getMonth() === birth.getUTCMonth() && at.getDate() < birth.getUTCDate()) ? 1 : 0);
  return years >= 0 ? years : undefined;
}
const name = (athlete: MeasurementsAthlete) => [athlete.firstName, athlete.lastName].filter(Boolean).join(' ');
const displayDate = (value?: string, time = false) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', ...(time ? { timeStyle: 'short' as const } : {}) }).format(new Date(value)) : ordersUi.notSpecified;
const progress = (values: MeasurementsVersion['values'], numbers: readonly number[]) => numbers.filter(n => values?.[`m${n}`] != null).length;
const progressText = (values: MeasurementsVersion['values']) => `${ui.requiredProgress.replace('{count}', String(progress(values, basicMeasurementNumbers)))} · ${ui.additionalProgress.replace('{count}', String(progress(values, additionalMeasurementNumbers)))}`;
const fromSubmission = (s: ParentMeasurementsSubmission): MeasurementsVersion => ({ id: s.measurementId, athleteId: s.athleteId, measuredAt: s.measuredAt, definitionVersion: s.definitionVersion, notes: s.notes ?? undefined, source: 'PARENT', values: Object.fromEntries(Object.entries(s.values ?? {}).filter((entry): entry is [string, number] => entry[1] != null)) });
const status = (submission?: ParentMeasurementsSubmission, measurement?: MeasurementsVersion, draft = false) => submission ? submission.reviewStatus === 'NEEDS_CLARIFICATION' ? ui.reviews.NEEDS_CLARIFICATION : submission.assignmentStatus === 'ASSIGNED' ? ui.assignments.ASSIGNED : submission.reviewStatus === 'VERIFIED' ? ui.reviews.VERIFIED : ui.receivedStatus : measurement ? ui.receivedStatus : draft ? ui.draftStatus : ui.notReceived;
const source = (submission?: ParentMeasurementsSubmission, measurement?: MeasurementsVersion) => submission || measurement?.source === "PARENT_FORM" || measurement?.source === "PARENT" ? ui.parentSource : (measurement?.source === 'MANUAL' || measurement?.source === 'Ручной ввод' || /^Ростовой стандарт |^Новая версия мерок:/.test(measurement?.source ?? '')) ? ui.manualSource : ['KEYCRM', 'IMPORT'].includes(measurement?.source ?? '') ? ui.importSource : ordersUi.notSpecified;

/** Presentation of canonical athlete snapshots. Staff mutations stay in ParentMeasurementsPanel. */
export function MeasurementsWorkspace({ orderId, athletes, assignedAthleteIds, items = [], focusAthleteId, focusInstanceId, staff, addAthleteButtonRef, onAddAthlete, onAddManually, onEdit, renderUsage, renderComment, renderLegacyActions }: MeasurementsWorkspaceProps) {
  const submissions = staff.data?.submissions ?? [];
  // Exact IDs only: names are never a merge key. Repeated submissions create versions, not athlete rows.
  const roster = [...new Map([...athletes, ...(staff.data?.athletes ?? []).filter(a => !athletes.some(existing => existing.id === a.id)).map(a => ({ id: a.id, firstName: a.firstName, lastName: a.lastName })), ...submissions.filter(s => !athletes.some(a => a.id === s.athleteId) && !staff.data?.athletes?.some(a => a.id === s.athleteId)).map(s => ({ id: s.athleteId, firstName: s.childName }))].map(a => [a.id, a])).values()] as MeasurementsAthlete[];
  const inOrder = new Set([...assignedAthleteIds, ...submissions.map(s => s.athleteId), ...(staff.data?.drafts ?? []).flatMap(d => d.athleteId ? [d.athleteId] : []), ...(staff.data?.manualAthleteIds ?? [])]);
  const [scope, setScope] = useState<string | null>('order');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(focusAthleteId ?? roster[0]?.id);
  const [versionChoice, setVersionChoice] = useState<{ athleteId: string; id: string }>();
  const [showAdditional, setShowAdditional] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [readOnlyOpen, setReadOnlyOpen] = useState(false);
  useEffect(() => { if (focusAthleteId) { setSelectedId(focusAthleteId); setVersionChoice(undefined); } }, [focusAthleteId]);
  const versionsFor = (athlete: MeasurementsAthlete): MeasurementsVersion[] => {
    const candidates: MeasurementsVersion[] = [
      ...(athlete.measurements ?? []),
      ...items.flatMap(item => [...(item.instances ?? []).flatMap(i => i.athlete?.id === athlete.id && i.measurement?.athleteId === athlete.id ? [i.measurement] : []), ...(item.athlete?.id === athlete.id && item.measurement?.athleteId === athlete.id ? [item.measurement] : [])]),
      ...submissions.filter(s => s.athleteId === athlete.id).map(fromSubmission),
    ];
    const versions = new Map<string, MeasurementsVersion>();
    for (const version of candidates) if (version.athleteId === athlete.id) versions.set(version.id, { ...versions.get(version.id), ...version });
    return [...versions.values()].sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
  };
  const scoped = roster.filter(a => (!a.archivedAt || inOrder.has(a.id)) && (scope !== 'order' || inOrder.has(a.id)));
  const selected = scoped.find(a => a.id === selectedId) ?? scoped[0];
  const history = selected ? versionsFor(selected) : [];
  const focusedInstance = items.flatMap(item => item.instances ?? []).find(i => i.id === focusInstanceId && i.athlete?.id === selected?.id);
  const measurement = history.find(m => m.id === (versionChoice?.athleteId === selected?.id ? versionChoice?.id : focusedInstance?.measurement?.id)) ?? history[0];
  const submission = submissions.find(s => s.measurementId === measurement?.id && s.athleteId === selected?.id);
  const latestSubmission = (athleteId: string) => submissions.find(s => s.athleteId === athleteId);
  const latestDraft = (athleteId: string) => staff.data?.drafts?.some(d => d.athleteId === athleteId) ?? false;
  const assignments = selected ? items.flatMap<NonNullable<MeasurementsSelection['assignment']>>(item => item.instances?.length ? item.instances.filter(i => !i.archivedAt && i.athlete?.id === selected.id).map(i => ({ id: i.id, item, instance: i, measurement: i.measurement ?? undefined })) : item.athlete?.id === selected.id ? [{ id: item.id, item, instance: undefined, measurement: item.measurement }] : []) : [];
  const [assignmentId, setAssignmentId] = useState(focusInstanceId ?? '');
  useEffect(() => { if (focusInstanceId) setAssignmentId(focusInstanceId); }, [focusInstanceId]);
  const assignment = assignments.find(a => a.id === assignmentId) ?? assignments.find(a => a.measurement?.id === measurement?.id) ?? assignments[0];
  const selection: MeasurementsSelection | undefined = selected ? { athlete: selected, measurement, assignment } : undefined;
  const assignmentStatus=submission?.assignmentStatus??(items.some(item=>item.measurement?.id===measurement?.id||item.instances?.some(i=>!i.archivedAt&&i.measurement?.id===measurement?.id))&&measurement?"ASSIGNED":"UNASSIGNED");
  const selectedStatus = status(submission, measurement, selected ? latestDraft(selected.id) : false);
  const age = submission?.provenance?.ageYears ?? measurementsAthleteAge(selected?.birthDate);
  const photoUrl = submission?.hasPhoto ? `/api/orders/${encodeURIComponent(orderId)}/parent-measurements/submissions/${encodeURIComponent(submission.id)}/photo` : undefined;
  const receivedCount = scoped.filter(a => versionsFor(a).length > 0).length;
  const reviews = new Map<string, ParentMeasurementsSubmission>();
  for (const s of submissions) if (!reviews.has(s.athleteId)) reviews.set(s.athleteId, s);
  const reviewCount = [...reviews.values()].filter(s => scoped.some(a => a.id === s.athleteId) && s.reviewStatus !== 'VERIFIED').length;
  const field = (number: number, required: boolean) => {
    const value = measurement?.values?.[`m${number}`];
    const warnings = submission?.warnings?.filter(w => w.startsWith(`№${number}:`)) ?? [];
    return <div key={number} className={`orders-measurements-value ${required ? 'is-required' : 'is-additional'}`} data-measurement-required={required} data-measurement-number={number}>
      <span className={`orders-measurements-number number-${number}`}>{number}</span>
      <span className="orders-measurements-label">{measurementSemanticLabel(number, measurementFieldLabels[number - 1]!, measurement?.definitionVersion)}</span>
      <strong>{value == null ? ui.requiredMissing : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} ${ui.cm}`}</strong>
      <span className={`orders-measurements-presence ${value == null ? 'is-empty' : ''}`} aria-label={value == null ? ui.requiredMissing : ordersUi.measurementsReceivedCount}>{value == null ? '—' : '✓'}</span>
      {warnings.map(w => <Text key={w} className="orders-measurements-warning" size="xs" c="orange.9">{w}</Text>)}
    </div>;
  };
  return <div className="orders-measurements-png" aria-label={ui.workspaceTitle}>
    <header className="orders-measurements-intake">
      <div><Title order={4}>{ui.workspaceTitle}</Title><Group gap="md"><Text size="xs">{ui.athleteCount}: <b>{scoped.length}</b></Text><Text size="xs">{ui.receivedCount}: <b>{receivedCount}</b></Text><Text size="xs">{ui.awaitingCount}: <b>{scoped.length - receivedCount}</b></Text><Text size="xs">{ui.reviewCount}: <b>{reviewCount}</b></Text></Group></div>
      <Group gap="xs"><Button size="compact-sm" variant="light" onClick={staff.requestInvitations}>{ui.title}</Button>{onAddManually && <Button size="compact-sm" variant="default" disabled={staff.busy} onClick={() => onAddManually(selected)}>{ui.addManually}</Button>}<Button size="compact-sm" variant="default" disabled={staff.loading || staff.busy} onClick={staff.refresh}>{ui.refresh}</Button></Group>
    </header>
    {staff.feedback}
    {staff.loading && <Text role="status" size="sm">{ui.loading}</Text>}
    <div className="orders-measurements-columns">
      <aside className="orders-measurements-roster">
        <Group justify="space-between" mb="sm"><Title order={5}>{ordersUi.athletesInOrder}</Title><Badge variant="light">{scoped.length}</Badge></Group>
        <Select size="xs" mb="xs" aria-label={designsUi.athletes} value={scope} onChange={setScope} disabled={staff.busy} allowDeselect={false} data={[{ value: 'order', label: designsUi.orderScope }, { value: 'client', label: designsUi.clientScope }]} />
        <TextInput size="xs" aria-label={ordersUi.searchAthletes} placeholder={ordersUi.searchAthletes} value={query} onChange={e => setQuery(e.currentTarget.value)} mb="xs" />
        <div className="orders-measurements-roster-list">{scoped.filter(a => name(a).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).map(a => {
          const versions = versionsFor(a), version = versions[0], latest = submissions.find(s=>s.athleteId===a.id&&s.measurementId===version?.id);
          const athleteAge = latest?.provenance?.ageYears ?? measurementsAthleteAge(a.birthDate);
          const athletePhoto = latest?.hasPhoto ? `/api/orders/${encodeURIComponent(orderId)}/parent-measurements/submissions/${encodeURIComponent(latest.id)}/photo` : undefined;
          const sport = latest?.discipline ?? a.discipline;
          return <UnstyledButton key={a.id} data-athlete-id={a.id} className={`orders-measurements-athlete ${a.id === selected?.id ? 'is-selected' : ''}`} disabled={staff.busy} aria-pressed={a.id === selected?.id} onClick={() => { setSelectedId(a.id); setVersionChoice(undefined); setReadOnlyOpen(false); }}>
            <Avatar src={athletePhoto} alt={name(a)} size={52} radius="50%">{name(a).split(/\s+/).slice(0, 2).map(p => p[0]).join('')}</Avatar>
            <span><strong>{name(a)}{a.archivedAt ? ` · ${designsUi.archived}` : ''}</strong><small>{[athleteAge != null ? ui.ageYears.replace('{age}', String(athleteAge)) : null, sport ? ui.disciplines[sport as keyof typeof ui.disciplines] ?? ui.unknownStatus : null].filter(Boolean).join(' · ')}</small><span className="orders-measurements-athlete-status"><Badge color={latest?.reviewStatus === 'NEEDS_CLARIFICATION' ? 'orange' : version ? 'green' : 'gray'} size="xs" variant="light">{status(latest, version, latestDraft(a.id))}</Badge><small>{version ? displayDate(version.measuredAt) : '—'}</small></span><small>{progressText(version?.values)}</small></span>
          </UnstyledButton>;
        })}</div>
        {onAddAthlete && <Button ref={addAthleteButtonRef} fullWidth mt="sm" variant="default" size="sm" disabled={staff.busy} onClick={onAddAthlete}>＋ {ordersUi.addAthlete}</Button>}
      </aside>
      <main className="orders-measurements-athlete-workspace">
        {selected ? <>
          <header className="orders-measurements-athlete-header">
            <Group gap="md" wrap="nowrap"><Avatar src={photoUrl} alt={name(selected)} size={66} radius="50%">{name(selected).split(/\s+/).slice(0, 2).map(p => p[0]).join('')}</Avatar><div><Title order={3}>{name(selected)}</Title>{age != null && <Text size="sm" c="dimmed">{ui.ageYears.replace('{age}', String(age))}</Text>}</div></Group>
            {(submission?.discipline ?? selected.discipline) && <Badge size="lg" variant="outline" className="orders-measurements-sport">{ui.disciplines[(submission?.discipline ?? selected.discipline) as keyof typeof ui.disciplines] ?? ui.unknownStatus}</Badge>}
            <div className="orders-measurements-header-actions"><Badge color={submission?.reviewStatus === 'NEEDS_CLARIFICATION' ? 'orange' : measurement ? 'green' : 'gray'} variant="light" size="lg">{selectedStatus}</Badge><Text size="xs" c="dimmed">{measurement ? displayDate(measurement.measuredAt) : ordersUi.noMeasurements} · {source(submission, measurement)}</Text><Group gap="xs"><Button size="compact-sm" variant="default" onClick={() => setHistoryOpen(true)}>{ordersUi.measurementHistory}</Button>{onEdit && !selected.archivedAt && <Button size="compact-sm" variant="default" disabled={staff.busy} onClick={() => selection && onEdit(selection)}>{ordersUi.editMeasurements}</Button>}</Group></div>
          </header>
          {assignments.length > 1 && <Select size="xs" label={ordersUi.measurementProductSelection} value={assignment?.id ?? null} disabled={staff.busy} onChange={id => setAssignmentId(id ?? '')} data={assignments.map(a => ({ value: a.id, label: `${a.item.name} · ${a.instance ? `№${a.instance.ordinal}` : ordersUi.measurementAssignmentAtDesignLevel}` }))} />}
          <div className="orders-measurements-section-heading"><strong>{ui.requiredMeasurements}</strong><span>{progressText(measurement?.values)}</span></div>
          <div className="orders-measurements-required-grid">{basicMeasurementNumbers.map(n => field(n, true))}</div>
          <div className="orders-measurements-section-heading"><strong>{ui.additionalMeasurements} ({progress(measurement?.values, additionalMeasurementNumbers)}/13)</strong><Button size="compact-xs" variant="subtle" data-additional-toggle aria-expanded={showAdditional} aria-controls={`measurements-additional-${orderId}`} onClick={() => setShowAdditional(value => !value)}>{showAdditional ? ui.hideParameters : ui.showAll} {showAdditional ? '⌃' : '⌄'}</Button></div>
          {showAdditional && <div className="orders-measurements-additional-grid" id={`measurements-additional-${orderId}`}>{additionalMeasurementNumbers.map(n => field(n, false))}</div>}
          {measurementSemanticNote(measurement?.definitionVersion) && <Text size="xs" c="dimmed" mt="xs" role="note">{measurementSemanticNote(measurement?.definitionVersion)}</Text>}
          {measurement?.notes && <Paper withBorder p="xs" mt="sm"><Text size="xs" fw={600}>{submission ? ui.notes : ordersUi.shortNotes}</Text><Text size="sm" className="orders-measurements-parent-note">{measurement.notes}</Text></Paper>}
          {measurement && <Group gap="xs" m="xs">{submission&&<Badge variant="light">{ui.reviews[submission.reviewStatus as keyof typeof ui.reviews] ?? ui.unknownStatus}</Badge>}<Badge variant="outline">{ui.assignments[assignmentStatus as keyof typeof ui.assignments] ?? ui.unknownStatus}</Badge></Group>}
          {submission && <div className="orders-measurements-review-actions">{staff.submissionActions(submission.id)}</div>}
          {selection && renderLegacyActions?.(selection)}
        </> : <Text size="sm" c="dimmed">{ordersUi.noAthletesInOrder}</Text>}
      </main>
      <aside className="orders-measurements-information">
        <Paper withBorder p="sm"><Title order={5} mb="sm">{ui.information}</Title><dl>
          <div><dt>{ui.receivedAt}</dt><dd>{displayDate(submission?.provenance?.submittedAt, true)}</dd></div>
          <div><dt>{ui.mode}</dt><dd>{ui.modes[submission?.provenance?.invitationMode as keyof typeof ui.modes] ?? ordersUi.notSpecified}</dd></div>
          <div><dt>{ui.locale}</dt><dd>{ui.locales[submission?.provenance?.locale as keyof typeof ui.locales] ?? ordersUi.notSpecified}</dd></div>
          <div><dt>{ui.units}</dt><dd>{submission?.provenance?.units === 'cm' ? ui.cm : submission?.provenance?.units === 'in' ? ui.inches : ordersUi.notSpecified}</dd></div>
          <div><dt>{ui.source}</dt><dd>{source(submission, measurement)}</dd></div>
          <div><dt>{ui.filledBy}</dt><dd>{submission ? ui.parentAuthor : ordersUi.notSpecified}</dd></div>
          <div><dt>{ui.discipline}</dt><dd>{ui.disciplines[(submission?.discipline ?? selected?.discipline) as keyof typeof ui.disciplines] ?? ordersUi.notSpecified}</dd></div>
          <div><dt>{ui.verify}</dt><dd>{submission ? ui.reviews[submission.reviewStatus as keyof typeof ui.reviews] ?? ui.unknownStatus : ordersUi.notSpecified}</dd></div>
          <div><dt>{ordersUi.usedInProducts}</dt><dd>{measurement ? ui.assignments[assignmentStatus as keyof typeof ui.assignments] ?? ui.unknownStatus : ordersUi.notSpecified}</dd></div>
        </dl>{submission && <Button fullWidth size="compact-sm" variant="default" onClick={() => setReadOnlyOpen(true)}>{ui.readOnlySubmission} ↗</Button>}</Paper>
        {photoUrl && <Paper withBorder p="sm"><Title order={5} mb="sm">{ui.athletePhoto}</Title><a href={photoUrl} target="_blank" rel="noopener noreferrer"><Image src={photoUrl} alt={`${ui.athletePhoto}: ${selected ? name(selected) : ''}`} h={170} fit="contain" /></a></Paper>}
        {selected && <Paper withBorder p="sm"><Title order={5} mb="xs">{ordersUi.usedInProducts}</Title>{renderUsage?.(selected.id)}</Paper>}
        <Paper withBorder p="sm"><Title order={5} mb="xs">{ordersUi.measurementHistory}</Title>{history.slice(0, 3).map(m => <UnstyledButton key={m.id} className="orders-measurements-history-entry" disabled={staff.busy} onClick={() => selected && setVersionChoice({ athleteId: selected.id, id: m.id })}><i /><span><strong>{displayDate(m.measuredAt)}</strong><small>{m.id === measurement?.id ? ordersUi.currentVersion : ordersUi.version} · {m.id}</small></span></UnstyledButton>)}{history.length > 3 && <Button size="compact-xs" variant="subtle" onClick={() => setHistoryOpen(true)}>{ui.allHistory}</Button>}</Paper>
      </aside>
    </div>
    {selected && <div className="orders-measurements-bottom">{renderComment?.(selected.id)}<Paper withBorder p="sm"><Title order={5} mb="xs">{ordersUi.measurementHistory}</Title>{history.slice(0, 5).map(m => <div key={m.id} className="orders-measurements-history-entry"><i /><span><strong>{displayDate(m.measuredAt)}</strong><small>{source(submissions.find(s => s.measurementId === m.id), m)} · {progressText(m.values)}</small></span></div>)}</Paper></div>}
    <Modal opened={historyOpen} onClose={() => setHistoryOpen(false)} title={ordersUi.measurementHistory} size="lg" closeButtonProps={{ 'aria-label': ui.close }}><Stack gap="xs">{history.map(m => <Button key={m.id} variant={m.id === measurement?.id ? 'light' : 'default'} disabled={staff.busy} onClick={() => { if (selected) setVersionChoice({ athleteId: selected.id, id: m.id }); setHistoryOpen(false); }}>{displayDate(m.measuredAt)} · {m.id} · {progressText(m.values)}</Button>)}{!history.length && <Text>{ordersUi.noMeasurementHistory}</Text>}</Stack></Modal>
    <Modal opened={readOnlyOpen && !!submission} onClose={() => setReadOnlyOpen(false)} title={ui.readOnlySubmission} size="lg" closeButtonProps={{ 'aria-label': ui.close }}>
      {submission && <Stack gap="sm"><Text fw={600}>{submission.childName} · {displayDate(submission.measuredAt)}</Text><Text size="xs">{submission.measurementId} · {source(submission)}</Text><div className="orders-measurements-readonly-grid">{[...basicMeasurementNumbers, ...additionalMeasurementNumbers].map(n => field(n, basicMeasurementNumbers.includes(n)))}</div>{submission.notes && <Text size="sm">{ui.notes}: {submission.notes}</Text>}{photoUrl && <Button component="a" href={photoUrl} target="_blank" rel="noopener noreferrer" variant="default">{ui.viewPhoto}</Button>}</Stack>}
    </Modal>
  </div>;
}
