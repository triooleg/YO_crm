import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [settings, controls, theme, compatibilityCss] = await Promise.all([
  readFile(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/crm/settings-controls.tsx", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../lib/mantine-theme.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/mantine-overrides.css", import.meta.url), "utf8"),
]);

test("shared CRM settings controls use Mantine without changing native form semantics", () => {
  assert.match(controls, /from "@mantine\/core"/);
  assert.match(controls, /forwardRef/);
  assert.match(controls, /Button/);
  assert.match(controls, /ActionIcon/);
  assert.match(controls, /Checkbox/);
  assert.match(controls, /TextInput/);
  assert.match(controls, /CrmButton/);
  assert.match(controls, /CrmActionIcon/);
  assert.match(controls, /CrmCheckbox/);
  assert.match(controls, /CrmTextInput/);
  assert.match(controls, /CrmNativeSelect/);
  assert.match(controls, /forwardRef<HTMLButtonElement, CrmButtonProps>/);
  assert.match(controls, /forwardRef<HTMLButtonElement, CrmActionIconProps>/);
  assert.match(controls, /forwardRef<HTMLInputElement, TextInputProps>/);
  assert.match(controls, /forwardRef<HTMLSelectElement, NativeSelectProps>/);
  assert.match(controls, /inputWrapperOrder=\{\["label", "input", "description", "error"\]\}/);
  assert.match(controls, /value="on"/);
  assert.match(controls, /useMantineTheme/);
  assert.match(controls, /useMantineTheme\(\)\.other\.crmControls/);
  assert.match(theme, /crmControls:\s*\{/);
  assert.match(theme, /controlHeight:\s*38/);
  assert.doesNotMatch(compatibilityCss, /\.crm-button\s*\{[^}]*min-height/s);
  assert.doesNotMatch(compatibilityCss, /\.crm-text-input \.mantine-TextInput-input\s*\{[^}]*min-height/s);
});

test("summary detail keeps its global AI setting contract through Mantine NativeSelect", () => {
  assert.match(controls, /NativeSelect/);
  assert.match(settings, /<CrmNativeSelect[\s\S]*label=\{summaryFormatUi\.title\}/);
  assert.match(settings, /value=\{String\(effective\.summaryDetailLevel\|\|"DETAILED"\)\}/);
  assert.match(settings, /update\("summaryDetailLevel",event\.target\.value,true\)/);
  assert.match(settings, /value:"COMPACT",label:summaryFormatUi\.compact/);
  assert.match(settings, /value:"DETAILED",label:summaryFormatUi\.detailed/);
});

test("branding and production forms use shared controls and preserve payload field names", () => {
  assert.match(settings, /<CrmCheckbox[\s\S]*name="useInHeader"/);
  assert.match(settings, /<CrmCheckbox[\s\S]*name="useInMessages"/);
  assert.match(settings, /<CrmTextInput[\s\S]*name="defaultDurationDays"/);
  assert.match(settings, /<CrmTextInput[\s\S]*name="shippingLeadDays"/);
  assert.match(settings, /<CrmButton/);
  assert.match(settings, /new FormData\(formElement\)/);
  assert.match(settings, /new FormData\(e\.currentTarget\)/);
  assert.match(settings, /form\.get\("useInHeader"\)/);
  assert.match(settings, /form\.get\("useInMessages"\)/);
  assert.match(settings, /form\.get\("defaultDurationDays"\)/);
  assert.match(settings, /form\.get\("shippingLeadDays"\)/);
});
