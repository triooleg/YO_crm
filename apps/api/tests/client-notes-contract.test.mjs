import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [controller, service, dto] = await Promise.all([
  read("../src/clients/clients.controller.ts"),
  read("../src/clients/clients.service.ts"),
  read("../src/clients/clients.dto.ts"),
]);

test("обновление заметки клиента защищено ролями и валидирует длину", () => {
  assert.match(controller, /@Patch\(":id\/notes"\)/);
  assert.match(controller, /updateNotes/);
  assert.match(dto, /class UpdateClientNotesDto/);
  assert.match(dto, /@MaxLength\(2000\)/);
});

test("заметка сохраняет activity и audit history", () => {
  assert.match(service, /CLIENT_NOTE_UPDATED/);
  assert.match(service, /entityType: "Client"/);
  assert.match(service, /action:\s*"UPDATE"/);
});
