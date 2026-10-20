"use client";

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Paper, Stack, Text, Textarea, Title } from '@mantine/core';
import { parentMeasurementsStaffUi as ui, ordersDashboardUi as ordersUi } from '../../lib/i18n';
import type { OrderNoteInput } from './order-expanded-tabs';

type Note = { id: string; athleteId?: string | null; category: string; visibility: string; title: string; body: string; createdAt: string; updatedAt: string; author?: { displayName: string } | null };
type Props = {
  orderId: string;
  athleteId: string;
  notes?: Note[];
  onCreateNote: (input: OrderNoteInput) => Promise<void>;
  onUpdateNote: (noteId: string, input: OrderNoteInput & { expectedUpdatedAt: string }) => Promise<void>;
  onRefresh?: () => Promise<void>;
};
type Draft = { body: string; original?: Note; dirty: boolean; busy: boolean; uncertain: boolean; reconciled?: boolean; recoveredText?: string; error: string };
const freshDraft = (note?: Note): Draft => ({ body: note?.body ?? '', original: note, dirty: false, busy: false, uncertain: false, error: '' });

/** Uses existing order-note callbacks and their ownership/audit/CAS contract. Drafts are scoped to athlete IDs. */
export function MeasurementsAdminComment({ orderId, athleteId, notes, onCreateNote, onUpdateNote, onRefresh }: Props) {
  const scope = `${orderId}/${athleteId}`;
  const persisted = (notes ?? []).filter(n => n.athleteId === athleteId && n.category === 'MEASUREMENTS' && n.visibility === 'INTERNAL' && n.title === ui.adminComment).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const latest = persisted[0];
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const flights = useRef(new Set<string>());
  const current = drafts[scope] ?? freshDraft(latest);
  const change = (patch: Partial<Draft>, target = scope) => setDrafts(previous => ({ ...previous, [target]: { ...(previous[target] ?? freshDraft(target === scope ? latest : undefined)), ...patch } }));
  useEffect(() => {
    setDrafts(previous => {
      const draft = previous[scope];
      if (!draft || (!draft.dirty && !draft.busy && !draft.uncertain)) return { ...previous, [scope]: { ...freshDraft(latest), recoveredText: draft?.recoveredText } };
      // An uncertain response is resolved only by a fresh persisted record containing the exact draft.
      if (draft.uncertain && latest && latest.body === draft.body.trim() && latest.updatedAt !== draft.original?.updatedAt) return { ...previous, [scope]: { ...freshDraft(latest), recoveredText: draft?.recoveredText } };
      return previous;
    });
  }, [scope, latest?.id, latest?.updatedAt, current.busy, current.dirty, current.uncertain]);
  async function save() {
    if (flights.current.has(scope) || current.uncertain || !notes || !current.dirty || !current.body.trim()) return;
    flights.current.add(scope); change({ busy: true, error: '' });
    const target = scope;
    const original = current.original;
    const input: OrderNoteInput = { category: 'MEASUREMENTS', visibility: 'INTERNAL', title: ui.adminComment, athleteId, body: current.body.trim() };
    try {
      if (original) await onUpdateNote(original.id, { ...input, expectedUpdatedAt: original.updatedAt });
      else await onCreateNote(input);
      change({ dirty: false, error: '' }, target);
    } catch {
      // Callback rejection may follow a committed write or failed host refresh; never replay a create blindly.
      change({ uncertain: true, reconciled: false, error: ui.commentUncertain }, target);
    } finally { flights.current.delete(target); change({ busy: false }, target); }
  }
  async function refresh() {
    if (!onRefresh || current.busy) return;
    change({ busy: true });
    try { await onRefresh(); change({ reconciled: true }); } catch { change({ error: ui.error }); } finally { change({ busy: false }); }
  }
  return <Paper withBorder p="sm" className="orders-measurements-comment">
    <Title order={5} mb="xs">{ui.adminComment}</Title>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <Group align="flex-start" wrap="nowrap"><Textarea aria-label={ui.adminComment} placeholder={ui.adminCommentPlaceholder} value={current.body} onChange={event => change({ body: event.currentTarget.value, dirty: true })} maxLength={10000} minRows={3} maxRows={6} autosize disabled={current.busy || current.uncertain || !notes} className="orders-measurements-comment-input" /><Button type="submit" size="sm" loading={current.busy} disabled={!notes || !current.dirty || current.uncertain || !current.body.trim()}>{ordersUi.save}</Button></Group>
    </form>
    {current.error && <Alert color="red" mt="xs" role="alert">{current.error}</Alert>}
    {current.uncertain && onRefresh && <Button variant="subtle" size="compact-sm" onClick={refresh} disabled={current.busy}>{ui.refresh}</Button>}
    {current.uncertain && current.reconciled && <Stack gap="xs" mt="xs"><Text size="xs">{ui.commentResetWarning}</Text><Button variant="default" size="compact-sm" onClick={() => change({ ...freshDraft(latest), recoveredText: current.body })}>{ui.commentReloadSaved}</Button></Stack>}
    {current.recoveredText && <Textarea mt="xs" label={ui.commentUnsavedDraft} readOnly value={current.recoveredText} autosize minRows={2} maxRows={4} />}
    {!!persisted.length && <Stack mt="sm" gap={4}><Text size="xs" fw={600}>{ui.commentHistory}</Text>{persisted.slice(0, 3).map(note => <Text size="xs" c="dimmed" key={note.id}>{new Date(note.updatedAt).toLocaleString('ru-RU')} · {note.author?.displayName ?? ordersUi.notSpecified} · {note.body}</Text>)}</Stack>}
  </Paper>;
}
