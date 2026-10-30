"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Checkbox, Group, Modal, Select, SimpleGrid, Switch, Tabs, TextInput, Textarea } from "@mantine/core";
import { financeUi, settingsUi, invoiceTemplateUi as ui } from "../lib/i18n";
import { invoiceErrorMessage } from "../lib/invoice-errors";
import { CrmAlert } from "./crm/alert";
import "../app/document-template-settings.css";

type Language = "ru" | "uk" | "en" | "fr";
type Kind = "INVOICE" | "ORDER_SUMMARY" | "CUSTOMER_CARD" | "CUSTOM";
type FieldDefinition = { key: string; group: keyof typeof financeUi.fieldGroups; label: Record<Language, string> };
type TemplateConfig = {
  [key: string]: unknown;
  title: string; fieldKeys: string[]; showLogo: boolean;
  seller: { name: string; address: string };
  payment: { receiver: string; iban: string; bic: string; instructions: string };
  currency?: string | null; purpose?: string; isDefault?: boolean; revision?: number; notes?: string; footer?: string;
};
type Template = { id: string; name: string; kind: Kind; language: Language; active: boolean; builtIn: boolean; updatedAt?: string | null; config: TemplateConfig };
type OrderOption = { id: string; number: string; currency: string };
type OrderPage = { items: OrderOption[]; page: number; totalPages: number };
function emptyConfig(): TemplateConfig {
  return { version: 1, title: "INVOICE", fieldKeys: ["order.number", "client.name", "delivery.address", "table.items", "finance.total"], showLogo: true, seller: { name: "Yoleotard", address: "" }, payment: { receiver: "", iban: "", bic: "", instructions: "" }, currency: null, purpose: "", isDefault: false, revision: 1, notes: "", footer: "", requiredFields: ["seller.name", "seller.address", "customer.name", "order.items.name"], appearance: { accentColor: "#6c4ad1", mutedColor: "#756d7c", fontSize: 10 }, labels: {}, editableMetadata: ["issueDate", "dueDate", "notes", "showLogo"] };
}
// Tokens are React text nodes: template code never becomes executable markup.
function highlightedJson(source: string) {
  return source.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g).map((token, index) => <span key={index} className={token.startsWith('"') ? (/:\s*$/.test(token) ? "json-key" : "json-string") : /^(true|false|null)$/.test(token) ? "json-literal" : /^-?\d/.test(token) ? "json-number" : undefined}>{token}</span>);
}
async function responseError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return new Error(invoiceErrorMessage(Array.isArray(body.message) ? body.message.join(", ") : body.message, ui.requestError));
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/finance/${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw await responseError(response);
  return response.json();
}
function parseConfig(source: string): TemplateConfig {
  let value: TemplateConfig;
  try { value = JSON.parse(source); } catch { throw new Error(ui.invalidJson); }
  if (!value || Array.isArray(value) || typeof value !== "object" || typeof value.title !== "string" || !value.title.trim() || !Array.isArray(value.fieldKeys) || !value.fieldKeys.length || value.fieldKeys.some(key => typeof key !== "string") || typeof value.showLogo !== "boolean" || !value.seller || typeof value.seller.name !== "string" || typeof value.seller.address !== "string" || !value.payment || ["receiver", "iban", "bic", "instructions"].some(key => typeof value.payment[key as keyof TemplateConfig["payment"]] !== "string")) throw new Error(ui.invalidConfig);
  if (value.currency != null && !["EUR", "USD", "UAH"].includes(value.currency)) throw new Error(ui.invalidCurrency);
  return value;
}
export function DocumentTemplateSettings() {
  const [templates, setTemplates] = useState<Template[]>([]), [definitions, setDefinitions] = useState<FieldDefinition[]>([]);
  const [editing, setEditing] = useState<Template | null>(null), [source, setSource] = useState(""), [tab, setTab] = useState<string | null>("fields");
  const [error, setError] = useState(""), [editorError, setEditorError] = useState(""), [message, setMessage] = useState(""), [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [filter, setFilter] = useState(""), [archive, setArchive] = useState<Template | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null), [orderSearch, setOrderSearch] = useState(""), [orders, setOrders] = useState<OrderOption[]>([]), [orderPage, setOrderPage] = useState(1), [orderPages, setOrderPages] = useState(1), [ordersLoading, setOrdersLoading] = useState(false), [orderError, setOrderError] = useState(""), [ordersRetry, setOrdersRetry] = useState(0);
  const [preview, setPreview] = useState(""), [previewHtml, setPreviewHtml] = useState("");
  const previewUrl = useRef(""), locked = useRef(false), codeLayer = useRef<HTMLPreElement>(null), selectedOrder = useRef<OrderOption | null>(null);
  const readOnly = Boolean(editing?.builtIn);
  let config: TemplateConfig | null = null;
  try { config = parseConfig(source); } catch { /* Invalid JSON remains editable. */ }
  const groups = Object.keys(financeUi.fieldGroups) as FieldDefinition["group"][];
  async function load() {
    const [rows, fields] = await Promise.all([request<Template[]>("document-templates"), request<FieldDefinition[]>("document-field-definitions")]);
    setTemplates(rows); setDefinitions(fields);
  }
  useEffect(() => { let alive = true; void load().catch(reason => alive && setError(reason.message)).finally(() => alive && setLoading(false)); return () => { alive = false; }; }, []);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController(); let alive = true;
    setOrdersLoading(true); setOrderError("");
    const timeout = setTimeout(() => { void (async () => {
      try {
        const query = new URLSearchParams({ page: String(orderPage), pageSize: "20", search: orderSearch });
        const response = await fetch(`/api/orders?${query}`, { credentials: "include", signal: controller.signal });
        if (!response.ok) throw await responseError(response);
        const body: OrderPage = await response.json();
        if (alive) { setOrders(body.items); setOrderPages(body.totalPages || 1); }
      } catch (reason) { if (alive && !controller.signal.aborted) setOrderError((reason as Error).message); }
      finally { if (alive) setOrdersLoading(false); }
    })(); }, 250);
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [Boolean(editing), editing?.id, orderSearch, orderPage, ordersRetry]);
  function clearPreview() { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = ""; setPreview(""); setPreviewHtml(""); }
  function changeSource(next: string) { setSource(next); setValid(false); setEditorError(""); clearPreview(); }
  function open(row?: Template, duplicate = false) {
    setEditorError(""); setValid(false); clearPreview(); setOrderId(null); selectedOrder.current = null; setOrderSearch(""); setOrderPage(1); setOrders([]);
    const next = row ? { ...row, config: { ...row.config } } : { id: "", name: "", kind: "INVOICE" as Kind, language: "en" as Language, active: true, builtIn: false, config: emptyConfig() };
    if (duplicate) { next.id = ""; next.name = `${next.name} ${ui.copySuffix}`; next.builtIn = false; next.active = true; next.config = { ...next.config, isDefault: false, revision: 1 }; }
    setEditing(next); setSource(JSON.stringify(next.config, null, 2)); setTab("fields");
  }
  function close() { if (!locked.current) { setEditing(null); clearPreview(); } }
  function patchConfig(patch: Partial<TemplateConfig>) { if (config) changeSource(JSON.stringify({ ...config, ...patch }, null, 2)); }
  async function run(action: () => Promise<void>, inside = false) {
    if (locked.current) return;
    locked.current = true; setBusy(true); if (inside) setEditorError(""); else setError(""); setMessage("");
    try { await action(); } catch (reason) { (inside ? setEditorError : setError)((reason as Error).message || ui.requestError); }
    finally { locked.current = false; setBusy(false); }
  }
  async function validateConfig() {
    setValid(false);
    const parsed = parseConfig(source);
    await request<TemplateConfig>("document-templates/validate", { method: "POST", body: JSON.stringify({ language: editing!.language, config: parsed }) });
    setValid(true); return parsed;
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || readOnly) return;
    await run(async () => {
      const draft = await validateConfig();
      const body = editing.id ? { name: editing.name.trim(), language: editing.language, active: editing.active, config: draft, expectedRevision: editing.config.revision ?? 1 } : { name: editing.name.trim(), kind: editing.kind, language: editing.language, config: draft };
      await request(editing.id ? `document-templates/${encodeURIComponent(editing.id)}` : "document-templates", { method: editing.id ? "PATCH" : "POST", body: JSON.stringify(body) });
      setEditing(null); clearPreview(); setMessage(settingsUi.documentTemplateSaved);
      try { await load(); } catch (reason) { setError((reason as Error).message); }
    }, true);
  }
  async function testPreview() {
    if (!orderId || !editing) return;
    await run(async () => {
      const draft = await validateConfig();
      const payload = { orderId, kind: editing.kind, language: editing.language, config: draft };
      const [response, document] = await Promise.all([
        fetch("/api/finance/document-templates/preview", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
        request<{ html: string }>("document-templates/preview-html", { method: "POST", body: JSON.stringify(payload) }),
      ]);
      if (!response.ok) throw await responseError(response);
      if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error(ui.invalidPdf);
      if (typeof document.html !== "string" || !document.html.trim()) throw new Error(ui.invalidPreview);
      const blob = await response.blob(); clearPreview(); const url = URL.createObjectURL(blob); previewUrl.current = url; setPreview(url); setPreviewHtml(document.html);
    }, true);
  }
  async function lifecycle(row: Template, action: "default" | "archive") {
    await run(async () => {
      await request(`document-templates/${encodeURIComponent(row.id)}/${action}`, { method: "POST", body: JSON.stringify({ expectedRevision: row.config.revision ?? 1 }) });
      setArchive(null); setMessage(action === "default" ? ui.defaultSaved : ui.archived); await load();
    });
  }
  const visible = useMemo(() => templates.filter(row => `${row.name} ${row.id} ${row.config.purpose ?? ""} ${row.config.currency ?? ""}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => Number(b.active) - Number(a.active) || Number(Boolean(b.config.isDefault)) - Number(Boolean(a.config.isDefault)) || a.name.localeCompare(b.name, "ru")), [templates, filter]);
  const options = [...orders]; if (selectedOrder.current && orderId && !options.some(order => order.id === orderId)) options.unshift(selectedOrder.current);
  return <section className="settings-card invoice-template-settings">
    <header className="invoice-template-header"><div><h2>{ui.title}</h2><p>{ui.hint}</p></div><Button onClick={() => open()} disabled={busy}>{settingsUi.documentTemplateAdd}</Button></header>
    {error && <CrmAlert onClose={() => setError("")}>{error}<Button variant="subtle" size="compact-xs" disabled={busy} onClick={() => void run(load)}>{ui.retry}</Button></CrmAlert>}{message && <p role="status" className="settings-success">{message}</p>}
    <TextInput label={ui.search} value={filter} onChange={event => setFilter(event.currentTarget.value)} />
    {loading ? <p role="status">{ui.loading}</p> : !visible.length ? <p>{ui.empty}</p> : <div className="invoice-template-list">{visible.map(row => <article key={row.id} data-template-id={row.id}>
      <div className="invoice-template-summary"><strong>{row.name}</strong><span>{settingsUi.documentTemplateKinds[row.kind]} · {languageLabel(row.language)} · {row.config.currency || ui.orderCurrency}</span><span>{row.config.purpose || ui.noPurpose}</span><code>{row.id}</code><small>{ui.revision}: {row.config.revision ?? 1} · {ui.updatedAt}: {row.updatedAt ? new Date(row.updatedAt).toLocaleString("ru-RU") : ui.notSpecified}</small></div>
      <div className="invoice-template-actions"><Group gap="xs"><Badge color={row.active ? "teal" : "gray"}>{row.active ? settingsUi.documentTemplateActiveBadge : ui.archivedBadge}</Badge>{row.config.isDefault && <Badge>{ui.defaultBadge}</Badge>}{row.builtIn && <Badge variant="outline">{settingsUi.documentTemplateBuiltIn}</Badge>}</Group><Group gap="xs">
        <Button size="compact-xs" variant="light" disabled={busy} onClick={() => open(row)}>{row.builtIn ? ui.view : settingsUi.documentTemplateEdit}</Button>
        <Button size="compact-xs" variant="default" disabled={busy} onClick={() => open(row, true)}>{ui.duplicate}</Button>
        <Button size="compact-xs" variant="default" disabled={busy} onClick={() => { open(row); setTab("code"); }}>{ui.test}</Button>
        {!row.builtIn && <><Button size="compact-xs" variant="subtle" disabled={busy || !row.active || Boolean(row.config.isDefault)} onClick={() => void lifecycle(row, "default")}>{ui.makeDefault}</Button><Button size="compact-xs" variant="subtle" color="red" disabled={busy} onClick={() => setArchive(row)}>{ui.archive}</Button></>}
      </Group></div>
    </article>)}</div>}
    <Modal opened={Boolean(editing)} onClose={close} title={editing?.builtIn ? ui.viewTitle : editing?.id ? settingsUi.documentTemplateEdit : settingsUi.documentTemplateAdd} size="min(1280px, 96vw)" closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy} className="invoice-template-modal">
      {editing && <form onSubmit={save}>
        {editorError && <CrmAlert>{editorError}</CrmAlert>}
        {readOnly && <p className="invoice-template-readonly">{ui.builtinHint} <Button variant="light" size="compact-sm" disabled={busy} onClick={() => open(editing, true)}>{ui.duplicate}</Button></p>}
        <div className="invoice-template-editor-grid"><div className="invoice-template-editor-fields">
          <fieldset disabled={busy || readOnly} className="invoice-template-fieldset"><SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput required maxLength={120} disabled={readOnly} label={ui.name} value={editing.name} onChange={event => setEditing({ ...editing, name: event.currentTarget.value })}/>
            <Select required label={settingsUi.documentTemplateKind} value={editing.kind} disabled={Boolean(editing.id) || readOnly} onChange={value => value && setEditing({ ...editing, kind: value as Kind })} data={(Object.keys(settingsUi.documentTemplateKinds) as Kind[]).map(value => ({ value, label: settingsUi.documentTemplateKinds[value] }))}/>
            <Select required label={settingsUi.documentTemplateLanguage} value={editing.language} onChange={value => { if (value) { setEditing({ ...editing, language: value as Language }); setValid(false); clearPreview(); } }} data={(["ru", "uk", "en", "fr"] as Language[]).map(value => ({ value, label: languageLabel(value) }))}/>
            <Select label={ui.currency} value={config?.currency || "ORDER"} disabled={!config} onChange={value => patchConfig({ currency: value === "ORDER" ? null : value })} data={[{ value: "ORDER", label: ui.orderCurrency }, ...["EUR", "USD", "UAH"].map(value => ({ value, label: value }))]} description={ui.currencyHint}/>
            <TextInput label={ui.purpose} value={config?.purpose || ""} disabled={!config} onChange={event => patchConfig({ purpose: event.currentTarget.value })}/>
            <TextInput readOnly label={ui.revision} value={editing.config.revision ?? 1}/>
          </SimpleGrid>{editing.id && <Switch mt="sm" label={settingsUi.documentTemplateActive} checked={editing.active} onChange={event => setEditing({ ...editing, active: event.currentTarget.checked })}/>}</fieldset>
          <Tabs value={tab} onChange={setTab}><Tabs.List><Tabs.Tab value="fields">{ui.fieldsTab}</Tabs.Tab><Tabs.Tab value="code">{ui.code}</Tabs.Tab></Tabs.List>
            <Tabs.Panel value="fields" pt="md"><fieldset disabled={busy || readOnly || !config} className="invoice-template-fieldset">
              {!config ? <p role="alert">{ui.fixJsonFirst}</p> : <>
                <TextInput required label={financeUi.documentTitle} value={config.title} onChange={event => patchConfig({ title: event.currentTarget.value })}/>
                <Switch mt="sm" label={financeUi.showLogo} checked={config.showLogo} onChange={event => patchConfig({ showLogo: event.currentTarget.checked })}/>
                <details className="invoice-template-variables"><summary>{financeUi.documentFields}</summary><p>{financeUi.documentFieldsHint}</p>{groups.map(group => <div className="document-field-group" key={group}><strong>{financeUi.fieldGroups[group]}</strong>{definitions.filter(field => field.group === group).map(field => <Checkbox key={field.key} label={<span>{field.label.ru} <code>{field.key}</code></span>} checked={config!.fieldKeys.includes(field.key)} onChange={event => patchConfig({ fieldKeys: event.currentTarget.checked ? [...new Set([...config!.fieldKeys, field.key])] : config!.fieldKeys.filter(key => key !== field.key) })}/>)}</div>)}</details>
                <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md"><TextInput label={financeUi.seller} value={config.seller.name} onChange={event => patchConfig({ seller: { ...config!.seller, name: event.currentTarget.value } })}/><Textarea label={financeUi.sellerAddress} value={config.seller.address} onChange={event => patchConfig({ seller: { ...config!.seller, address: event.currentTarget.value } })}/><TextInput label={financeUi.paymentReceiver} value={config.payment.receiver} onChange={event => patchConfig({ payment: { ...config!.payment, receiver: event.currentTarget.value } })}/><TextInput label={financeUi.paymentIban} value={config.payment.iban} onChange={event => patchConfig({ payment: { ...config!.payment, iban: event.currentTarget.value } })}/><TextInput label={financeUi.paymentBic} value={config.payment.bic} onChange={event => patchConfig({ payment: { ...config!.payment, bic: event.currentTarget.value } })}/><Textarea label={financeUi.paymentInstructions} description={financeUi.paymentTokensHint} value={config.payment.instructions} onChange={event => patchConfig({ payment: { ...config!.payment, instructions: event.currentTarget.value } })}/></SimpleGrid>
                <Textarea mt="sm" label={ui.notes} value={config.notes || ""} onChange={event => patchConfig({ notes: event.currentTarget.value })}/>
                <Textarea mt="sm" label={ui.footer} value={config.footer || ""} onChange={event => patchConfig({ footer: event.currentTarget.value })}/>
              </>}
            </fieldset></Tabs.Panel>
            <Tabs.Panel value="code" pt="md"><p className="invoice-template-code-hint">{ui.codeHint}</p><div className="invoice-template-code"><pre ref={codeLayer} aria-hidden="true">{highlightedJson(source + "\n")}</pre><Textarea aria-label={ui.code} readOnly={readOnly} disabled={busy} value={source} spellCheck={false} wrap="off" onChange={event => changeSource(event.currentTarget.value)} onScroll={event => { if (codeLayer.current) { codeLayer.current.scrollTop = event.currentTarget.scrollTop; codeLayer.current.scrollLeft = event.currentTarget.scrollLeft; } }} classNames={{ input: "invoice-template-code-input" }}/></div><p>{ui.variablesHint}</p><div className="invoice-template-token-list">{definitions.map(field => <code key={field.key} title={field.label.ru}>{field.key}</code>)}</div></Tabs.Panel>
          </Tabs>
          <Group mt="md"><Button variant="light" type="button" disabled={busy} onClick={() => void run(async () => { await validateConfig(); }, true)}>{ui.validate}</Button>{valid && <span role="status">{ui.valid}</span>}</Group>
        </div><aside className="invoice-template-preview-panel"><h3>{ui.testTitle}</h3><p>{ui.previewHint}</p>
          <Select label={ui.order} searchable searchValue={orderSearch} onSearchChange={value => { setOrderSearch(value); setOrderPage(1); }} value={orderId} disabled={busy} onChange={value => { setOrderId(value); selectedOrder.current = orders.find(order => order.id === value) ?? null; clearPreview(); }} data={options.map(order => ({ value: order.id, label: `${order.number} · ${order.currency}` }))} nothingFoundMessage={ordersLoading ? ui.loading : ui.noOrders}/>
          {orderError && <CrmAlert>{orderError}<Button size="compact-xs" variant="subtle" onClick={() => setOrdersRetry(value => value + 1)}>{ui.retry}</Button></CrmAlert>}
          <Group mt="xs" justify="space-between"><Button variant="subtle" size="compact-xs" disabled={busy || ordersLoading || orderPage <= 1} onClick={() => setOrderPage(value => value - 1)}>{ui.previous}</Button><small>{orderPage} / {orderPages}</small><Button variant="subtle" size="compact-xs" disabled={busy || ordersLoading || orderPage >= orderPages} onClick={() => setOrderPage(value => value + 1)}>{ui.next}</Button></Group>
          <Button mt="sm" fullWidth variant="light" disabled={!orderId || busy} onClick={() => void testPreview()}>{ui.previewPdf}</Button>
          {previewHtml ? <><a href={preview} target="_blank" rel="noopener noreferrer">{ui.openPdf}</a><iframe sandbox="" referrerPolicy="no-referrer" srcDoc={previewHtml} title={ui.previewTitle}/></> : <div className="invoice-template-preview-empty">{ui.previewEmpty}</div>}
        </aside></div>
        <Group justify="flex-end" className="invoice-template-footer"><Button variant="default" disabled={busy} onClick={close}>{financeUi.close}</Button>{!readOnly && <Button type="submit" loading={busy} disabled={!editing.name.trim() || !config}>{settingsUi.documentTemplateSave}</Button>}</Group>
      </form>}
    </Modal>
    <Modal opened={Boolean(archive)} onClose={() => !busy && setArchive(null)} title={ui.archiveTitle} closeOnClickOutside={!busy} closeOnEscape={!busy}><p>{ui.archiveHint}</p><strong>{archive?.name}</strong>{error && <CrmAlert>{error}</CrmAlert>}<Group justify="flex-end" mt="md"><Button variant="default" disabled={busy} onClick={() => setArchive(null)}>{financeUi.close}</Button><Button color="red" loading={busy} onClick={() => archive && void lifecycle(archive, "archive")}>{ui.archive}</Button></Group></Modal>
  </section>;
}
function languageLabel(language: Language) { return language === "ru" ? financeUi.languageRu : language === "uk" ? financeUi.languageUk : language === "fr" ? financeUi.languageFr : financeUi.languageEn; }
