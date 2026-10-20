"use client";

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Image, Modal, Paper, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { parentMeasurementsStaffUi as ui } from '../../lib/i18n';
import { basicMeasurementNumbers } from '../measurement-definition';
import { measurementLinkQrDataUrl } from '../../lib/parent-measurements-qr';

export type ParentMeasurementsInstance = { id: string; updatedAt: string; ordinal: number; designName: string; productionStatus: string; startedAt?: string | null; completedAt?: string | null; shippedAt?: string | null };
export type ParentMeasurementsChild = { id: string; revision: number; childName: string; submitted: boolean };
export type ParentMeasurementsAthlete = { id: string; displayName: string };
export type ParentMeasurementsPanelProps = {
  orderId: string;
  compact?: boolean;
  renderWorkspace?: (context: ParentMeasurementsWorkspaceContext) => ReactNode;
  onUpdated?: () => void | Promise<void>;
  onDraftMessage?: (text: string) => void;
  instances?: ParentMeasurementsInstance[];
  /** Both lists must be scoped by the host to this order's current client. */
  children?: ParentMeasurementsChild[];
  athletes?: ParentMeasurementsAthlete[];
};
type Invitation = { id: string; mode: string; expiresAt: string; revokedAt: string | null; admittedCount: number };
export type ParentMeasurementsSubmission = {
  id: string; childName: string; measuredAt: string; measurementId: string; athleteId: string;
  reviewStatus: string; assignmentStatus: string; definitionVersion: string | null;
  hasPhoto?: boolean; discipline?: string | null; values: Record<string, number | null>; notes?: string | null;
  warnings: string[]; updatedAt: string;
  provenance?: { submittedAt?: string; invitationMode?: string; locale?: string; units?: string; ageYears?: number | null; source?: 'PARENT' };
};
export type ParentMeasurementsPanelData = {
  invitations: Invitation[]; submissions: ParentMeasurementsSubmission[]; expectedPieces: number;
  manualAthleteIds?: string[];
  drafts?: { id: string; revision: number; firstName: string; athleteId: string | null }[];
  athletes?: { id: string; firstName: string; lastName?: string | null }[];
};
export type ParentMeasurementsWorkspaceContext = {
  data: ParentMeasurementsPanelData | null;
  loading: boolean;
  busy: boolean;
  feedback: ReactNode;
  requestInvitations: () => void;
  refresh: () => void;
  submissionActions: (submissionId: string) => ReactNode;
};
type Submission = ParentMeasurementsSubmission;
type PanelData = ParentMeasurementsPanelData;
type Assignment = { targets: { id: string; expectedUpdatedAt: string }[]; confirmProduction?: boolean; reason?: string; operationKey: string };
type Editor = { submission: Submission; instances: ParentMeasurementsInstance[]; kind: 'assign' | 'VERIFIED' | 'NEEDS_CLARIFICATION' };
class StaffRequestError extends Error { constructor(public status: number) { super(status === 409 ? ui.conflict : ui.error); } }
const label = (labels: Record<string, string>, code: string) => labels[code] ?? ui.unknownStatus;
const dateLabel = (value: string) => Number.isNaN(Date.parse(value)) ? ui.unknownStatus : new Date(value).toLocaleDateString('ru-RU');
const started = (status: string) => ['MATERIALS', 'CUTTING', 'SEWING', 'DECORATION', 'QUALITY_CONTROL', 'ON_HOLD'].includes(status);
const eligible = (status: string) => ['NOT_SCHEDULED', 'TENTATIVE', 'SCHEDULED'].includes(status) || started(status);
const assignable = (instance: ParentMeasurementsInstance) => !instance.completedAt && !instance.shippedAt && eligible(instance.productionStatus);
const needsConfirmation = (instance: ParentMeasurementsInstance) => !!instance.startedAt || started(instance.productionStatus);

// Remount private link/editor state when the host switches orders.
export function ParentMeasurementsPanel(props: ParentMeasurementsPanelProps) {
  return <OrderParentMeasurementsPanel key={props.orderId} {...props} />;
}

function OrderParentMeasurementsPanel({ renderWorkspace, compact = false, orderId, onUpdated, onDraftMessage, instances, children, athletes }: ParentMeasurementsPanelProps) {
  const [managementOpen, setManagementOpen] = useState(false);
  const [expandedSubmissions, setExpandedSubmissions] = useState<string[]>([]);
  const [data, setData] = useState<PanelData | null>(null), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [mode, setMode] = useState('SHARED'), [locale, setLocale] = useState<string | null>(null);
  const [days,setDays]=useState('14');
  const [issued, setIssued] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [qrOpen, setQrOpen] = useState(false), [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false), [qrError, setQrError] = useState(false);
  const qrSequence = useRef(0);
  const [revoking, setRevoking] = useState<string | null>(null), [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [reason, setReason] = useState(''), [confirmProduction, setConfirmProduction] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [bindingChild, setBindingChild] = useState<ParentMeasurementsChild | null>(null), [bindingAthlete, setBindingAthlete] = useState<string | null>(null);
  const [bindingReason, setBindingReason] = useState(''), [bindingConfirmed, setBindingConfirmed] = useState(false);
  const [boundChildren, setBoundChildren] = useState<string[]>([]);
  const [bindingOpen, setBindingOpen] = useState(false);
  const flight = useRef(false), alive = useRef(true), readSequence = useRef(0);
  const pendingAssignment = useRef<{ submissionId: string; body: Assignment } | null>(null);
  const base = `/api/orders/${encodeURIComponent(orderId)}/parent-measurements`;
  const bindingChildren = children ?? data?.drafts?.map(draft => ({ id: draft.id, revision: draft.revision, childName: draft.firstName, submitted: false }));
  const bindingAthletes = athletes ?? data?.athletes?.map(athlete => ({ id: athlete.id, displayName: [athlete.firstName, athlete.lastName].filter(Boolean).join(' ') }));

  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}${path}`, { credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    if (!response.ok) throw new StaffRequestError(response.status);
    return response.json() as Promise<T>;
  }
  async function load() {
    const sequence = ++readSequence.current;
    if (alive.current) setLoading(true);
    try { const next = await request<PanelData>('/'); if (alive.current && sequence === readSequence.current) { setData(next); setNeedsRefresh(false); } }
    finally { if (alive.current && sequence === readSequence.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    void load().catch(() => { if (alive.current) setError(ui.error); });
    return () => { alive.current = false; readSequence.current++; };
  }, []); // Order identity is the key of this component.

  async function refreshed() {
    try { await load(); if (alive.current) await onUpdated?.(); }
    catch { if (alive.current) setError(ui.refreshError); }
  }
  async function mutate(action: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof StaffRequestError ? failure.message : ui.error); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  async function createInvitation() {
    await mutate(async () => {
      let result: NonNullable<typeof issued>;
      try { result = await request('/invitations', { mode, days: Number(days), ...(locale ? { locale } : {}) }); }
      catch (failure) { if (!(failure instanceof StaffRequestError)) { if (alive.current) setError(ui.createUncertain); return; } throw failure; }
      if (!alive.current) return;
      closeQr(); setIssued(result); await refreshed();
    });
  }
  function closeQr() {
    qrSequence.current++; setQrOpen(false); setQrDataUrl(null); setQrLoading(false); setQrError(false);
  }
  async function showQr() {
    if (!issued) return;
    const sequence = ++qrSequence.current;
    setQrOpen(true); setQrDataUrl(null); setQrError(false); setQrLoading(true);
    try {
      const result = await measurementLinkQrDataUrl(issued.url);
      if (alive.current && sequence === qrSequence.current) setQrDataUrl(result);
    } catch {
      if (alive.current && sequence === qrSequence.current) setQrError(true);
    } finally {
      if (alive.current && sequence === qrSequence.current) setQrLoading(false);
    }
  }
  function openEditor(submission: Submission, kind: Editor['kind']) {
    if (flight.current || uncertain || needsRefresh) return;
    setEditor({ submission: { ...submission }, kind, instances: (instances ?? []).map(i => ({ ...i })) });
    setSelected([]); setReason(''); setConfirmProduction(false); setError(''); setNotice('');
  }
  async function saveReview() {
    if (!editor || editor.kind === 'assign') return;
    if (editor.kind === 'NEEDS_CLARIFICATION' && !reason.trim()) { setError(ui.reasonRequired); return; }
    await mutate(async () => {
      try { await request(`/submissions/${encodeURIComponent(editor.submission.id)}/review`, {
          expectedUpdatedAt: editor.submission.updatedAt, status: editor.kind, ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
      } catch (failure) {
        if (alive.current && failure instanceof StaffRequestError && failure.status === 409) { setEditor(null); setNeedsRefresh(true); }
        throw failure;
      }
      if (!alive.current) return;
      setEditor(null); setNotice(ui.saved); await refreshed();
    });
  }
  async function saveAssignment() {
    if (!editor || editor.kind !== 'assign') return;
    if (!pendingAssignment.current) {
      const targets = editor.instances.filter(i => selected.includes(i.id) && assignable(i));
      if (!targets.length) { setError(ui.noTargets); return; }
      const production = targets.some(needsConfirmation);
      if (production && (!confirmProduction || !reason.trim())) { setError(ui.productionRequired); return; }
      pendingAssignment.current = { submissionId: editor.submission.id, body: {
        targets: targets.map(i => ({ id: i.id, expectedUpdatedAt: i.updatedAt })),
        ...(production ? { confirmProduction: true } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}), operationKey: crypto.randomUUID(),
      } };
    }
    await mutate(async () => {
      const operation = pendingAssignment.current!;
      try { await request(`/submissions/${encodeURIComponent(operation.submissionId)}/assign`, operation.body); }
      catch (failure) {
        if (alive.current) {
          // A lost response or 5xx can follow a committed transaction. Keep the exact command for retry.
          if (!(failure instanceof StaffRequestError) || failure.status >= 500) { setUncertain(true); setError(ui.uncertainAssignment); return; }
          pendingAssignment.current = null; setUncertain(false);
          if (failure.status === 409) { setEditor(null); setNeedsRefresh(true); }
        }
        throw failure;
      }
      pendingAssignment.current = null;
      if (!alive.current) return;
      setUncertain(false); setEditor(null); setNotice(ui.saved); await refreshed();
    });
  }

  async function bindAthlete() {
    if (needsRefresh) return;
    if (!bindingChild || bindingChild.submitted || boundChildren.includes(bindingChild.id) ||
      !bindingChildren?.some(child => child.id === bindingChild.id && !child.submitted) ||
      !bindingAthletes?.some(athlete => athlete.id === bindingAthlete) || !bindingConfirmed || !bindingReason.trim()) {
      setError(ui.bindRequired); return;
    }
    await mutate(async () => {
      try { await request(`/children/${encodeURIComponent(bindingChild.id)}/bind`, {
          athleteId: bindingAthlete, reason: bindingReason.trim(), expectedRevision: bindingChild.revision, representativeVerified: true,
        });
      } catch (failure) {
        if (alive.current && (!(failure instanceof StaffRequestError) || failure.status === 409 || failure.status >= 500)) {
          setBindingOpen(false); setBindingChild(null); setBindingConfirmed(false); setNeedsRefresh(true);
        }
        throw failure;
      }
      if (!alive.current) return;
      setBoundChildren(current => [...current, bindingChild.id]);
      setBindingChild(null); setBindingAthlete(null); setBindingReason(''); setBindingConfirmed(false);
      setBindingOpen(false);
      setNotice(ui.bindingSaved); await refreshed();
    });
  }

  function submissionActions(submissionId: string) {
    const submission = data?.submissions.find(row => row.id === submissionId);
    if (!submission) return null;
    return <Stack gap="xs">
      <Group gap="xs"><Button size="compact-sm" variant="light" disabled={busy || uncertain || needsRefresh || !!editor} onClick={() => openEditor(submission, 'VERIFIED')}>{ui.verify}</Button>
        <Button size="compact-sm" variant="default" disabled={busy || uncertain || needsRefresh || !!editor} onClick={() => openEditor(submission, 'NEEDS_CLARIFICATION')}>{ui.clarify}</Button>
        <Button size="compact-sm" variant="default" disabled={busy || uncertain || needsRefresh || !!editor || !instances?.some(assignable)} onClick={() => openEditor(submission, 'assign')}>{ui.assign}</Button></Group>
      {!instances && <Text size="xs" c="dimmed">{ui.noInstances}</Text>}
      {editor?.submission.id === submission.id && <Stack gap="xs">
        {editor.kind === 'assign' && <><Text size="sm" fw={600}>{ui.targets}</Text>
          {editor.instances.filter(assignable).map(i => <Checkbox key={i.id} label={`${i.designName} · №${i.ordinal} · ${label(ui.productionStatuses, i.productionStatus)}`} checked={selected.includes(i.id)} disabled={busy || uncertain} onChange={event => { const checked = event.currentTarget.checked; setSelected(current => checked ? [...new Set([...current, i.id])] : current.filter(id => id !== i.id)); setConfirmProduction(false); }} />)}
          {editor.instances.some(i => selected.includes(i.id) && needsConfirmation(i)) && <Checkbox label={ui.productionConfirm} checked={confirmProduction} disabled={busy || uncertain} onChange={event => setConfirmProduction(event.currentTarget.checked)} />}
        </>}
        <Textarea label={ui.reason} maxLength={2000} value={reason} disabled={busy || uncertain} onChange={event => setReason(event.currentTarget.value)} />
        <Group><Button disabled={busy} onClick={editor.kind === 'assign' ? saveAssignment : saveReview}>{editor.kind === 'assign' ? uncertain ? ui.retryAssignment : ui.saveAssignment : ui.saveReview}</Button>
          <Button variant="default" disabled={busy || uncertain} onClick={() => { setEditor(null); pendingAssignment.current = null; }}>{ui.cancel}</Button></Group>
      </Stack>}
    </Stack>;
  }

  const management = <>
    <SimpleGrid cols={{ base: 1, sm: compact ? 2 : 4 }}>
      <Select label={ui.mode} value={mode} disabled={busy || uncertain} allowDeselect={false} data={Object.entries(ui.modes).map(([value, text]) => ({ value, label: text }))} onChange={value => setMode(value ?? 'SHARED')} />
      <Select clearable label={ui.locale} placeholder={ui.autoLocale} value={locale} disabled={busy || uncertain} data={Object.entries(ui.locales).map(([value, text]) => ({ value, label: text }))} onChange={setLocale} />
      <Select label={ui.lifetime} value={days} allowDeselect={false} disabled={busy||uncertain} data={Object.entries(ui.lifetimes).map(([value,label])=>({value,label}))} onChange={value=>setDays(value??'14')} />
      <Button disabled={loading || busy || uncertain || !!editor} loading={busy} onClick={createInvitation}>{ui.create}</Button>
    </SimpleGrid>
    <Text size="xs" c="dimmed">{ui.duration}</Text>
    {bindingChildren && bindingAthletes && <>
      <Button size="compact-sm" variant="subtle" disabled={busy || uncertain || needsRefresh || !!editor || !bindingChildren.some(child => !child.submitted && !boundChildren.includes(child.id)) || !bindingAthletes.length} onClick={() => { setBindingChild(null); setBindingAthlete(null); setBindingReason(''); setBindingConfirmed(false); setError(''); setBindingOpen(true); }}>{ui.bindingAction}</Button>
      <Modal opened={bindingOpen} title={ui.binding} onClose={() => { if (!busy) setBindingOpen(false); }} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ disabled: busy, 'aria-label': ui.close }}><Stack gap="xs">
      {error && <Alert color="red" role="alert">{error}</Alert>}
      <Select label={ui.bindChild} value={bindingChild?.id ?? null} disabled={busy || uncertain || !!editor} data={bindingChildren.filter(child => !child.submitted && !boundChildren.includes(child.id)).map(child => ({ value: child.id, label: child.childName }))} onChange={id => { setBindingChild(bindingChildren.find(child => child.id === id) ?? null); setBindingConfirmed(false); }} />
      <Select label={ui.bindAthlete} searchable value={bindingAthlete} disabled={busy || uncertain || !!editor} data={bindingAthletes.map(athlete => ({ value: athlete.id, label: athlete.displayName }))} onChange={id => { setBindingAthlete(id); setBindingConfirmed(false); }} />
      <Textarea label={ui.bindReason} maxLength={2000} value={bindingReason} disabled={busy || uncertain || !!editor} onChange={event => setBindingReason(event.currentTarget.value)} />
      <Checkbox label={ui.bindConfirmed} checked={bindingConfirmed} disabled={busy || uncertain || !!editor} onChange={event => setBindingConfirmed(event.currentTarget.checked)} />
      <Button disabled={busy || uncertain || !!editor} onClick={bindAthlete}>{ui.bind}</Button>
      <Text size="xs" c="dimmed">{ui.bindHistory}</Text>
    </Stack></Modal></>}
    {issued && <Paper withBorder p="sm"><Stack gap="xs">
      <TextInput label={ui.link} readOnly value={issued.url} />
      <Text size="xs">{ui.oneTime}</Text>
      <Group><Button size="compact-sm" variant="light" onClick={async () => { try { await navigator.clipboard.writeText(issued.url); if (alive.current) setNotice(ui.copied); } catch { if (alive.current) setError(ui.error); } }}>{ui.copy}</Button>
        <Button size="compact-sm" variant="light" onClick={showQr}>{ui.qr}</Button>
        <Button size="compact-sm" variant="default" disabled={!onDraftMessage} onClick={() => { if (!onDraftMessage) return; try { onDraftMessage(`${ui.inviteMessage}\n${issued.url}`); setNotice(ui.draftInserted); } catch { setError(ui.error); } }}>{ui.draftMessage}</Button></Group>
      {!onDraftMessage && <Text size="xs" c="dimmed">{ui.draftUnavailable}</Text>}
      <Modal opened={qrOpen} title={ui.qr} size="sm" onClose={closeQr} closeButtonProps={{ 'aria-label': ui.close }}><Stack gap="sm">
        {qrLoading && <Text role="status" size="sm">{ui.qrLoading}</Text>}
        {qrError && <><Alert color="red" role="alert">{ui.qrError}</Alert><Button onClick={showQr}>{ui.qrRetry}</Button></>}
        {qrDataUrl && <Image src={qrDataUrl} alt={ui.qrAlt} w="100%" maw={320} mx="auto" fit="contain" />}
      </Stack></Modal>
    </Stack></Paper>}
    <Text fw={600} size="sm">{ui.invitations}</Text>
    {loading && <Text size="sm" role="status">{ui.loading}</Text>}
    {!loading && data?.invitations.length === 0 && <Text size="sm" c="dimmed">{ui.noInvitations}</Text>}
    {data?.invitations.map(invitation => <Paper key={invitation.id} withBorder p="xs"><Group justify="space-between">
      <Stack gap={2}><Text size="sm">{label(ui.modes, invitation.mode)} · {ui.expires} {dateLabel(invitation.expiresAt)}</Text>
        <Text size="xs" c="dimmed">{ui.admitted}: {invitation.admittedCount} · {invitation.revokedAt ? ui.revoked : Date.parse(invitation.expiresAt) <= Date.now() ? ui.expired : ui.active}</Text></Stack>
      <Button size="compact-sm" variant="subtle" color="red" disabled={busy || uncertain || !!editor || !!invitation.revokedAt} onClick={() => setRevoking(invitation.id)}>{ui.revoke}</Button>
    </Group>{revoking === invitation.id && <Stack gap="xs" mt="xs"><Text size="sm">{ui.revokeConfirm}</Text><Group>
      <Button size="compact-sm" color="red" disabled={busy} onClick={() => mutate(async () => { await request(`/invitations/${encodeURIComponent(invitation.id)}/revoke`, {}); if (!alive.current) return; if (issued?.id === invitation.id) { closeQr(); setIssued(null); } setRevoking(null); setNotice(ui.saved); await refreshed(); })}>{ui.revoke}</Button>
      <Button size="compact-sm" variant="default" disabled={busy} onClick={() => setRevoking(null)}>{ui.cancel}</Button>
    </Group></Stack>}</Paper>)}
  </>;
  const managementDialog = <Modal opened={managementOpen} keepMounted title={ui.manage} size="lg" closeOnEscape={!qrOpen && !bindingOpen} closeOnClickOutside={!qrOpen && !bindingOpen} trapFocus={!qrOpen && !bindingOpen} onClose={() => { if (!qrOpen && !bindingOpen) setManagementOpen(false); }} closeButtonProps={{ 'aria-label': ui.close }}>
    <Stack gap="sm">
      {error && <Alert color="red" role="alert">{error}</Alert>}
      {notice && <Alert color="green" role="status">{notice}</Alert>}
      {management}
    </Stack>
  </Modal>;
  if (renderWorkspace) return <>
    {renderWorkspace({ data, loading, busy: busy || uncertain || !!editor,
      feedback: <>{error && <Alert color="red" role="alert">{error}</Alert>}{notice && <Alert color="green" role="status">{notice}</Alert>}</>,
      requestInvitations: () => setManagementOpen(true), refresh: () => { if (!busy && !uncertain && !editor) void mutate(async () => { await load(); }); }, submissionActions,
    })}
    {managementDialog}
  </>;
  return <Stack gap="sm" className={compact ? 'orders-parent-measurements-compact' : undefined} aria-label={compact ? ui.compactTitle : ui.title}>
    <Group justify="space-between" gap="xs"><Title order={5}>{compact ? ui.compactTitle : ui.title}</Title>
      <Group gap="xs">
        {compact && <Button size="compact-sm" variant="light" onClick={() => setManagementOpen(true)}>{ui.manage}</Button>}
        <Button size="compact-sm" variant="default" disabled={busy || loading || uncertain || !!editor} onClick={() => mutate(async () => { await load(); })}>{ui.refresh}</Button>
      </Group>
    </Group>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {notice && <Alert color="green" role="status">{notice}</Alert>}
    {compact ? managementDialog : management}
    {compact && loading && <Text size="sm" role="status">{ui.loading}</Text>}
    {!compact && <Text fw={600} size="sm">{ui.submissions}</Text>}
    <Stack gap="xs" tabIndex={compact ? 0 : undefined} role={compact ? 'region' : undefined} aria-label={compact ? ui.submissions : undefined} className={compact ? 'orders-parent-measurements-submissions' : undefined}>
    {!loading && data?.submissions.length === 0 && <Text size="sm" c="dimmed">{ui.noSubmissions}</Text>}
    {data?.submissions.map(submission => <Paper key={submission.id} withBorder p="sm"><Stack gap="xs">
      <Group justify="space-between"><Text fw={600} size="sm">{submission.childName}</Text><Group gap="xs"><Badge variant="light">{label(ui.reviews, submission.reviewStatus)}</Badge><Badge variant="outline">{label(ui.assignments, submission.assignmentStatus)}</Badge></Group></Group>
      {compact && <>
        <SimpleGrid cols={2} spacing="xs" className="orders-parent-measurements-basics">
          {basicMeasurementNumbers.map(number => <Stack gap={2} key={number}>
            <Text size="xs" c="dimmed">№{number} · {ui.fields[number - 1]}</Text>
            <Text size="sm" fw={600}>{submission.values?.[`m${number}`] ?? ui.absent}</Text>
          </Stack>)}
        </SimpleGrid>
        <Button size="compact-sm" variant="subtle" aria-expanded={expandedSubmissions.includes(submission.id)} aria-controls={`parent-parameters-${submission.id}`} onClick={() => setExpandedSubmissions(current => current.includes(submission.id) ? current.filter(id => id !== submission.id) : [...current, submission.id])}>{expandedSubmissions.includes(submission.id) ? ui.hideParameters : ui.allParameters}</Button>
      </>}
      {(!compact || expandedSubmissions.includes(submission.id)) && <Stack gap="xs" id={`parent-parameters-${submission.id}`} tabIndex={compact ? 0 : undefined} role={compact ? 'region' : undefined} aria-label={compact ? ui.allParameters : undefined} className={compact ? 'orders-parent-measurements-parameters' : undefined}>
      <Text size="xs" c="dimmed">{ui.measuredAt}: {dateLabel(submission.measuredAt)} · {ui.version}: {submission.measurementId}</Text>
      {submission.hasPhoto && <Button component="a" href={`/api/orders/${encodeURIComponent(orderId)}/parent-measurements/submissions/${encodeURIComponent(submission.id)}/photo`} target="_blank" rel="noopener noreferrer" variant="subtle">{ui.viewPhoto}</Button>}
      <Alert color="yellow">{submission.definitionVersion === 'PARENT_BODY_V1' ? ui.bodyM6 : submission.definitionVersion == null ? ui.legacyM6 : ui.unknownM6}</Alert>
      {submission.discipline && <Text size="sm">{ui.discipline}: {label(ui.disciplines, submission.discipline)}</Text>}
      <Table.ScrollContainer minWidth={280}><Table fz="xs"><Table.Thead><Table.Tr><Table.Th>{ui.parameter}</Table.Th><Table.Th>{ui.value}</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
        {ui.fields.map((field, index) => <Table.Tr key={index}><Table.Td>№{index + 1} · {field}</Table.Td><Table.Td>{submission.values?.[`m${index + 1}`] ?? ui.absent}</Table.Td></Table.Tr>)}
      </Table.Tbody></Table></Table.ScrollContainer>
      {submission.notes && <Text size="sm">{ui.notes}: {submission.notes}</Text>}
      {!!submission.warnings?.length && <Alert color="yellow" title={ui.warnings}>{submission.warnings.join(' · ')}</Alert>}
      </Stack>}
      {submissionActions(submission.id)}
    </Stack></Paper>)}
    </Stack>
  </Stack>;
}
