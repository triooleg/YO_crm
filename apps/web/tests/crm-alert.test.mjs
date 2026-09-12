import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("общий Mantine Alert используется для ошибок рабочих разделов", () => {
  const alert = read("components/crm/alert.tsx");
  assert.match(alert, /import \{ Alert \} from "@mantine\/core"/);
  assert.match(alert, /role="alert"/);
  assert.match(alert, /closeButtonLabel=\{crmAlertUi\.close\}/);

  for (const component of [
    "components/production-workspace.tsx",
    "components/finance-workspace.tsx",
    "components/tasks-workspace.tsx",
  ]) {
    const source = read(component);
    assert.match(source, /import \{ CrmAlert \} from "\.\/crm\/alert"/);
    assert.match(source, /<CrmAlert/);
  }
});
