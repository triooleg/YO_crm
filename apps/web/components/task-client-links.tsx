"use client";

import { Button, Group, Loader, NativeSelect, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { createCrmNavigationHref } from "../lib/crm-sections";
import { tasksUi as ui } from "../lib/i18n";

type OrderLink = { id: string; number: string; clientId: string; archivedAt?: string | null };
type Lookup = { clientId: string; status: "loading" | "ready" | "error"; orders: OrderLink[] };

/** Read-only destinations; opening a new tab keeps the task's unsaved form intact. */
export function TaskClientLinks({ client, busy }: { client: { id: string; displayName: string }; busy: boolean }) {
  const [lookup, setLookup] = useState<Lookup>(), [selected, setSelected] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLookup({ clientId: client.id, status: "loading", orders: [] }); setSelected("");
    void (async () => {
      try {
        const response = await fetch(`/api/clients/${encodeURIComponent(client.id)}`, { credentials: "include", signal: abort.signal });
        if (!response.ok) throw new Error();
        const details = await response.json();
        if (details.id !== client.id || !Array.isArray(details.orders)) throw new Error();
        const orders = details.orders.filter((order: OrderLink) => order && typeof order.id === "string" && order.id && typeof order.number === "string" && order.number && order.clientId === client.id && !order.archivedAt);
        if (!abort.signal.aborted) setLookup({ clientId: client.id, status: "ready", orders });
      } catch {
        if (!abort.signal.aborted) setLookup({ clientId: client.id, status: "error", orders: [] });
      }
    })();
    return () => abort.abort();
  }, [client.id, attempt]);
  const current = lookup?.clientId === client.id ? lookup : undefined;
  const orders = current?.orders ?? [];
  const chosen = orders.length === 1 ? orders[0] : orders.find(order => order.id === selected);
  const inboxHref = createCrmNavigationHref("inbox", "", { clientId: client.id, clientName: client.displayName });
  return <Stack gap="xs" aria-label={ui.clientLinks}>
    <Group gap="xs">
      <Button component="a" href={busy ? undefined : inboxHref} target="_blank" rel="noopener noreferrer" disabled={busy} tabIndex={busy ? -1 : undefined} variant="light">{ui.clientMessages}</Button>
      {chosen && <Button component="a" href={busy ? undefined : createCrmNavigationHref("orders", "", { orderId: chosen.id })} target="_blank" rel="noopener noreferrer" disabled={busy} tabIndex={busy ? -1 : undefined} variant="light">{ui.openClientOrder} {chosen.number}</Button>}
    </Group>
    {!current || current.status === "loading" ? <Group gap="xs" role="status"><Loader size="xs" /><Text size="sm">{ui.clientOrdersLoading}</Text></Group> : current.status === "error" ? <Group gap="xs"><Text size="sm" c="red" role="alert">{ui.clientOrdersError}</Text><Button type="button" variant="subtle" size="xs" disabled={busy} onClick={() => setAttempt(value => value + 1)}>{ui.retryClientOrders}</Button></Group> : orders.length === 0 ? <Text size="sm" c="dimmed">{ui.noClientOrders}</Text> : orders.length > 1 ? <NativeSelect label={ui.clientOrder} value={chosen?.id ?? ""} disabled={busy} onChange={event => setSelected(event.currentTarget.value)} data={[{ value: "", label: ui.chooseClientOrder }, ...orders.map(order => ({ value: order.id, label: order.number }))]} /> : null}
    <Text size="xs" c="dimmed">{ui.clientLinksNewTab}</Text>
  </Stack>;
}
