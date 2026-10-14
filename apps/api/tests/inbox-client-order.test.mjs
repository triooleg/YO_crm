import assert from "node:assert/strict";
import test from "node:test";

const { orderInboxClientRows } = await import("../src/communications/inbox-client-order.ts");

const at = (value) => new Date(value);

test("все переписки сортируются по последнему реальному сообщению независимо от ожидания", () => {
  const rows = [
    { id: "answered-new", displayName: "Answered new", lastContactAt: at("2026-10-13T12:00:00Z") },
    { id: "waiting-old", displayName: "Waiting old", lastContactAt: at("2026-10-13T09:00:00Z") },
    { id: "waiting-new", displayName: "Waiting new", lastContactAt: at("2026-10-13T10:00:00Z") },
    { id: "answered-old", displayName: "Answered old", lastContactAt: at("2026-10-13T08:00:00Z") },
  ];
  const replyStates = [
    { clientId: "answered-new", direction: "OUTBOUND", createdAt: at("2026-10-13T12:00:00Z") },
    { clientId: "waiting-old", direction: "INBOUND", createdAt: at("2026-10-13T09:00:00Z") },
    { clientId: "waiting-new", direction: "INBOUND", createdAt: at("2026-10-13T10:00:00Z") },
    { clientId: "answered-old", direction: "OUTBOUND", createdAt: at("2026-10-13T08:00:00Z") },
  ];

  assert.deepEqual(
    orderInboxClientRows(rows, replyStates).map((row) => row.id),
    ["answered-new", "waiting-new", "waiting-old", "answered-old"],
  );
});

test("несколько каналов используют самое свежее реальное сообщение", () => {
  const rows = [
    { id: "multi", displayName: "Multi", lastContactAt: at("2026-10-13T12:00:00Z") },
    { id: "single", displayName: "Single", lastContactAt: at("2026-10-13T11:00:00Z") },
  ];
  const replyStates = [
    { clientId: "multi", direction: "OUTBOUND", createdAt: at("2026-10-13T12:00:00Z") },
    { clientId: "multi", direction: "INBOUND", createdAt: at("2026-10-13T09:00:00Z") },
    { clientId: "single", direction: "INBOUND", createdAt: at("2026-10-13T10:00:00Z") },
  ];

  assert.deepEqual(orderInboxClientRows(rows, replyStates).map((row) => row.id), ["multi", "single"]);
});

test("клиенты без сообщений сохраняют стабильный fallback по контакту имени и id", () => {
  const rows = [
    { id: "b", displayName: "Анна", lastContactAt: null },
    { id: "a", displayName: "Анна", lastContactAt: null },
    { id: "recent", displayName: "Без сообщений", lastContactAt: at("2026-10-12T10:00:00Z") },
  ];

  assert.deepEqual(orderInboxClientRows(rows, []).map((row) => row.id), ["recent", "a", "b"]);
});
