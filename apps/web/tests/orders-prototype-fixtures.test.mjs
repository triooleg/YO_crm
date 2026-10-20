import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const prototype = await readFile(new URL("../prototypes/orders-layouts/index.html", import.meta.url), "utf8");

test("прототип заказов содержит только явно тестовые идентификаторы", () => {
  assert.doesNotMatch(prototype, /Lucie Soula|Sarah Galido|Lorena Melian|Kim Rioux|wanadoo\.fr|PC000020000071397N|Résidence les Vignes|Oleh Ohilko/);
  const clients = [...prototype.matchAll(/client:'([^']+)'/g)].map((match) => match[1]);
  const athletes = [...prototype.matchAll(/athlete:'([^']+)'/g)].map((match) => match[1]);
  assert.ok(clients.length > 0);
  assert.ok(athletes.length > 0);
  assert.ok(clients.every((name) => name.startsWith("Тестов")));
  assert.ok(athletes.every((name) => name.startsWith("Тестов")));
  const emails = prototype.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  assert.ok(emails.length > 0);
  assert.ok(emails.every((email) => email.endsWith("@example.test")));
  const tracks = prototype.match(/track:'([^']+)'/g) || [];
  assert.ok(tracks.every((entry) => entry.includes("TEST-TRACK") || entry.includes("—")));
});
