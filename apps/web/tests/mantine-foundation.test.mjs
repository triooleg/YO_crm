import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const [webPackage, layout, theme, shell, instructions] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/mantine-theme.ts", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../../AGENTS.md", import.meta.url), "utf8"),
]);

test("корневой интерфейс CRM использует единый MantineProvider и тему YO_crm", () => {
  const dependencies = JSON.parse(webPackage).dependencies;

  assert.equal(dependencies["@mantine/core"], "9.6.0");
  assert.equal(dependencies["@mantine/hooks"], "9.6.0");
  assert.equal(dependencies["@mantine/form"], undefined);
  assert.equal(dependencies["@mantine/dates"], dependencies["@mantine/core"]);
  assert.equal(dependencies["@mantine/notifications"], "9.6.0");
  assert.match(layout, /@mantine\/core\/styles\.css/);
  assert.match(layout, /@mantine\/notifications\/styles\.css/);
  assert.match(layout, /import \{ Notifications \} from "@mantine\/notifications"/);
  assert.match(layout, /<Notifications position="top-right" autoClose=\{3000\} limit=\{3\} containerWidth=\{360\}/);
  assert.match(layout, /<ColorSchemeScript forceColorScheme="light" \/>/);
  assert.match(layout, /<MantineProvider theme=\{yoleotardTheme\} forceColorScheme="light">/);
  assert.match(theme, /primaryColor:\s*"yoleotard"/);
  assert.match(theme, /"#6c4ad1"/);
  assert.match(theme, /defaultRadius:\s*"md"/);
  assert.match(theme, /focusRing:\s*"auto"/);
  assert.match(theme, /respectReducedMotion:\s*true/);
});

test("журнал версий служит низкорисковым Mantine Modal proof of concept", () => {
  const releaseDialog = shell.slice(
    shell.indexOf("function ReleaseHistoryDialog"),
    shell.indexOf("function CrmLogin"),
  );

  assert.match(shell, /import \{ Modal \} from "@mantine\/core"/);
  assert.match(releaseDialog, /<Modal/);
  assert.match(releaseDialog, /opened/);
  assert.match(releaseDialog, /opened=\{opened\}/);
  assert.match(releaseDialog, /onClose=\{onClose\}/);
  assert.doesNotMatch(releaseDialog, /crm-release-overlay/);
  assert.doesNotMatch(releaseDialog, /role="dialog"/);
});

test("инструкции репозитория закрепляют Mantine как стандарт универсального UI", () => {
  assert.match(instructions, /## YO_crm UI Rules/);
  assert.match(instructions, /сначала проверить возможности Mantine/);
  assert.match(instructions, /Не менять бизнес-логику в рамках UI-миграции/);
});
