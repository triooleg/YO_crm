"use client";

import { Select, Group, useMantineTheme } from "@mantine/core";
import { ordersDashboardUi as ui } from "../../lib/i18n";
import { countryChoices, countryMatchesPrefix, findCountry } from "../../lib/country-options.mjs";

export function CountrySelect({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const choices = countryChoices(value);
  const controls = useMantineTheme().other.crmControls;
  const selected = findCountry(value);
  return <Select label={ui.country} searchable clearable disabled={disabled} value={value || null}
    onChange={next => onChange(next || "")} data={choices} placeholder={ui.countrySearch} nothingFoundMessage={ui.countryNotFound}
    leftSection={selected && <span aria-hidden className={`fi fi-${selected.code}`} />}
    filter={({ options, search }) => options.filter(option => "value" in option && countryMatchesPrefix(choices.find(country => country.value === option.value)!, search))}
    renderOption={({ option }) => <Group gap="xs"><span aria-hidden className={`fi fi-${choices.find(country=>country.value === option.value)?.code}`} /><span>{option.label}</span></Group>}
    styles={{ label: { color: controls.fieldLabelColor, marginBottom: controls.fieldLabelMarginBottom, fontWeight: controls.fieldLabelFontWeight }, input: { minHeight: controls.controlHeight, borderColor: controls.fieldBorderColor, backgroundColor: controls.highlightedFieldBackground } }} />;
}
