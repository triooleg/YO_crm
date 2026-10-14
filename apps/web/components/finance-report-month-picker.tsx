"use client";
import { useState, type ReactNode } from 'react';
import { MonthPicker } from '@mantine/dates';
import { Popover } from '@mantine/core';
import 'dayjs/locale/ru';
import { financeMonth } from '../lib/finance-report';
import { CrmButton } from './crm/settings-controls';

/** Both report period controls change the same month and preserve the report filters. */
export function FinanceReportMonthPicker({month,label,onChange,icon,compact=false}:{month:string;label:string;onChange:(month:string)=>void;icon?:ReactNode;compact?:boolean}){
 const [opened,setOpened]=useState(false);
 return <Popover opened={opened} onChange={setOpened} position="bottom-end" withinPortal>
  <Popover.Target><CrmButton tone="secondary" size={compact?'sm':'md'} leftSection={icon} onClick={()=>setOpened(value=>!value)} aria-label={label} aria-expanded={opened}>{financeMonth(month)} ⌄</CrmButton></Popover.Target>
  <Popover.Dropdown><MonthPicker locale="ru" value={`${month}-01`} onChange={value=>{if(value){onChange(String(value).slice(0,7));setOpened(false)}}}/></Popover.Dropdown>
 </Popover>;
}
