"use client";

import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Alert, Button, Group, Popover, Stack, UnstyledButton} from '@mantine/core';
import {DateInput} from '@mantine/dates';
import 'dayjs/locale/ru';
import {ordersDashboardUi as ui, orderCreatedDateUi as labels} from '../../lib/i18n';
import {parseFinanceDateInput} from '../../lib/finance-report';

export type OrderCreatedDateReceipt = {id: string; createdAt: string};
export type OrderCreatedDateActions = {
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  onSaved: (saved: OrderCreatedDateReceipt) => Promise<void>;
};
import {orderCreatedCalendarDay as calendarDay, changeOrderCreatedCalendarDay} from '../../lib/order-created-date';

/** Correct the displayed calendar day while retaining the original Kyiv time.
 * A receipt reconciles only its own order, including when a filtered row unmounts.
 */
export function OrderCreatedDateEditor({order, actions, children}: {
  order: OrderCreatedDateReceipt; actions?: OrderCreatedDateActions; children: ReactNode;
}) {
  const owner = useMemo(()=>({id: order.id, createdAt: order.createdAt, allowed: !!actions}),[order.id, order.createdAt, !!actions]);
  const live = useRef<typeof owner|null>(owner); live.current = owner;
  useEffect(()=>{live.current=owner;return()=>{live.current=null}},[owner]);
  const pending = useRef(false);
  const [state, setState] = useState({owner, opened:false, value:calendarDay(order.createdAt) as string|null, busy:false, error:''});
  const active = state.owner === owner, opened = !!actions && active && state.opened, busy = active && state.busy;
  const value = active ? state.value : calendarDay(order.createdAt);
  function toggle(opened: boolean) {
    if (!actions || pending.current) return;
    setState({owner, opened, value:calendarDay(order.createdAt), busy:false, error:''});
  }
  async function save() {
    if (!actions || !opened || pending.current || live.current !== owner || !value || value === calendarDay(order.createdAt)) return;
    const createdAt = changeOrderCreatedCalendarDay(order.createdAt,value);
    if (!createdAt) {setState(old=>({...old,error:labels.invalid}));return;}
    pending.current=true;setState(old=>({...old,busy:true,error:''}));
    try {
      const result = await actions.request(`/orders/${encodeURIComponent(order.id)}/created-at`,{method:'PATCH',body:JSON.stringify({createdAt,expectedCreatedAt:order.createdAt})}) as OrderCreatedDateReceipt;
      if (!result || result.id !== order.id || typeof result.createdAt !== 'string' || !Number.isFinite(Date.parse(result.createdAt))) throw Error();
      await actions.onSaved({id:result.id,createdAt:result.createdAt});
      if (live.current===owner) setState(old=>({...old,opened:false,error:''}));
    } catch (error) {
      if (live.current===owner) setState(old=>({...old,error:(error as {status?:number})?.status===409?labels.conflict:labels.saveFailed}));
    } finally {pending.current=false;if(live.current===owner)setState(old=>({...old,busy:false}));}
  }
  if (!actions) return <strong>{children}</strong>;
  return <Popover opened={opened} onChange={toggle} position="bottom-start" width={320} trapFocus returnFocus withArrow closeOnEscape={!busy} closeOnClickOutside={!busy}>
    <Popover.Target><UnstyledButton aria-label={labels.edit} aria-expanded={opened} disabled={busy} onClick={()=>toggle(!opened)}><strong>{children}</strong></UnstyledButton></Popover.Target>
    <Popover.Dropdown role="dialog" aria-label={labels.title} style={{maxWidth:'calc(100vw - 24px)'}}>
      <form onSubmit={event=>{event.preventDefault();void save()}}><Stack gap="sm">
        <DateInput data-autofocus label={labels.title} locale="ru" valueFormat="DD.MM.YYYY" dateParser={parseFinanceDateInput} value={value} onChange={value=>setState(old=>({...old,value,error:''}))} disabled={busy} popoverProps={{withinPortal:false}}/>
        {active && state.error && <Alert color="red" role="alert">{state.error}</Alert>}
        <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={()=>toggle(false)}>{ui.cancel}</Button><Button type="submit" loading={busy} disabled={!value || value===calendarDay(order.createdAt) || pending.current}>{ui.save}</Button></Group>
      </Stack></form>
    </Popover.Dropdown>
  </Popover>;
}
