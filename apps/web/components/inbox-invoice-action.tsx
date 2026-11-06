"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Loader, Modal, NativeSelect, Stack, Text } from "@mantine/core";
import { communicationsUi as ui } from "../lib/i18n";

type SavedInvoice = { id: string; orderId: string; number: string; orderNumber: string; issueDate: string };
type Props = {
  clientId: string;
  disabled: boolean;
  canAttach: boolean;
  activeOrders: readonly { id: string }[];
  attachmentOccupied: boolean;
  maxAttachmentBytes: number;
  onAttach: (file: File) => boolean;
  onGenerate?: () => void;
};

function invoiceLabel(invoice: SavedInvoice) {
  const date = new Date(invoice.issueDate).toLocaleDateString("ru-RU", { timeZone: "UTC" });
  return [invoice.number, invoice.orderNumber, date].join(" · ");
}

export function InboxInvoiceAction({
  clientId, disabled, canAttach, activeOrders, attachmentOccupied, maxAttachmentBytes, onAttach, onGenerate,
}: Props) {
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [invoices, setInvoices] = useState<SavedInvoice[]>();
  const [orderId, setOrderId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const documentPending = useRef(false);
  const path = "/api/finance/clients/" + encodeURIComponent(clientId) + "/invoices";
  const activeIds = new Set(activeOrders.map(order => order.id));
  const orders = [...new Map(invoices?.map(invoice => [invoice.orderId, invoice.orderNumber])).entries()]
    .sort(([a], [b]) => Number(activeIds.has(b)) - Number(activeIds.has(a)));
  const availableInvoices = invoices?.filter(invoice => !orderId || invoice.orderId === orderId) ?? [];
  const selectedInvoice = availableInvoices.find(invoice => invoice.id === selectedId);
  const documentPath = selectedInvoice ? path + "/" + encodeURIComponent(selectedInvoice.id) + "/document" : undefined;

  useEffect(() => () => request.current?.abort(), []);

  function close() {
    request.current?.abort();
    request.current = null;
    documentPending.current = false;
    setOpened(false);
  }

  async function open() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setOpened(true);
    setInvoices(undefined);
    setOrderId("");
    setSelectedId("");
    setError("");
    setDownloading(false);
    setLoading(true);
    try {
      const response = await fetch(path, { credentials: "include", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error();
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || !rows.every(row => row && typeof row.id === "string" &&
          typeof row.number === "string" && typeof row.orderId === "string" && typeof row.orderNumber === "string" && typeof row.issueDate === "string")) {
        throw new Error();
      }
      if (!controller.signal.aborted) setInvoices(rows);
    } catch {
      if (!controller.signal.aborted) setError(ui.invoicePickerLoadError);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function attach() {
    const signal = request.current?.signal;
    const invoice = selectedInvoice;
    if (!signal || signal.aborted || !invoice || !documentPath || !canAttach || disabled || attachmentOccupied || documentPending.current) return;
    documentPending.current = true;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch(documentPath, {
        credentials: "include", cache: "no-store", signal,
      });
      if (!response.ok || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/pdf") {
        throw new Error();
      }
      const blob = await response.blob();
      if (signal.aborted) return;
      if (!blob.size) throw new Error();
      if (blob.size > maxAttachmentBytes) {
        setError(ui.attachmentTooLarge.replace("{size}", `${maxAttachmentBytes / (1024 * 1024)} МБ`));
        return;
      }
      const filename = invoice.number.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim() + ".pdf";
      if (onAttach(new File([blob], filename, { type: "application/pdf" }))) close();
      else setError(ui.invoicePickerDocumentError);
    } catch {
      if (!signal.aborted) setError(ui.invoicePickerDocumentError);
    } finally {
      if (!signal.aborted) {
        documentPending.current = false;
        setDownloading(false);
      }
    }
  }

  return <>
    <button type="button" disabled={disabled} onClick={() => void open()}>▤ {ui.invoiceShortcut}</button>
    <Modal opened={opened} onClose={close} title={ui.invoicePickerTitle} centered closeButtonProps={{ "aria-label": ui.close }}>
      <Stack gap="sm" aria-busy={loading || downloading}>
        {!canAttach && <Alert color="yellow">{ui.invoicePickerSwitchChannel}</Alert>}
        {loading && <Loader size="sm" role="status" aria-label={ui.invoicePickerLoading}/>}
        {error && <Alert color="red" role="alert">{error}</Alert>}
        {canAttach && attachmentOccupied && <Alert color="yellow">{ui.invoicePickerAttachmentOccupied}</Alert>}
        {invoices?.length === 0 && <Text size="sm">{ui.invoicePickerEmpty}</Text>}
        {!!orders.length && <NativeSelect label={ui.invoicePickerOrder} value={orderId}
          disabled={downloading} onChange={event => { setOrderId(event.currentTarget.value); setSelectedId(""); }}
          data={[{ value: "", label: ui.invoicePickerAllOrders }, ...orders.map(([id, number]) => ({
            value: id, label: activeIds.has(id) ? ui.invoicePickerActiveOrder.replace("{number}", number) : number,
          }))]}/>}
        {!!availableInvoices.length && <NativeSelect label={ui.invoicePickerSelect} value={selectedId}
          disabled={downloading} onChange={event => setSelectedId(event.currentTarget.value)}
          data={[{ value: "", label: ui.invoicePickerSelect }, ...availableInvoices.map(invoice => ({
            value: invoice.id, label: invoiceLabel(invoice),
          }))]}/>}
        <Group justify="flex-end">
          <Button type="button" variant="default" onClick={close}>{ui.close}</Button>
          {invoices?.length === 0 && onGenerate && <Button type="button" onClick={() => { close(); onGenerate(); }}>
            {ui.invoicePickerGenerate}
          </Button>}
          {documentPath && <Button component="a" href={documentPath} download variant="light">
            {ui.invoicePickerDownload}
          </Button>}
          {canAttach && !!availableInvoices.length && <Button type="button" loading={downloading}
            disabled={!selectedInvoice || attachmentOccupied || disabled} onClick={() => void attach()}>{ui.invoicePickerAttach}</Button>}
        </Group>
      </Stack>
    </Modal>
  </>;
}
