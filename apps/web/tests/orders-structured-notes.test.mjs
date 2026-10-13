import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const tabs = await readFile(new URL("../components/orders/order-expanded-tabs.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("структурированные заметки используют существующие endpoints и перечитывают раскрытый заказ", () => {
  assert.match(dashboard, /async function createOrderNote/);
  assert.match(dashboard, /`\/order-tabs\/\$\{orderId\}\/notes`[\s\S]*method:\s*"POST"/);
  assert.match(dashboard, /`\/order-tabs\/\$\{orderId\}\/notes\/\$\{noteId\}`[\s\S]*method:\s*"PATCH"/);
  assert.match(dashboard, /`\/order-tabs\/\$\{orderId\}\/notes\/\$\{noteId\}`[\s\S]*method:\s*"DELETE"/);
  assert.match(dashboard, /await refreshOrder\(orderId\)/);
  for (const callback of ["onCreateNote", "onUpdateNote", "onArchiveNote"])
    assert.match(dashboard, new RegExp(callback));
});

test("редактирование передаёт optimistic expectedUpdatedAt из выбранной заметки", () => {
  assert.match(tabs, /expectedUpdatedAt:\s*editingNote\.updatedAt/);
  assert.match(tabs, /onUpdateNote\(editingNote\.id/);
  assert.match(tabs, /CrmTextInput/);
  assert.match(tabs, /CrmTextarea/);
  assert.match(tabs, /CrmNativeSelect/);
  assert.match(tabs, /className="orders-note-editor-placeholder"/);
  assert.match(tabs, /<OrderNoteForm key=\{editingNote\?\.id \|\| "new"\}/);
  assert.match(tabs, /onArchiveNote\(note\.id\)/);
  assert.doesNotMatch(tabs, /fetch\(/);
});

test("весь новый текст заметок хранится в русском словаре", () => {
  for (const key of ["editNote", "archiveNote", "noteTitle", "noteBody", "noteCategory", "noteVisibility", "saveNote", "archiveNoteConfirm"])
    assert.match(i18n, new RegExp(`${key}:`));
});

test("заметки остаются одной из девяти inline-вкладок раскрытой строки", () => {
  assert.match(dashboard, /expandedId === order\.id && <tr className="orders-expanded-row"/);
  assert.match(tabs, /activeTab === "notes" && <OrderNotesTab/);
});

test("редактор заметки форматирует выделение и прикрепляет файл через существующий заказ", () => {
  assert.match(tabs, /role="toolbar" aria-label=\{ui\.noteFormatting\}/);
  assert.match(tabs, /formatBody\("\*\*"\)/);
  assert.match(tabs, /formatLines\("- "\)/);
  assert.match(tabs, /onUploadFile=\{onUploadFile\}/);
  assert.match(tabs, /await onUploadFile\(file\)/);
  for (const key of ["noteFormatting", "noteBold", "noteItalic", "noteUnderline", "noteBulletedList", "noteNumberedList", "noteLink", "attachFileToNote", "noteFileHint"])
    assert.match(i18n, new RegExp(`${key}:`));
});
