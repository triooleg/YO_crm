import { Tabs } from "@mantine/core";
import type { ReactNode } from "react";
export type CrmTab={value:string;label:string;icon?:ReactNode;disabled?:boolean;panelId?:string;tabId?:string;title?:string};
export function CrmTabList({value,onChange,tabs,className,ariaLabel}:{value:string;onChange:(value:string)=>void;tabs:CrmTab[];className?:string;ariaLabel:string}){return <Tabs value={value} onChange={next=>next&&onChange(next)} keepMounted={false}><Tabs.List className={className} aria-label={ariaLabel}>{tabs.map(tab=><Tabs.Tab key={tab.value} id={tab.tabId} value={tab.value} disabled={tab.disabled} aria-controls={tab.panelId} title={tab.title} leftSection={tab.icon}>{tab.label}</Tabs.Tab>)}</Tabs.List></Tabs>}
