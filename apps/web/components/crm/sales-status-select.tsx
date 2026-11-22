"use client";
import { Select, alpha, useMantineTheme } from "@mantine/core";
import type { OrderStatusOption } from "../../lib/order-status-options";
import { ordersDashboardUi as ui } from "../../lib/i18n";
import { CrmStatusBadge, crmStatusPresentation } from "./status-badge";

export function SalesStatusSelect({ value, baseStatus = value, overrides = [], statuses, disabled, onChange, color }: { value: string; baseStatus?: string; overrides?: OrderStatusOption[]; statuses: string[]; disabled: boolean; onChange: (value: string) => void; color?: string }) {
  const theme = useMantineTheme();
  const presentation = baseStatus === value ? crmStatusPresentation("sales",value) : crmStatusPresentation("sales",baseStatus);
  const current = overrides.find(option => option.id === value);
  const label = current?.label ?? presentation.label;
  const options = [...new Set([...statuses, ...overrides.filter(option => option.id !== option.baseStatus).map(option => option.id), value])]
    .filter(id => id === value || !overrides.find(option => option.id === id)?.archivedAt)
    .map(id => {
      const option = overrides.find(item => item.id === id);
      return { value: id, label: option?.label ?? crmStatusPresentation("sales",option?.baseStatus ?? (id === value ? baseStatus : id)).label };
    });
  const colors = theme.colors[presentation.color]!;
  const tint = color ?? colors[6]!;
  return <Select aria-label={ui.changeStatus} title={label} value={value} disabled={disabled} allowDeselect={false}
      className="orders-inline-status-control" classNames={{input:"orders-inline-status"}}
      comboboxProps={{width:280,position:"bottom-end"}}
      onChange={next => { if(next) onChange(next); }}
      data={options}
      renderOption={({option}) => <CrmStatusBadge domain="sales" status={overrides.find(item => item.id === option.value)?.baseStatus ?? option.value}
        label={option.label} color={overrides.find(item => item.id === option.value)?.color ?? undefined} />}
      styles={{input:{backgroundColor:alpha(tint,0.15),color:colors[9]!,border:0}}} />;
}
