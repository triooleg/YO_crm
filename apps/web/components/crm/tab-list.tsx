import { Tabs } from "@mantine/core";
export type CrmTab={value:string;label:string;disabled?:boolean};
export function CrmTabList({value,onChange,tabs,className,ariaLabel}:{value:string;onChange:(value:string)=>void;tabs:CrmTab[];className?:string;ariaLabel:string}){return <Tabs value={value} onChange={next=>next&&onChange(next)} keepMounted={false}><Tabs.List className={className} aria-label={ariaLabel}>{tabs.map(tab=><Tabs.Tab key={tab.value} value={tab.value} disabled={tab.disabled}>{tab.label}</Tabs.Tab>)}</Tabs.List></Tabs>}
