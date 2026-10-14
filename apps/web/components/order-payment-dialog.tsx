"use client";
import { useRef, useState } from "react";
import { Modal } from "@mantine/core";
import { ordersDashboardUi as ui } from "../lib/i18n";
import { parseOrderPriceMinor } from "../lib/order-price";
import { CrmAlert } from "./crm/alert";
import { CrmButton, CrmNativeSelect, CrmTextInput } from "./crm/settings-controls";
export type PaymentOrder = { id:string;number:string;currency:string;priceMinor:number;payments:{amountMinor:number;currency:string;appliedAmountMinor?:number|null;appliedCurrency?:string|null}[] };
function balance(order:PaymentOrder){ return Math.max(0,order.priceMinor-order.payments.reduce((sum,p)=>sum+(p.currency===order.currency?p.amountMinor:p.appliedCurrency===order.currency?p.appliedAmountMinor||0:0),0)); }
function money(value:number,currency:string){return new Intl.NumberFormat("ru-RU",{style:"currency",currency}).format(value/100)}
export function QuickPayment({ order, request, onClose, onSaved }: { order: PaymentOrder; request: (path: string, init?: RequestInit) => Promise<unknown>; onClose: () => void; onSaved: () => Promise<void> }) {
  const submitting = useRef(false); const [amount, setAmount] = useState(""); const [currency, setCurrency] = useState(order.currency); const [method, setMethod] = useState("BANK_TRANSFER"); const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10)); const [reference, setReference] = useState(""); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (submitting.current) return; const amountMinor = parseOrderPriceMinor(amount); if (amountMinor == null || amountMinor <= 0) { setError(ui.paymentAmountError); return; } submitting.current = true; setBusy(true); setError(""); try { await request(`/orders/${order.id}/payments`, { method: "POST", body: JSON.stringify({ amountMinor, currency, method, receivedAt: new Date(`${receivedAt}T12:00:00`).toISOString(), reference: reference.trim() || undefined, notes: notes.trim() || undefined }) }); await onSaved(); } catch (reason) { setError((reason as Error).message); } finally { submitting.current = false; setBusy(false); } }
  return <Modal opened onClose={() => { if (!submitting.current) onClose(); }} closeOnEscape={!busy} closeOnClickOutside={!busy} centered size={420} aria-label={`${ui.paymentTitle} ${order.number}`} closeButtonProps={{ "aria-label": ui.close }} classNames={{ content: "orders-quick-payment", header: "orders-quick-payment-header", body: "orders-quick-payment-body" }} title={<div><small>{ui.paymentTitle}</small><h2>{order.number}</h2></div>}>
    <form className="orders-quick-payment-form" onSubmit={submit}>
      <p>{ui.balance}: <strong>{money(balance(order), order.currency)}</strong></p>
      <CrmTextInput data-autofocus autoFocus label={ui.amount} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
      <CrmNativeSelect label={ui.paymentCurrency} value={currency} onChange={(event) => setCurrency(event.target.value)} data={["EUR", "USD", "UAH"]} />
      {currency !== order.currency && <p className="orders-payment-conversion-note">{ui.automaticRateHint} {order.currency}.</p>}
      <CrmNativeSelect label={ui.paymentMethod} value={method} onChange={(event) => setMethod(event.target.value)} data={[{ value: "BANK_TRANSFER", label: ui.bankTransfer }, { value: "CARD", label: ui.cardPayment }, { value: "PAYPAL", label: "PayPal" }, { value: "CASH", label: ui.cashPayment }, { value: "OTHER", label: ui.otherPayment }]} />
      <CrmTextInput label={ui.paymentDate} type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} required />
      <CrmTextInput label={ui.paymentReference} value={reference} onChange={(event) => setReference(event.target.value)} />
      <CrmTextInput label={ui.paymentNote} value={notes} onChange={(event) => setNotes(event.target.value)} />
      {error && <CrmAlert>{error}</CrmAlert>}
      <footer><CrmButton tone="secondary" type="button" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" disabled={busy}>{busy ? ui.saving : ui.addPaymentPlain}</CrmButton></footer>
    </form>
  </Modal>;
}
