"use client";

import { useEffect, useRef, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Loader, Menu, Modal, Select, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { invoiceWorkflowUi as ui, financeUi } from "../lib/i18n";
import { moneyLabel } from "../lib/finance-report";
import { invoiceErrorMessage } from "../lib/invoice-errors";
import "../app/invoice-workflow.css";

type Request = (path: string, init?: RequestInit) => Promise<any>;
type Template = { id: string; name: string; kind: string; active: boolean; language: string; config: { currency?: string | null; purpose?: string; isDefault?: boolean; revision?: number } };
export type SavedInvoice = { id: string; number: string; status: string; currency?: string; language: string; issueDate: string; totalMinor: number; templateKey?: string | null; documentOptions?: { immutable?: boolean; templateName?: string; templateRevision?: number; [key: string]: unknown } | null };
type Preview = { previewToken: string; number: string; currency: string; totalMinor: number; language: string; templateName: string; templateRevision?: number; issueDate: string; html?: string };
type Order = { id: string; currency: string };

function language(value: string) { return ({ ru: financeUi.languageRu, uk: financeUi.languageUk, en: financeUi.languageEn, fr: financeUi.languageFr } as Record<string, string>)[value] || value; }
const message = invoiceErrorMessage;

export function InvoiceWorkflow({ order, request, close, done, canConfigure = false, sourceInvoiceId }: { order: Order; request: Request; close: () => void; done: (invoice: SavedInvoice) => Promise<void> | void; canConfigure?: boolean; sourceInvoiceId?: string }) {
  const [templates, setTemplates] = useState<Template[]>([]), [loading, setLoading] = useState(true), [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Preview>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false), sequence = useRef(0), mounted = useRef(true), operationKey = useRef("");
  useEffect(() => { mounted.current = true; request("/finance/document-templates").then((rows: Template[]) => { if (mounted.current) setTemplates(rows.filter(t => t.active && t.kind === "INVOICE").sort((a,b) => Number(Boolean(b.config.isDefault)) - Number(Boolean(a.config.isDefault)) || a.name.localeCompare(b.name))); }).catch(reason => mounted.current && setError(message(reason))).finally(() => mounted.current && setLoading(false)); return () => { mounted.current = false; sequence.current++; }; }, [request]);
  async function select(template: Template) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); const current = ++sequence.current;
    try { const result: Preview = await request("/finance/invoice-previews", { method: "POST", body: JSON.stringify({ orderId: order.id, templateKey: template.id, ...(sourceInvoiceId ? { sourceInvoiceId } : {}) }) }); if (mounted.current && sequence.current === current) { operationKey.current = crypto.randomUUID(); setPreview(result); } }
    catch (reason) { if (mounted.current) setError(message(reason)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function save(download = false) {
    if (!preview || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result: SavedInvoice = await request("/finance/invoices/from-template", { method: "POST", body: JSON.stringify({ previewToken: preview.previewToken, idempotencyKey: operationKey.current }) });
      if (download) {
        const link = document.createElement("a"); link.href = `/api/finance/invoices/${encodeURIComponent(result.id)}/document?download=1`; link.download = `${result.number.replace(/[^\p{L}\p{N}_-]/gu, "-")}.pdf`; document.body.append(link); link.click(); link.remove();
      }
      await done(result);
    }
    catch (reason) { if (mounted.current) setError(message(reason)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const settingsLink = canConfigure ? <Button component="a" href="/?section=settings&tab=invoice-templates" variant="subtle" size="xs">{ui.settings}</Button> : null;
  if (preview) return <InvoiceDocumentPreview title={ui.preview} number={preview.number} templateName={preview.templateName} language={preview.language} currency={preview.currency} totalMinor={preview.totalMinor} issueDate={preview.issueDate} html={preview.html} documentUrl={`/api/finance/invoice-previews/${encodeURIComponent(preview.previewToken)}/document`} busy={busy} error={error} onClose={close} onSave={() => void save()} onSaveAndDownload={() => void save(true)} onBack={() => { setPreview(undefined); setError(""); }} />;
  return <Modal opened onClose={() => !busy && close()} title={sourceInvoiceId ? ui.copyTitle : ui.create} size={390} centered closeOnClickOutside={!busy} closeOnEscape={!busy} closeButtonProps={{ "aria-label": ui.close, disabled: busy }} classNames={{ content: "invoice-template-picker" }}>
    <Stack gap="sm" aria-busy={loading || busy}>
      <Text size="sm" c="dimmed">{ui.choose}</Text>
      {sourceInvoiceId && <Text size="xs" c="dimmed">{ui.copyHint}</Text>}
      {templates.length > 6 && <TextInput label={ui.searchTemplates} value={query} onChange={event => setQuery(event.currentTarget.value)} />}
      {error && <Alert color="red" role="alert">{error}{settingsLink}<Button component="a" href={`/?section=orders&orderId=${encodeURIComponent(order.id)}&tab=details`} variant="subtle" size="xs">{ui.orderDetails}</Button></Alert>}
      {loading ? <Loader size="sm" aria-label={ui.loading}/> : <div className="invoice-template-choices">{templates.filter(t => `${t.name} ${t.config.purpose || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(template => {
        const mismatch = Boolean(template.config.currency && template.config.currency !== order.currency);
        return <UnstyledButton className="invoice-template-choice" key={template.id} disabled={busy || mismatch} onClick={() => void select(template)} aria-label={`${template.name} · ${language(template.language)} · ${template.config.currency || order.currency}`}>
          <span className="invoice-template-symbol" aria-hidden="true">▤</span><span><strong>{template.name}</strong><small>{language(template.language)} · {template.config.currency || order.currency}{template.config.purpose ? ` · ${template.config.purpose}` : ""}</small>{mismatch && <small>{ui.currencyMismatch}</small>}</span>{template.config.isDefault && <Badge size="xs" variant="light">{ui.default}</Badge>}
        </UnstyledButton>;
      })}</div>}
      {!loading && !templates.length && <Text size="sm">{ui.empty}{settingsLink}</Text>}
      {busy && <Group><Loader size="xs"/><Text size="sm">{ui.generating}</Text></Group>}
    </Stack>
  </Modal>;
}

export function InvoiceDocumentPreview({ title, number, documentUrl, html, templateName, language: locale, currency, totalMinor, issueDate, busy = false, error, onClose, onSave, onSaveAndDownload, onBack, statusControl }: { title: string; number: string; documentUrl: string; html?: string; templateName?: string; language?: string; currency?: string; totalMinor?: number; issueDate?: string; busy?: boolean; error?: string; onClose: () => void; onSave?: () => void; onSaveAndDownload?: () => void; onBack?: () => void; statusControl?: React.ReactNode }) {
  const [url, setUrl] = useState(""), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(""), [attempt, setAttempt] = useState(0);
  const [documentHtml, setDocumentHtml] = useState(html || "");
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    setLoading(true); setUrl(""); setLoadError(""); setDocumentHtml(html || "");
    if (!html && documentUrl.startsWith("/api/finance/invoices/")) void fetch(documentUrl.replace(/\/document$/, "/preview"), { credentials: "include", signal: controller.signal }).then(async response => { if (response.ok) { const body = await response.json(); if (!controller.signal.aborted && typeof body.html === "string") setDocumentHtml(body.html); } }).catch(() => {});
    fetch(documentUrl, { credentials: "include", signal: controller.signal }).then(async response => { if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || ui.previewError); } const blob = await response.blob(); if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(reason => { if (!controller.signal.aborted) setLoadError(message(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [documentUrl, html, attempt]);
  function print() { try { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); } catch { setLoadError(ui.printError); } }
  return <Modal opened onClose={() => !busy && onClose()} title={title} size={1120} centered closeOnClickOutside={!busy} closeOnEscape={!busy} closeButtonProps={{ "aria-label": ui.close, disabled: busy }} classNames={{ content: "invoice-document-modal", body: "invoice-document-modal-body" }}>
    <div className="invoice-document-layout">
      <div className="invoice-document-page" aria-busy={loading}>
        {loading && <div className="invoice-document-loading"><Loader size="sm"/><Text size="sm">{ui.generating}</Text></div>}
        {url && (documentHtml ? <iframe ref={frame} title={ui.document} srcDoc={documentHtml} sandbox="allow-same-origin allow-modals"/> : <iframe ref={frame} title={ui.document} src={`${url}#toolbar=0&navpanes=0&view=FitH`} />)}
        {loadError && <Alert color="red" role="alert">{loadError}<Button variant="subtle" size="xs" onClick={() => setAttempt(value => value + 1)}>{ui.retry}</Button></Alert>}
      </div>
      <aside className="invoice-document-actions">
        <Text fw={700} size="sm">{ui.actions}</Text>
        {error && <Alert color="red" role="alert">{error}</Alert>}
        {onSave && <Button fullWidth loading={busy} disabled={!url || loading} onClick={onSave}>{ui.save}</Button>}
        {onSaveAndDownload && <Button fullWidth variant="light" loading={busy} disabled={!url || loading} onClick={onSaveAndDownload}>{ui.saveAndDownload}</Button>}
        <Button component="a" href={url || undefined} download={`${number.replace(/[^\p{L}\p{N}_-]/gu, "-")}.pdf`} disabled={!url || loading} variant="light" fullWidth>{ui.download}</Button>
        <Button fullWidth variant="default" disabled={!url || loading} onClick={print}>{ui.print}</Button>
        {onBack && <Button fullWidth variant="subtle" disabled={busy} onClick={onBack}>{ui.back}</Button>}
        <dl className="invoice-document-meta"><dt>{ui.number}</dt><dd>{number}</dd>{templateName && <><dt>{ui.template}</dt><dd>{templateName}</dd></>}{locale && <><dt>{ui.language}</dt><dd>{language(locale)}</dd></>}{issueDate && <><dt>{ui.date}</dt><dd>{new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC" }).format(new Date(issueDate))}</dd></>}{currency && totalMinor !== undefined && <><dt>{ui.total}</dt><dd><strong>{moneyLabel(totalMinor, currency)}</strong></dd></>}</dl>
        {statusControl}
      </aside>
    </div>
  </Modal>;
}

export function InvoiceStatusControl({ invoice, request, done }: { invoice: SavedInvoice; request: Request; done: (status: string) => Promise<void> | void }) {
  const [status, setStatus] = useState(invoice.status), [busy, setBusy] = useState(false), [error, setError] = useState(""); const pending = useRef(false);
  async function save() { if (pending.current || status === invoice.status) return; pending.current = true; setBusy(true); setError(""); try { await request(`/finance/invoices/${encodeURIComponent(invoice.id)}`, { method: "PATCH", body: JSON.stringify({ status }) }); await done(status); } catch (reason) { setError(message(reason)); } finally { pending.current = false; setBusy(false); } }
  return <Stack gap="xs" mt="sm"><Select label={ui.invoiceStatus} value={status} onChange={value => value && setStatus(value)} disabled={busy} data={[{ value: "DRAFT", label: ui.draft }, { value: "ISSUED", label: ui.issued }, { value: "PAID", label: ui.paid }, { value: "CANCELLED", label: ui.cancelled }]}/>{error && <Alert color="red" role="alert">{error}</Alert>}<Button variant="light" loading={busy} disabled={status === invoice.status} onClick={() => void save()}>{ui.saveStatus}</Button></Stack>;
}

export function OrderInvoiceDocuments({ order, invoices, request, onSaved, canConfigure, canArchive, legacyCreate, children, additionalDocumentCount = 0 }: { order: Order; invoices: SavedInvoice[]; request?: Request; onSaved?: () => Promise<void>; canConfigure?: boolean; canArchive?: boolean; legacyCreate?: () => void; children?: React.ReactNode; additionalDocumentCount?: number }) {
  const [creating, setCreating] = useState(false), [copyFrom, setCopyFrom] = useState<string>(), [viewing, setViewing] = useState<SavedInvoice>();
  const [archiveTarget, setArchiveTarget] = useState<SavedInvoice>(), [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const [localInvoices, setLocalInvoices] = useState<SavedInvoice[]>([]), [archivedIds, setArchivedIds] = useState<string[]>([]);
  // A replaced collection is an authoritative parent refresh. Local rows bridge
  // only the interval between a successful write and its read confirmation.
  useEffect(() => { setLocalInvoices([]); }, [invoices]);
  const rows = [...localInvoices, ...invoices.filter(item => !localInvoices.some(local => local.id === item.id))].filter(item => !archivedIds.includes(item.id));
  const pending = useRef(false);
  async function saved(invoice: SavedInvoice) { setLocalInvoices(current => [invoice, ...current.filter(item => item.id !== invoice.id)]); setCreating(false); setCopyFrom(undefined); setSuccess(ui.saved); try { await onSaved?.(); if (onSaved) setLocalInvoices(current => current.filter(item => item.id !== invoice.id)); } catch { setError(ui.refreshError); } }
  async function archive() { if (!archiveTarget || !request || pending.current) return; pending.current = true; setBusy(true); setError(""); try { await request(`/finance/invoices/${encodeURIComponent(archiveTarget.id)}/archive`, { method: "POST", body: "{}" }); setArchivedIds(current => [...current, archiveTarget.id]); setLocalInvoices(current => current.filter(item => item.id !== archiveTarget.id)); setArchiveTarget(undefined); await onSaved?.(); } catch (reason) { setError(message(reason)); } finally { pending.current = false; setBusy(false); } }
  return <section className="orders-tab-card order-invoice-documents">
    <header className="order-invoice-documents-head"><h3>{ui.documents} ({rows.length + additionalDocumentCount})</h3><Group gap="xs">{request && <Button size="compact-sm" onClick={() => { setSuccess(""); setCreating(true); }}>{ui.create}</Button>}{legacyCreate && <Menu withinPortal position="bottom-end"><Menu.Target><ActionIcon variant="default" aria-label={ui.otherActions}>···</ActionIcon></Menu.Target><Menu.Dropdown><Menu.Item onClick={legacyCreate}>{ui.otherDocument}</Menu.Item></Menu.Dropdown></Menu>}</Group></header>
    {error && <Alert color="red" role="alert" withCloseButton onClose={() => setError("")}>{error}</Alert>}
    {success && <Alert color="teal" role="status" withCloseButton onClose={() => setSuccess("")}>{success}</Alert>}
    <div className="order-invoice-list">{rows.length > 0 && <div className="order-invoice-list-head"><span>{ui.date}</span><span>{ui.number}</span><span>{ui.template}</span><span>{ui.total}</span><span>{ui.status}</span><span>{ui.actions}</span></div>}{rows.map(invoice => <div className="order-invoice-list-row" key={invoice.id}>
      <span>{new Intl.DateTimeFormat("ru-RU").format(new Date(invoice.issueDate))}</span><UnstyledButton className="invoice-number-link" onClick={() => setViewing(invoice)}>{invoice.number}</UnstyledButton>
      <span className="invoice-template-meta">{invoice.documentOptions?.templateName || ui.legacy}<small>{language(invoice.language)} · {invoice.currency || order.currency}</small></span><strong>{moneyLabel(invoice.totalMinor, invoice.currency || order.currency)}</strong>
      <Badge variant="light" color={invoice.status === "CANCELLED" ? "gray" : "teal"}>{({ DRAFT: ui.draft, ISSUED: ui.issued, PAID: ui.paid, CANCELLED: ui.cancelled } as Record<string,string>)[invoice.status] || invoice.status}</Badge>
      <Group gap={4} wrap="nowrap"><ActionIcon variant="default" aria-label={`${ui.view}: ${invoice.number}`} onClick={() => setViewing(invoice)}>◉</ActionIcon><ActionIcon component="a" variant="default" aria-label={`${ui.download}: ${invoice.number}`} href={`/api/finance/invoices/${encodeURIComponent(invoice.id)}/document?download=1`}>↓</ActionIcon><Menu withinPortal position="bottom-end"><Menu.Target><ActionIcon variant="default" aria-label={`${ui.otherActions}: ${invoice.number}`}>···</ActionIcon></Menu.Target><Menu.Dropdown><Menu.Item onClick={() => setViewing(invoice)}>{ui.print}</Menu.Item>{request && <Menu.Item onClick={() => { setCopyFrom(invoice.id); setCreating(true); }}>{ui.copy}</Menu.Item>}{request && canArchive && <Menu.Item color="red" onClick={() => setArchiveTarget(invoice)}>{ui.archive}</Menu.Item>}</Menu.Dropdown></Menu></Group>
    </div>)}</div>
    {!rows.length && !additionalDocumentCount && <Text size="sm" c="dimmed" py="md">{ui.noDocuments}</Text>}{children}
    {creating && request && <InvoiceWorkflow order={order} request={request} sourceInvoiceId={copyFrom} canConfigure={canConfigure} close={() => { setCreating(false); setCopyFrom(undefined); }} done={saved}/>}
    {viewing && <InvoiceDocumentPreview title={`${ui.invoice} ${viewing.number}`} number={viewing.number} language={viewing.language} currency={viewing.currency || order.currency} totalMinor={viewing.totalMinor} issueDate={viewing.issueDate} templateName={viewing.documentOptions?.templateName} documentUrl={`/api/finance/invoices/${encodeURIComponent(viewing.id)}/document`} onClose={() => setViewing(undefined)} statusControl={request && canArchive ? <InvoiceStatusControl invoice={viewing} request={request} done={async status => { const updated = { ...viewing, status }; setViewing(updated); setLocalInvoices(current => [updated, ...current.filter(item => item.id !== updated.id)]); await onSaved?.(); if (onSaved) setLocalInvoices(current => current.filter(item => item.id !== updated.id)); }}/> : undefined}/>}
    <Modal opened={Boolean(archiveTarget)} onClose={() => !busy && setArchiveTarget(undefined)} title={ui.archive} centered size="sm"><Stack><Text size="sm">{ui.archiveHint}</Text><Text fw={700}>{archiveTarget?.number}</Text><Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setArchiveTarget(undefined)}>{ui.close}</Button><Button color="red" loading={busy} onClick={() => void archive()}>{ui.archive}</Button></Group></Stack></Modal>
  </section>;
}
