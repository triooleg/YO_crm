import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");

test("сервер не подтверждает производство до требуемой предоплаты", () => {
  assert.match(service, /depositRequiredMinor/);
  assert.match(service, /order\.payments/);
  assert.match(service, /productionStatus/);
  assert.match(service, /можно планировать только предварительно/);
});
