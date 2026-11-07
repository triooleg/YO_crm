"use client";
import { ActionIcon, Button, ColorSwatch, Input, Popover, Select, Stack, Text, alpha, useMantineTheme } from "@mantine/core";
import { ordersDashboardUi as ui } from "../../lib/i18n";
import { CrmStatusBadge, crmStatusPresentation } from "./status-badge";

export function SalesStatusSelect({ value, statuses, disabled, onChange, color, onColorChange }: { value: string; statuses: string[]; disabled: boolean; onChange: (value: string) => void; color?: string; onColorChange: (color: string | undefined) => void }) {
  const theme = useMantineTheme();
  const presentation = crmStatusPresentation("sales",value);
  const colors = theme.colors[presentation.color]!;
  const tint = color ?? colors[6]!;
  const editLabel = ui.changeStatusColor.replace("{status}", presentation.label);
  const title = ui.statusColorTitle.replace("{status}", presentation.label);
  return <div className="orders-status-with-color">
    <Select aria-label={ui.changeStatus} title={presentation.label} value={value} disabled={disabled} allowDeselect={false}
      className="orders-inline-status-control" classNames={{input:"orders-inline-status"}}
      comboboxProps={{width:280,position:"bottom-end"}}
      onChange={next => { if(next) onChange(next); }}
      data={statuses.map(status=>({value:status,label:crmStatusPresentation("sales",status).label}))}
      renderOption={({option}) => <CrmStatusBadge domain="sales" status={option.value} />}
      styles={{input:{backgroundColor:alpha(colors[6]!,0.15),color:colors[9]!,border:0}}} />
    <Popover width={240} position="bottom-end" trapFocus returnFocus withArrow>
      <Popover.Target>
        <ActionIcon type="button" variant="default" size="sm" aria-label={editLabel} title={editLabel}>
          <ColorSwatch color={tint} size={13} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown aria-label={title}>
        <Stack gap="xs">
          <Text size="sm" fw={600}>{title}</Text>
          <Text size="xs" c="dimmed">{ui.statusColorScope}</Text>
          <Input type="color" aria-label={ui.chooseStatusColor} value={tint}
            onChange={event => onColorChange(event.currentTarget.value)} />
          <Button variant="subtle" size="compact-sm" disabled={!color} onClick={() => onColorChange(undefined)}>
            {ui.resetStatusColor}
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  </div>;
}
