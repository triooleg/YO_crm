"use client";
import { Select, alpha, useMantineTheme } from "@mantine/core";
import { ordersDashboardUi as ui } from "../../lib/i18n";
import { CrmStatusBadge, crmStatusPresentation } from "./status-badge";

export function SalesStatusSelect({ value, statuses, disabled, onChange }: { value: string; statuses: string[]; disabled: boolean; onChange: (value: string) => void }) {
  const theme = useMantineTheme();
  const presentation = crmStatusPresentation("sales",value);
  const colors = theme.colors[presentation.color]!;
  return <Select aria-label={ui.changeStatus} value={value} disabled={disabled} allowDeselect={false}
    className="orders-inline-status-control" classNames={{input:"orders-inline-status"}}
    comboboxProps={{width:280,position:"bottom-end"}}
    onChange={next => { if(next) onChange(next); }}
    data={statuses.map(status=>({value:status,label:crmStatusPresentation("sales",status).label}))}
    renderOption={({option}) => <CrmStatusBadge domain="sales" status={option.value} />}
    styles={{input:{backgroundColor:alpha(colors[6]!,0.15),color:colors[9]!,border:0}}} />;
}
