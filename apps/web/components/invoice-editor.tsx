"use client";
import { FormEvent, useEffect, useState } from "react";
import { financeUi } from "../lib/i18n";
import { CrmModal } from "./crm/modal";

export type InvoiceItem = { description: string; quantity: number; amountMinor: number };
export type FinanceInvoice = {
  id: string; number: string; status: string; language: string; currency?: string;
  totalMinor: number; issueDate: string; dueDate?: string;
  seller?: { name: string; address?: string }; customer?: { name: string; address?: string };
  items?: InvoiceItem[]; notes?: string;
};
type EditorOrder = {
  id: string; priceMinor: number; currency: string; requiredDeliveryAt?: string;
  client: { displayName: string; country?: string; language?: string };
};
type Props = {
  order: EditorOrder; invoice?: FinanceInvoice;
  request: (path: string, init?: RequestInit) => Promise<any>;
  close: () => void; done: () => void;
};

export function InvoiceEditor({ order, invoice, request, close, done }: Props) {
  const [items, setItems] = useState<InvoiceItem[]>(invoice?.items?.length ? invoice.items : [{ description: financeUi.defaultProduct, quantity: 1, amountMinor: order.priceMinor }]);
  const [seller, setSeller] = useState(invoice?.seller?.name || "Yoleotard");
  const [sellerAddress, setSellerAddress] = useState(invoice?.seller?.address || financeUi.defaultCountry);
  const [customer, setCustomer] = useState(invoice?.customer?.name || order.client.displayName);
  const [customerAddress, setCustomerAddress] = useState(invoice?.customer?.address || order.client.country || "");
  const [notes, setNotes] = useState(invoice?.notes || "");
  const [issueDate, setIssueDate] = useState((invoice?.issueDate || new Date().toISOString()).slice(0, 10));
  const [dueDate, setDueDate] = useState(invoice?.dueDate?.slice(0, 10) || order.requiredDeliveryAt?.slice(0, 10) || "");
  const [language, setLanguage] = useState(invoice?.language || order.client.language || "ru");
  const [status, setStatus] = useState(invoice?.status || "DRAFT");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (invoice) return;
    request("/finance/settings").then((settings: { key: string; value: unknown }[]) => {
      for (const item of settings) {
        if (item.key === "sellerName" && typeof item.value === "string") setSeller(item.value);
        if (item.key === "sellerAddress" && typeof item.value === "string") setSellerAddress(item.value);
      }
    }).catch(() => {});
  }, [invoice, request]);

  const total = items.reduce((sum, item) => sum + item.quantity * item.amountMinor, 0);
  function updateItem(index: number, patch: Partial<InvoiceItem>) {
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  function addInvoiceItem() { setItems(current => [...current, { description: "", quantity: 1, amountMinor: 0 }]); }
  function removeInvoiceItem(index: number) { setItems(current => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index)); }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setSaveError("");
    try {
      const common = {
        language, dueDate: dueDate ? new Date(dueDate + "T12:00:00Z").toISOString() : null,
        status, seller: { name: seller, address: sellerAddress }, customer: { name: customer, address: customerAddress }, items, notes
      };
      await request(invoice?.id ? "/finance/invoices/" + invoice.id : "/finance/invoices", {
        method: invoice?.id ? "PATCH" : "POST",
        body: JSON.stringify(invoice?.id ? common : { ...common, orderId: order.id, issueDate: new Date(issueDate + "T12:00:00Z").toISOString() })
      });
      done();
    } catch (error) { setSaveError((error as Error).message); } finally { setSaving(false); }
  }

  return <CrmModal title={invoice ? financeUi.editInvoice : financeUi.invoiceEditor} close={close} busy={saving} className="invoice-editor-modal">
    <form className="finance-form invoice-editor-form" onSubmit={submit}>
      {saveError && <div className="phase2-error wide">{saveError}</div>}
      <label>{financeUi.seller}<input data-autofocus required value={seller} onChange={e => setSeller(e.target.value)} /></label>
      <label>{financeUi.sellerAddress}<input value={sellerAddress} onChange={e => setSellerAddress(e.target.value)} /></label>
      <label>{financeUi.client}<input required value={customer} onChange={e => setCustomer(e.target.value)} /></label>
      <label>{financeUi.customerAddress}<input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} /></label>
      <label>{financeUi.issueDate}<input type="date" required disabled={Boolean(invoice)} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></label>
      <label>{financeUi.dueDate}<input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
      <label>{financeUi.language}<select value={language} onChange={e => setLanguage(e.target.value)}><option value="ru">{financeUi.languageRu}</option><option value="en">{financeUi.languageEn}</option><option value="uk">{financeUi.languageUk}</option></select></label>
      <label>{financeUi.invoiceStatus}<select value={status} disabled={!invoice} onChange={e => setStatus(e.target.value)}><option value="DRAFT">{financeUi.statusDraft}</option><option value="ISSUED">{financeUi.statusIssued}</option><option value="PAID">{financeUi.statusPaid}</option><option value="CANCELLED">{financeUi.statusCancelled}</option></select></label>
      <div className="invoice-items wide">
        <div className="invoice-items-title"><b>{financeUi.positions}</b><button type="button" onClick={addInvoiceItem}>{financeUi.addPosition}</button></div>
        {items.map((item, index) => <div className="invoice-item-row" key={index}>
          <label>{financeUi.description}<input required value={item.description} onChange={e => updateItem(index, { description: e.target.value })} /></label>
          <label>{financeUi.quantity}<input type="number" min="1" step="1" required value={item.quantity} onChange={e => updateItem(index, { quantity: Math.max(1, Number(e.target.value)) })} /></label>
          <label>{financeUi.unitPrice}<input type="number" min=".01" step=".01" required value={(item.amountMinor / 100).toFixed(2)} onChange={e => updateItem(index, { amountMinor: Math.round(Number(e.target.value) * 100) })} /></label>
          <button type="button" className="invoice-remove" disabled={items.length === 1} aria-label={financeUi.removePosition} onClick={() => removeInvoiceItem(index)}>&times;</button>
        </div>)}
      </div>
      <label className="wide">{financeUi.notes}<textarea value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <div className="invoice-total wide"><span>{financeUi.invoiceTotal}</span><strong>{money(total, order.currency)}</strong></div>
      <button disabled={saving || !total} className="phase2-primary">{saving ? financeUi.saving : invoice ? financeUi.saveInvoice : financeUi.createInvoiceAction}</button>
    </form>
  </CrmModal>;
}
function money(value: number, currency: string) { return new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(value / 100); }

