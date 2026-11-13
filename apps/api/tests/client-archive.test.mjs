import test from "node:test";
import assert from "node:assert/strict";
import {loadTargetModule} from "./website-test-loader.mjs";

const {ClientsService} = loadTargetModule("clients/clients.service.ts");

test("archiving one client is audited atomically and a repeat does not write again", async () => {
  const rows = new Map([["client", null], ["other", null]]);
  const history = [];
  const updatedAt = new Date("2026-11-01T12:00:00Z");
  let hasOrder = false, isMergeTarget = false;
  let failAudit = true;
  const tx = {
    $executeRaw: async (_strings, key) => assert.equal(key, "client-merge-global"),
    order: {findFirst: async ({where}) => {
      assert.deepEqual(where, {clientId: "client", archivedAt: null});
      return hasOrder ? {id: "order"} : null;
    }},
    clientMergeRedirect: {findFirst: async ({where}) => {
      assert.deepEqual(where, {targetClientId: "client"});
      return isMergeTarget ? {sourceClientId: "duplicate"} : null;
    }},
    client: {
      updateMany: async ({where, data}) => {
        assert.equal(where.archivedAt, null);
        assert.equal(where.updatedAt, updatedAt);
        assert.deepEqual(Object.keys(data), ["archivedAt"]);
        if (rows.get(where.id) !== null) return {count: 0};
        rows.set(where.id, data.archivedAt);
        return {count: 1};
      },
      findUnique: async ({where}) => rows.has(where.id) ? {archivedAt: rows.get(where.id), updatedAt} : null,
    },
    activity: {create: async ({data}) => history.push(data)},
    auditLog: {create: async ({data}) => {
      if (failAudit) throw Error("audit failed");
      history.push(data);
    }},
  };
  const db = {$transaction: async run => {
    const previous = new Map(rows), length = history.length;
    try { return await run(tx); } catch (error) {
      for (const [id, value] of previous) rows.set(id, value);
      history.length = length;
      throw error;
    }
  }};
  const service = new ClientsService(db);
  const archive = (version = updatedAt.toISOString()) => service.archive("client", version, {id: "owner"});
  await assert.rejects(archive("2026-10-31T12:00:00Z"), /Карточка клиента изменилась/);
  hasOrder = true;
  await assert.rejects(archive(), /неархивные заказы/);
  hasOrder = false;
  isMergeTarget = true;
  await assert.rejects(archive(), /после объединения/);
  isMergeTarget = false;
  assert.equal(history.length, 0);
  await assert.rejects(archive(), /audit failed/);
  assert.equal(rows.get("client"), null);
  failAudit = false;
  await archive();
  assert.ok(rows.get("client") instanceof Date);
  assert.equal(rows.get("other"), null);
  assert.deepEqual(history.map(row => [row.actorId, row.type ?? row.action]), [["owner", "CLIENT_ARCHIVED"], ["owner", "ARCHIVE"]]);
  await archive();
  assert.equal(history.length, 2);
  await assert.rejects(service.archive("missing", updatedAt.toISOString(), {id: "owner"}), /Клиент не найден/);
});
