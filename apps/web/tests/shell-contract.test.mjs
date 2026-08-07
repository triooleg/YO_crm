import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");

test("daily CRM shell exposes core work areas", () => {
  for (const label of ["Inbox", "Clients", "Orders", "Production", "Finance", "Shipping", "Tasks"]) assert.ok(page.includes(label));
});
test("shell includes a phone breakpoint", () => {
  assert.match(css, /@media\(max-width:720px\)/);
});
