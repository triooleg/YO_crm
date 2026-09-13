import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL("../components/client-workspace.tsx", import.meta.url),
  "utf8",
);

test("раздел Клиенты использует общие Mantine-контролы в согласованных точках", () => {
  assert.match(workspace, /from "\.\/crm\/settings-controls"/);
  assert.match(workspace, /<CrmTextInput[\s\S]*placeholder="Имя, телефон, Instagram…"/);
  assert.match(workspace, /<CrmButton[\s\S]*\+ Новый клиент/);
  assert.match(workspace, /<CrmTextInput[\s\S]*name="firstName"[\s\S]*required/);
  assert.match(workspace, /<CrmNativeSelect[\s\S]*name="discipline"/);
  assert.match(workspace, /<CrmNativeSelect[\s\S]*value=\{mergeSourceId\}/);
});

test("Mantine-контролы сохраняют имена полей и API payload создания клиента", () => {
  for (const name of ["firstName", "lastName", "country", "phone", "instagram", "language"]) {
    assert.match(workspace, new RegExp(`name="${name}"`));
  }
  assert.match(workspace, /Object\.fromEntries\(new FormData\(e\.currentTarget\)\)/);
  assert.match(workspace, /request\("\/clients",\s*\{[\s\S]*method: "POST"/);
  assert.match(workspace, /<CrmButton type="submit">Создать клиента<\/CrmButton>/);
});

test("Mantine-контролы не меняют payload спортсмена и объединения", () => {
  assert.match(workspace, /if \(discipline\) body\.discipline = discipline/);
  assert.match(workspace, /`\/clients\/\$\{clientId\}\/athletes`/);
  assert.match(workspace, /JSON\.stringify\(body\)/);
  assert.match(workspace, /<CrmButton type="submit" disabled=\{saving\}>/);
  assert.match(workspace, /JSON\.stringify\(\{sourceClientId:mergeSourceId\}\)/);
});

test("кнопки закрытия и сворачивания имеют доступные русские подписи", () => {
  assert.match(workspace, /clientWorkspaceUi\.collapseList/);
  assert.match(workspace, /clientWorkspaceUi\.expandList/);
  assert.match(workspace, /clientWorkspaceUi\.closeCreateClient/);
});

test("форма создания клиента удерживает и возвращает клавиатурный фокус", () => {
  assert.match(workspace, /ref=\{createClientTriggerRef\}/);
  assert.match(workspace, /returnFocusRef=\{createClientTriggerRef\}/);
  assert.match(workspace, /aria-labelledby="create-client-title"/);
  assert.match(workspace, /returnFocusRef\.current\?\.focus\(\)/);
});
