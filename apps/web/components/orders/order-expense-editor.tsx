"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@mantine/core";
import { financeUi, orderFormUi, ordersDashboardUi as ui } from "../../lib/i18n";
import { parseOrderPriceMinor } from "../../lib/order-price";
import { CrmAlert } from "../crm/alert";
import { CrmButton, CrmNativeSelect, CrmTextInput, CrmTextarea } from "../crm/settings-controls";

type Actions = { request: (path:string,init?:RequestInit)=>Promise<any>; onSaved:()=>Promise<void> };
export function OrderExpenseEditor({orderId,orderNumber,currency:initialCurrency,actions,onClose}:{orderId:string;orderNumber:string;currency:string;actions:Actions;onClose:()=>void}) {
  const [categories,setCategories]=useState<{id:string;name:string}[]>([]);
  const [categoryId,setCategoryId]=useState("");
  const [currency,setCurrency]=useState(["EUR","USD","UAH"].includes(initialCurrency)?initialCurrency:"EUR");
  const [amount,setAmount]=useState(""),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[notes,setNotes]=useState("");
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  const [categoryLoadFailed,setCategoryLoadFailed]=useState(false);
  const submitting=useRef(false);
  const requestRef=useRef(actions.request);
  requestRef.current=actions.request;
  const request=(path:string,init?:RequestInit)=>requestRef.current(path,init);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setCategoryLoadFailed(false);setError("");
    request("/finance").then(data=>{
      if(cancelled)return;
      const available=(data.categories as {id:string;name:string;active?:boolean}[]).filter(category=>category.active!==false);
      setCategories(available);setCategoryId(current=>available.some(category=>category.id===current)?current:(available[0]?.id||""));
    }).catch(reason=>{if(!cancelled){setCategoryLoadFailed(true);setError((reason as Error).message)}}).finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[retry]);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(submitting.current)return;
    const amountMinor=parseOrderPriceMinor(amount);
    if(amountMinor===null||amountMinor<=0){setError(orderFormUi.priceInvalid);return;}
    if(!categories.some(category=>category.id===categoryId)||!date)return;
    submitting.current=true;setBusy(true);setCategoryLoadFailed(false);setError("");
    try{
      await request("/finance/expenses",{method:"POST",body:JSON.stringify({orderId,categoryId,amountMinor,currency,incurredAt:new Date(date+"T12:00:00.000Z").toISOString(),notes:notes.trim()||undefined})});
      await actions.onSaved();onClose();
    }catch(reason){setError((reason as Error).message)}finally{submitting.current=false;setBusy(false)}
  }
  return <Modal opened centered title={`${ui.financeAddExpense}: ${orderNumber}`} onClose={onClose} closeOnEscape={!busy} closeOnClickOutside={!busy} withCloseButton={!busy}>
    <form className="orders-expense-form" onSubmit={submit}>
      {loading?<p>{ui.loading}</p>:categories.length===0&&!error?<CrmAlert>{ui.expenseCategoriesMissing}</CrmAlert>:null}
      <CrmNativeSelect label={ui.expenseType} value={categoryId} disabled={busy||loading||!categories.length} onChange={event=>setCategoryId(event.currentTarget.value)} data={categories.map(category=>({value:category.id,label:category.name}))} required />
      <CrmTextInput label={financeUi.amount} inputMode="decimal" value={amount} disabled={busy} onChange={event=>setAmount(event.currentTarget.value)} required />
      <CrmNativeSelect label={financeUi.currency} description={ui.expenseCurrencyInputHint} value={currency} disabled={busy} onChange={event=>setCurrency(event.currentTarget.value)} data={["EUR","USD","UAH"]} />
      <CrmTextInput label={financeUi.date} type="date" value={date} disabled={busy} onChange={event=>setDate(event.currentTarget.value)} required />
      <CrmTextarea label={financeUi.notes} value={notes} disabled={busy} maxLength={300} onChange={event=>setNotes(event.currentTarget.value)} />
      <small>{ui.financeExpensesHint}</small>
      {error&&<CrmAlert>{error}{categoryLoadFailed&&<CrmButton type="button" tone="secondary" disabled={busy} onClick={()=>setRetry(value=>value+1)}>{ui.retryExpenseCategories}</CrmButton>}</CrmAlert>}
      <footer><CrmButton type="button" tone="secondary" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy} disabled={loading||!categories.length}>{financeUi.saveExpense}</CrmButton></footer>
    </form>
  </Modal>;
}
