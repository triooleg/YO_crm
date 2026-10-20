"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Group, Modal, Select, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { financeUi, financeReportUi as ui, ordersDashboardUi } from '../lib/i18n';
import { parseOrderPriceMinor } from '../lib/order-price';
import { FinanceRequestError, financeDate, moneyLabel, type FinanceExpenseView, type FinanceOrder, type FinanceReport, type PaymentRow } from '../lib/finance-report';
import { CrmButton } from './crm/settings-controls';

export type FinanceRequest = (path:string,init?:RequestInit)=>Promise<any>;
export function FinanceExpenseDialog({row,report,request,onClose,onSaved}:{row?:FinanceExpenseView;report:FinanceReport;request:FinanceRequest;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [category,setCategory]=useState(row?.categoryId||report.options.categories.find(item=>item.active!==false)?.id||'');
  const [order,setOrder]=useState(row?.orderId||'');
  const [amount,setAmount]=useState(row?(row.originalAmountMinor/100).toFixed(2):'');
  const [currency,setCurrency]=useState(row?.originalCurrency||report.currency);
  const [date,setDate]=useState((row?.originalTimestamp??row?.date)?.slice(0,10)||report.today);
  const [notes,setNotes]=useState(row?.notes||'');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const submitting=useRef(false);
  const [rateRetry,setRateRetry]=useState(0);
  const [rates,setRates]=useState({currency:'',loading:true,error:'',status:0});
  useEffect(()=>{
    let cancelled=false;setRates({currency,loading:true,error:'',status:0});
    void request('/finance/exchange-rates/ensure-current',{method:'POST'}).then(()=>{
      if(!cancelled)setRates({currency,loading:false,error:'',status:0});
    }).catch(reason=>{if(!cancelled)setRates({currency,loading:false,error:reason instanceof Error?reason.message:ui.error,status:reason instanceof FinanceRequestError?reason.status:0})});
    return()=>{cancelled=true};
  },[currency,rateRetry,request]);
  const ratesSettled=rates.currency===currency&&!rates.loading&&(!rates.error||rates.status===503);

  const orderRef=useRef(order);orderRef.current=order;
  const [search,setSearch]=useState(''),[remoteOrders,setRemoteOrders]=useState<FinanceReport['options']['orders']>([]);
  useEffect(()=>{let cancelled=false;const timer=setTimeout(()=>{void request(`/finance/report/options?${new URLSearchParams({search})}`).then(result=>{if(!cancelled)setRemoteOrders(current=>[...new Map([...(result.orders||[]),...current.filter(item=>item.id===orderRef.current)].map(item=>[item.id,item])).values()])}).catch(reason=>{if(!cancelled)setError((reason as Error).message)})},250);return()=>{cancelled=true;clearTimeout(timer)}},[search,request]);
  async function submit(event:FormEvent){event.preventDefault();if(submitting.current||!ratesSettled)return;const amountMinor=parseOrderPriceMinor(amount);if(amountMinor===null||amountMinor<=0){setError(ui.amountInvalid);return;}if(!category||!date)return;
    submitting.current=true;setBusy(true);setError('');
    try{const payload:Record<string,unknown>={amountMinor,currency,incurredAt:row?.originalTimestamp&&date===row.originalTimestamp.slice(0,10)?row.originalTimestamp:new Date(`${date}T12:00:00Z`).toISOString(),notes};if(!row||category!==row.categoryId)payload.categoryId=category;if(!row||order!==(row.orderId||''))payload.orderId=order||null;
      await request(row?`/finance/expenses/${encodeURIComponent(row.id)}`:'/finance/expenses',{method:row?'PATCH':'POST',body:JSON.stringify(payload)});onClose();await onSaved();
    }catch(reason){setError((reason as Error).message)}finally{submitting.current=false;setBusy(false)}
  }
  const categories=report.options.categories.filter(item=>item.active!==false||item.id===row?.categoryId);if(row&&!categories.some(item=>item.id===row.categoryId))categories.push({id:row.categoryId,name:row.categoryName});
  const orders=[...new Map([...report.options.orders,...remoteOrders].map(item=>[item.id,item])).values()];if(row?.orderId&&!orders.some(item=>item.id===row.orderId))orders.push({id:row.orderId,number:row.number||'—',clientName:'',currency:row.originalCurrency});
  return <Modal opened title={row?financeUi.editExpense:ui.addExpense} centered onClose={()=>!busy&&onClose()} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{disabled:busy}}><form onSubmit={submit}><Stack gap="sm">
    {error&&<Alert color="red" role="alert">{error}</Alert>}{!categories.length&&<Alert color="yellow">{ui.noCategories}</Alert>}
    {rates.loading&&<Text size="xs" role="status">{ui.ratesLoading}</Text>}
    {rates.error&&<Alert color={rates.status===503?"yellow":"red"} role="alert"><Stack gap="xs"><Text size="sm">{rates.error}</Text>{rates.status===503&&<Text size="sm">{ui.expenseRatesUnavailable}</Text>}<CrmButton type="button" tone="secondary" disabled={busy} onClick={()=>setRateRetry(value=>value+1)}>{ui.refresh}</CrmButton></Stack></Alert>}

    <Select label={ui.category} data={categories.map(item=>({value:item.id,label:item.name}))} value={category} onChange={value=>setCategory(value||'')} required disabled={busy} allowDeselect={false}/>
    <Select searchable clearable label={ui.order} placeholder={ui.allOrders} onSearchChange={setSearch} data={orders.map(item=>({value:item.id,label:`${item.number} · ${item.clientName}`}))} value={order||null} onChange={value=>setOrder(value||'')} disabled={busy}/>
    <Group grow><TextInput label={ui.amount} required inputMode="decimal" value={amount} onChange={event=>setAmount(event.currentTarget.value)} disabled={busy}/><Select label={ui.operationCurrency} value={currency} onChange={value=>value&&setCurrency(value)} data={['EUR','USD','UAH']} allowDeselect={false} disabled={busy}/></Group>
    <Text size="xs" c="dimmed">{ordersDashboardUi.expenseCurrencyInputHint}</Text>
    <TextInput type="date" label={ui.date} required value={date} onChange={event=>setDate(event.currentTarget.value)} disabled={busy}/><Textarea label={ui.notes} value={notes} onChange={event=>setNotes(event.currentTarget.value)} maxLength={300} disabled={busy}/>
    <Group justify="flex-end"><CrmButton tone="secondary" type="button" onClick={onClose} disabled={busy}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy} disabled={!categories.length||!ratesSettled}>{ui.save}</CrmButton></Group>
  </Stack></form></Modal>;
}

export function FinanceCategoryDialog({categories,request,onClose,onSaved}:{categories:FinanceReport['options']['categories'];request:FinanceRequest;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [editing,setEditing]=useState<string>(),[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const pending=useRef(false);
  async function mutate(path:string,method:string,body:unknown){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await request(path,{method,body:JSON.stringify(body)});setName('');setEditing(undefined);await onSaved();}catch(reason){setError((reason as Error).message)}finally{pending.current=false;setBusy(false)}}
  return <Modal opened title={ui.categories} onClose={()=>!busy&&onClose()} centered closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{disabled:busy}}><Stack gap="sm">{error&&<Alert color="red" role="alert">{error}</Alert>}
    {categories.filter(item=>item.active!==false).map(item=><Group key={item.id} justify="space-between"><Text size="sm">{item.name}</Text><Group gap="xs"><CrmButton size="compact-xs" tone="secondary" disabled={busy} onClick={()=>{setEditing(item.id);setName(item.name)}}>{ui.edit}</CrmButton><CrmButton size="compact-xs" tone="secondary" disabled={busy} onClick={()=>{if(window.confirm(ui.archiveCategoryConfirm))void mutate(`/finance/expense-categories/${encodeURIComponent(item.id)}`,'PATCH',{active:false})}}>{ui.archive}</CrmButton></Group></Group>)}
    <form onSubmit={event=>{event.preventDefault();if(name.trim())void mutate(editing?`/finance/expense-categories/${encodeURIComponent(editing)}`:'/finance/expense-categories',editing?'PATCH':'POST',{name:name.trim()})}}><Stack gap="sm"><TextInput required label={editing?ui.categoryName:ui.createCategory} value={name} onChange={event=>setName(event.currentTarget.value)} disabled={busy}/><Group justify="flex-end">{editing&&<CrmButton type="button" tone="secondary" disabled={busy} onClick={()=>{setEditing(undefined);setName('')}}>{ui.cancel}</CrmButton>}<CrmButton type="submit" loading={busy}>{ui.save}</CrmButton></Group></Stack></form>
  </Stack></Modal>;
}

export function FinanceOrderDialog({order,row,currency,onClose}:{order:FinanceOrder;row?:PaymentRow;currency:string;onClose:()=>void}){
  return <Modal opened size="lg" title={`${ui.orderDetails}: ${order.number}`} onClose={onClose} centered><Stack gap="sm">
    <Text fw={600}>{order.client.displayName}</Text>
    {row&&<Group justify="space-between"><Text>{ui.amount}: {moneyLabel(row.amountMinor,currency)}</Text><Text c="green">{ui.paid}: {moneyLabel(row.paidMinor,currency)}</Text><Text c="red">{ui.balance}: {moneyLabel(row.balanceMinor,currency)}</Text></Group>}
    {row&&row.roundingDifferenceMinor!==0&&<Text size="xs" c="dimmed">{ui.rounding}: {moneyLabel(row.roundingDifferenceMinor,currency)}</Text>}
    <Text size="sm" c="dimmed">{ui.original}: {moneyLabel(order.priceMinor,order.currency)}</Text><Text fw={600} size="sm">{ui.activePayments}</Text>
    <Table.ScrollContainer minWidth={480}><Table><Table.Thead><Table.Tr><Table.Th>{ui.date}</Table.Th><Table.Th>{ui.amount}</Table.Th><Table.Th>{ui.method}</Table.Th><Table.Th>{ui.notes}</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{order.payments.map((payment,index)=><Table.Tr key={payment.id||index}><Table.Td>{financeDate(payment.receivedAt)}</Table.Td><Table.Td><Tooltip label={`${ui.original}: ${moneyLabel(payment.amountMinor,payment.currency)}`}><Badge variant="light">{moneyLabel(payment.displayAmountMinor,order.displayCurrency)}</Badge></Tooltip></Table.Td><Table.Td>{ui.paymentMethods[payment.method as keyof typeof ui.paymentMethods]||payment.method||'—'}</Table.Td><Table.Td>{[payment.reference,payment.notes].filter(Boolean).join(' · ')||'—'}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
    {!order.payments.length&&<Text c="dimmed" size="sm">{ui.empty}</Text>}
  </Stack></Modal>;
}
