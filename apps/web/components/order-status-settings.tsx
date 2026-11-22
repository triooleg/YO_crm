"use client";

import { Alert, Badge, Button, ColorInput, Group, Modal, Select, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState, type FormEvent } from "react";
import { orderStatusSettingsUi as ui } from "../lib/i18n";
import { SALES_STATUSES, type OrderStatusOption } from "../lib/order-status-options";
import { crmStatusPresentation } from "./crm/status-badge";

const baseLabel = (status: string) => crmStatusPresentation("sales", status).label;

async function request(id?: string, init?: RequestInit) {
  const response = await fetch(`/api/orders/status-options${id ? `/${encodeURIComponent(id)}` : ""}`, {
    credentials: "include", ...init, headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.message === "string" ? body.message : ui.error);
  }
  return response.json();
}

export function OrderStatusSettings() {
  const [options, setOptions] = useState<OrderStatusOption[]>();
  const [draft, setDraft] = useState<OrderStatusOption>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void request().then(setOptions).catch((error: Error) => setError(error.message));
  }, []);

  async function save(option: OrderStatusOption, archived?: boolean) {
    setBusy(true);
    setError("");
    try {
      const saved = await request(option.id, {
        method: option.id ? "PATCH" : "POST",
        body: JSON.stringify({ baseStatus: option.baseStatus, ...(archived === undefined ? { label: option.label?.trim() || null, color: option.color || null } : { archived }) }),
      }) as OrderStatusOption;
      setOptions(current => [...(current ?? []).filter(item => item.id !== saved.id), saved]);
      setDraft(undefined);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const builtIn = SALES_STATUSES.map(status => options?.find(item => item.id === status)
    ?? { id: status, baseStatus: status, label: null, color: null, archivedAt: null });
  const entries = [...builtIn, ...(options ?? []).filter(item => item.id !== item.baseStatus)];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft && !busy) void save(draft);
  }

  return <section className="settings-card">
    <Stack gap="sm">
      <h2>{ui.title}</h2>
      <Text size="sm">{ui.description}</Text>
      {error && !draft && <Alert color="red">{error}</Alert>}
      {!options && !error && <Text role="status">{ui.loading}</Text>}
      {options && <>
        <Group><Button disabled={busy} onClick={() => setDraft({ id: "", baseStatus: SALES_STATUSES[0]!, label: "", color: null, archivedAt: null })}>{ui.add}</Button></Group>
        {entries.map(option => {
          const label = option.label ?? baseLabel(option.baseStatus);
          return <Group key={option.id} justify="space-between" py="xs">
            <Group gap="xs">
              <Badge variant="light" color={option.color ?? crmStatusPresentation("sales", option.baseStatus).color}>{label}</Badge>
              {option.archivedAt && <Text size="xs" c="dimmed">{ui.hidden}</Text>}
            </Group>
            <Group gap="xs">
              <Button size="xs" variant="default" disabled={busy} aria-label={`${ui.edit} ${label}`} onClick={() => setDraft(option)}>{ui.edit}</Button>
              <Button size="xs" variant="subtle" disabled={busy} aria-label={`${option.archivedAt ? ui.restore : ui.hide} ${label}`} onClick={() => void save(option, !option.archivedAt)}>{option.archivedAt ? ui.restore : ui.hide}</Button>
            </Group>
          </Group>;
        })}
      </>}
    </Stack>
    <Modal opened={Boolean(draft)} onClose={() => !busy && setDraft(undefined)} centered title={draft?.id ? ui.edit : ui.add}>
      {draft && <form onSubmit={submit}>
        <Stack gap="sm">
          <TextInput label={ui.name} placeholder={baseLabel(draft.baseStatus)} value={draft.label ?? ""} required={draft.id !== draft.baseStatus}
            disabled={busy} maxLength={80} onChange={event => setDraft({ ...draft, label: event.currentTarget.value })} />
          <Select label={ui.base} value={draft.baseStatus} disabled={busy || Boolean(draft.id)} allowDeselect={false}
            data={SALES_STATUSES.map(value => ({ value, label: baseLabel(value) }))} onChange={value => value && setDraft({ ...draft, baseStatus: value })} />
          <ColorInput label={ui.color} format="hex" value={draft.color ?? ""} disabled={busy} onChange={color => setDraft({ ...draft, color: color || null })} />
          <Group><Button variant="subtle" disabled={busy || !draft.color} onClick={() => setDraft({ ...draft, color: null })}>{ui.standardColor}</Button></Group>
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={() => setDraft(undefined)}>{ui.cancel}</Button>
            <Button type="submit" loading={busy} disabled={Boolean(draft.color && !/^#[0-9a-f]{6}$/i.test(draft.color))}>{ui.save}</Button>
          </Group>
        </Stack>
      </form>}
    </Modal>
  </section>;
}
