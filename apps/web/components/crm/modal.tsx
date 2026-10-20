import { Modal } from "@mantine/core";
import type { ReactNode } from "react";
import { crmModalUi } from "../../lib/i18n";
import { CrmActionIcon } from "./settings-controls";

export function CrmModal({title,close,children,busy=false,className}:{title:string;close:()=>void;children:ReactNode;busy?:boolean;className?:string}){
  return <Modal opened onClose={close} centered size="lg" withCloseButton={false} closeOnEscape={!busy} closeOnClickOutside={!busy} trapFocus returnFocus classNames={{content:["finance-modal",className].filter(Boolean).join(" "),header:"crm-modal-header",body:"crm-modal-body"}} title={<div className="crm-modal-heading"><h2>{title}</h2><CrmActionIcon type="button" onClick={close} disabled={busy} aria-label={crmModalUi.close}>×</CrmActionIcon></div>}>{children}</Modal>;
}
