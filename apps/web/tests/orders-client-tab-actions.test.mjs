import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const tabs = await readFile(new URL("../components/orders/order-expanded-tabs.tsx", import.meta.url), "utf8");

test("предпочтения и файлы клиента сохраняются через order-tabs API", () => {
  assert.match(dashboard, /updateClientPreferences/);
  assert.match(dashboard, /\/order-tabs\/clients\/\$\{clientId\}\/preferences/);
  assert.match(dashboard, /uploadClientFile/);
  assert.match(dashboard, /\/order-tabs\/clients\/\$\{clientId\}\/files/);
  assert.match(tabs, /ClientPreferencesForm/);
  assert.match(tabs, /onUploadClientFile/);
});
