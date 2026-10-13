"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { Drawer, Tabs } from "@mantine/core";
import { athleteMeasurementWizardUi as ui, ordersDashboardUi, measurementEditorUi } from "../lib/i18n";
import { CrmNativeSelect, CrmTextInput } from "./crm/settings-controls";
import { additionalMeasurementNumbers, basicMeasurementNumbers, measurementFieldLabels, measurementPresetHeights } from "./measurement-definition";

type Props = {
  opened?: boolean;
  title: string;
  description: string;
  values: Record<string, string>;
  standardHeight?: number;
  busy: boolean;
  onValue: (key: string, value: string) => void;
  onHeight: (height: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  context?: ReactNode;
  error?: ReactNode;
  footer: ReactNode;
};

// Save destinations and immutable-snapshot rules remain owned by the caller.
export function MeasurementEditor({ opened = true, title, description, values, standardHeight, busy, onValue, onHeight, onClose, onSubmit, context, error, footer }: Props) {
  const [section, setSection] = useState<string | null>("basic");
  const groups = [{ key: "basic", numbers: basicMeasurementNumbers }, { key: "additional", numbers: additionalMeasurementNumbers }];
  return <Drawer opened={opened} title={title} aria-label={title} onClose={() => !busy && onClose()} position="right" size="min(720px, 100%)" trapFocus returnFocus closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ "aria-label": ui.close, disabled: busy }} classNames={{ content: "measurement-editor", header: "measurement-editor-header", body: "measurement-editor-body" }}>
    <p className="measurement-editor-description">{description}</p>
    <form className="measurement-editor-form" noValidate onSubmit={event => {
      event.preventDefault();
      // Hidden panels remain mounted to retain values. Reveal the first invalid
      // field before native validation focuses it, avoiding hidden-control errors.
      const input = event.currentTarget.querySelector<HTMLInputElement>("input:invalid");
      if (input) {
        setSection(basicMeasurementNumbers.includes(Number(input.name.slice(1))) ? "basic" : "additional");
        window.requestAnimationFrame(() => { input.focus(); input.scrollIntoView({ block: "nearest" }); input.reportValidity(); });
        return;
      }
      onSubmit(event);
    }}>
      <div className="measurement-editor-scroll">
        {context}
        <h3>{ui.athleteMeasurements}</h3>
        <CrmNativeSelect label={ui.standardHeight} value={standardHeight === undefined ? "" : String(standardHeight)} disabled={busy} onChange={event => onHeight(event.currentTarget.value)} data={[{ value: "", label: ui.standardHeightOptional }, ...measurementPresetHeights.map(height => ({ value: String(height), label: `${height} см` }))]} />
        <p className="measurement-editor-hint">{measurementEditorUi.hint}</p>
        <Tabs value={section} onChange={setSection} keepMounted>
          <Tabs.List aria-label={ordersDashboardUi.measurementSections}>
            <Tabs.Tab value="basic">{ordersDashboardUi.basicMeasurements}</Tabs.Tab>
            <Tabs.Tab value="additional">{ordersDashboardUi.additionalMeasurements}</Tabs.Tab>
          </Tabs.List>
          {groups.map(({ key, numbers }) => <Tabs.Panel value={key} key={key}>
            <div className="measurement-editor-table">
              <header><span>{ui.measurementNumber}</span><span>{ui.measurementParameter}</span><span>{ui.measurementValue}</span></header>
              {numbers.map(number => <label key={number} className={basicMeasurementNumbers.includes(number) ? "required" : undefined}>
                <b>{number}</b><span>{measurementFieldLabels[number - 1]}{basicMeasurementNumbers.includes(number) ? " *" : ""}</span>
                <CrmTextInput name={`m${number}`} aria-label={`${number}. ${measurementFieldLabels[number - 1]}`} type="number" min={1} step={0.5} required={basicMeasurementNumbers.includes(number)} disabled={busy} value={values[`m${number}`] || ""} onChange={event => { const value = event.currentTarget.value; onValue(`m${number}`, value); }} placeholder="см" />
              </label>)}
            </div>
          </Tabs.Panel>)}
        </Tabs>
        <aside className="measurement-editor-storage"><strong>{ui.measurementStorageTitle}</strong><span>{ui.measurementStorageHint}</span></aside>
        {error}
      </div>
      {footer}
    </form>
  </Drawer>;
}
