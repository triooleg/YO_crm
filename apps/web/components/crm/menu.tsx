import { Menu } from "@mantine/core";
import type { ReactNode } from "react";
import { CrmActionIcon } from "./settings-controls";
export type CrmMenuItem={label:string;onClick:()=>void};
export function CrmMenu({label,items,children="⌄",className}:{label:string;items:CrmMenuItem[];children?:ReactNode;className?:string}){return <Menu position="bottom-end" withinPortal shadow="md"><Menu.Target><CrmActionIcon className={className} type="button" aria-label={label}>{children}</CrmActionIcon></Menu.Target><Menu.Dropdown>{items.map(item=><Menu.Item key={item.label} onClick={item.onClick}>{item.label}</Menu.Item>)}</Menu.Dropdown></Menu>}
