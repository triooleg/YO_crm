import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

const nativeRequire = createRequire(import.meta.url);
const cache = new Map();
function load(path) {
  const filename = resolve(dirname(fileURLToPath(import.meta.url)), path);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const javascript = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true } }).outputText;
  const localRequire = name => {
    if (name.endsWith("/prisma.service")) return { PrismaService: class {} };
    if (name.endsWith("/communications/inbound-routing")) return { presentClientContact: value => value };
    const relative = resolve(dirname(filename), `${name}.ts`);
    return name.startsWith(".") && existsSync(relative) ? load(relative) : nativeRequire(name);
  };
  new Function("require", "module", "exports", javascript)(localRequire, module, module.exports);
  return module.exports;
}
const { ClientsService } = load("../src/clients/clients.service.ts");
const { OrderTabsService } = load("../src/orders/order-tabs.service.ts");
const stamp = "2026-10-13T10:00:00.000Z";
const actor = { id: "manager-1" };
const measurementDto = { measuredAt: stamp, m1: 80, m2: 65.5, m3: 85, m15: 141, standardHeight: 159, notes: "Новые мерки", expectedMeasurementId: "old", expectedUpdatedAt: stamp };
function fixture({ failAudit = false, loseClaim = false } = {}) {
  const state = {
    client: { id: "client-1", archivedAt: null },
    athlete: { id: "athlete-1", clientId: "client-1", firstName: "Анна", lastName: null, archivedAt: null },
    order: { id: "order-1", clientId: "client-1", archivedAt: null, measurementId: "old" },
    item: { id: "item-1", orderId: "order-1", measurementId: "old" },
    instances: [1, 2].map(n => ({ id: `instance-${n}`, orderItemId: "item-1", ordinal: n, athleteId: "athlete-1", measurementId: "old", updatedAt: new Date(stamp), archivedAt: null })),
    measurements: [{ id: "old", athleteId: "athlete-1", values: { m1: 70 } }], activities: [], audits: [],
  };
  const matches = (row, where) => row && Object.entries(where).every(([key, value]) => {
    if (key === "orderItem") return row.orderItemId === state.item.id && matches({ ...state.item, order: state.order }, value);
    if (key === "client") return matches(state.client, value);
    if (key === "order") return matches(state.order, value);
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
  });
  const prisma = { $transaction: async callback => {
    const draft = structuredClone(state);
    const tx = {
      $executeRaw: async () => 1, $queryRaw: async () => [], $executeRawUnsafe: async () => 1,
      client: { findFirst: async ({ where }) => matches(draft.client, where) ? draft.client : null },
      athlete: {
        findFirst: async ({ where }) => matches(draft.athlete, where) ? { ...draft.athlete } : null,
        updateMany: async ({ where, data }) => { if (loseClaim || !matches(draft.athlete, where)) return { count: 0 }; Object.assign(draft.athlete, data); return { count: 1 }; },
        findUniqueOrThrow: async () => ({ ...draft.athlete }),
      },
      order: { findFirst: async ({ where }) => matches(draft.order, where) ? { ...draft.order } : null },
      orderItemInstance: {
        findFirst: async ({ where }) => { const row = draft.instances.find(row => matches(row, where)); return row ? { ...row, orderItem: { ...draft.item, order: draft.order } } : null; },
        updateMany: async ({ where, data }) => { const row = draft.instances.find(row => matches(row, where)); if (loseClaim || !row) return { count: 0 }; Object.assign(row, data, { updatedAt: new Date("2026-10-13T10:01:00.000Z") }); return { count: 1 }; },
        findUniqueOrThrow: async ({ where }) => ({ ...draft.instances.find(row => row.id === where.id) }),
      },
      measurement: {
        findFirst: async ({ where }) => draft.measurements.find(row => matches(row, where)) ?? null,
        create: async ({ data }) => { const row = { id: "new", ...data }; draft.measurements.push(row); return row; },
      },
      activity: { create: async ({ data }) => { draft.activities.push(data); return data; } },
      auditLog: { create: async ({ data }) => { if (failAudit) throw new Error("audit unavailable"); draft.audits.push(data); return data; } },
    };
    const result = await callback(tx);
    Object.assign(state, draft);
    return result;
  } };
  return { state, clients: new ClientsService(prisma), tabs: new OrderTabsService(prisma) };
}

test("renaming an owned athlete preserves relations and appends actor-attributed history", async () => {
  const target = fixture();
  const result = await target.clients.updateAthlete("client-1", "athlete-1", { firstName: "Олена", lastName: "Коваль", expectedFirstName: "Анна", expectedLastName: null }, actor);
  assert.equal(result.firstName, "Олена");
  assert.equal(result.lastName, "Коваль");
  assert.equal(result.clientId, "client-1");
  assert.equal(target.state.instances[0].athleteId, "athlete-1");
  assert.equal(target.state.activities[0].actorId, actor.id);
  assert.equal(target.state.audits[0].before.firstName, "Анна");
  assert.equal(target.state.audits[0].after.lastName, "Коваль");
});

test("new immutable snapshot changes only the selected instance, preserving siblings and legacy references", async () => {
  const target = fixture();
  const before = structuredClone(target.state);
  const result = await target.tabs.addInstanceMeasurement("order-1", "instance-1", measurementDto, actor);
  assert.equal(result.id, "instance-1");
  assert.equal(result.measurementId, "new");
  assert.equal(result.athleteId, "athlete-1");
  assert.deepEqual(target.state.instances[1], before.instances[1]);
  assert.deepEqual(target.state.measurements[0], before.measurements[0]);
  assert.deepEqual(target.state.order, before.order);
  assert.deepEqual(target.state.item, before.item);
  assert.equal(target.state.measurements[1].athleteId, "athlete-1");
  assert.equal(target.state.measurements[1].chest, 80);
  assert.equal(target.state.measurements[1].waist, 65.5);
  assert.equal(target.state.measurements[1].torso, 141);
  assert.deepEqual(target.state.measurements[1].values, { standardHeight: 159, m1: 80, m2: 65.5, m3: 85, m15: 141 });
  assert.equal(target.state.activities[0].actorId, actor.id);
  assert.equal(target.state.activities[0].orderId, "order-1");
  assert.equal(target.state.activities[0].metadata.previousMeasurementId, "old");
  assert.equal(target.state.activities[0].metadata.measurementId, "new");
  assert.equal(target.state.activities[0].metadata.previousUpdatedAt, stamp);
  assert.equal(target.state.activities[0].metadata.updatedAt, "2026-10-13T10:01:00.000Z");
  assert.deepEqual(target.state.audits.map(row => row.entityType), ["Measurement", "OrderItemInstance"]);
  assert.equal(target.state.audits[0].after.values.m1, 80);
  assert.equal(target.state.audits[1].before.measurementId, "old");
  assert.equal(target.state.audits[1].after.measurementId, "new");
});

for (const [label, mutate, clientId, athleteId] of [
  ["foreign athlete", () => {}, "client-1", "foreign"],
  ["archived athlete", s => s.athlete.archivedAt = new Date(), "client-1", "athlete-1"],
  ["archived client", s => s.client.archivedAt = new Date(), "client-1", "athlete-1"],
  ["foreign client", () => {}, "other", "athlete-1"],
  ["stale first name", s => s.athlete.firstName = "Інша", "client-1", "athlete-1"],
  ["stale last name", s => s.athlete.lastName = "Інша", "client-1", "athlete-1"],
]) test(`athlete rename rejects ${label} without mutations`, async () => {
  const target = fixture(); mutate(target.state);
  const before = structuredClone(target.state);
  await assert.rejects(() => target.clients.updateAthlete(clientId, athleteId, { firstName: "Олена", lastName: null, expectedFirstName: "Анна", expectedLastName: null }, actor));
  assert.deepEqual(target.state, before);
});

for (const [label, mutate] of [
  ["foreign instance", s => s.instances[0].orderItemId = "other"],
  ["foreign order", s => s.item.orderId = "other"],
  ["archived instance", s => s.instances[0].archivedAt = new Date()],
  ["archived order", s => s.order.archivedAt = new Date()],
  ["archived client", s => s.client.archivedAt = new Date()],
  ["unassigned athlete", s => s.instances[0].athleteId = null],
  ["foreign athlete", s => s.athlete.clientId = "other"],
  ["archived athlete", s => s.athlete.archivedAt = new Date()],
  ["foreign existing snapshot", s => s.measurements[0].athleteId = "other"],
  ["stale measurement", s => s.instances[0].measurementId = null],
  ["stale version", s => s.instances[0].updatedAt = new Date("2026-10-13T11:00:00Z")],
]) test(`instance snapshot rejects ${label} without mutations`, async () => {
  const target = fixture(); mutate(target.state);
  const before = structuredClone(target.state);
  await assert.rejects(() => target.tabs.addInstanceMeasurement("order-1", "instance-1", measurementDto, actor));
  assert.deepEqual(target.state, before);
});

test("instance with no snapshot accepts explicit null and returns the next version", async () => {
  const target = fixture(); target.state.instances[0].measurementId = null;
  const result = await target.tabs.addInstanceMeasurement("order-1", "instance-1", { ...measurementDto, expectedMeasurementId: null }, actor);
  assert.equal(result.measurementId, "new");
  assert.equal(result.updatedAt.toISOString(), "2026-10-13T10:01:00.000Z");
});

for (const options of [{ failAudit: true }, { loseClaim: true }]) {
  test(`instance rollback on ${Object.keys(options)[0]} retains all history and references`, async () => {
    const target = fixture(options); const before = structuredClone(target.state);
    await assert.rejects(() => target.tabs.addInstanceMeasurement("order-1", "instance-1", measurementDto, actor));
    assert.deepEqual(target.state, before);
  });
  test(`athlete rollback on ${Object.keys(options)[0]} retains the old name`, async () => {
    const target = fixture(options); const before = structuredClone(target.state);
    await assert.rejects(() => target.clients.updateAthlete("client-1", "athlete-1", { firstName: "Олена", lastName: null, expectedFirstName: "Анна", expectedLastName: null }, actor));
    assert.deepEqual(target.state, before);
  });
}

test("half-centimeter validation prevents snapshot and audit writes", async () => {
  const target = fixture(); const before = structuredClone(target.state);
  await assert.rejects(() => target.tabs.addInstanceMeasurement("order-1", "instance-1", { ...measurementDto, m2: 65.2 }, actor), /шагом 0,5 см/);
  assert.deepEqual(target.state, before);
});

test("all 17 values are kept in the snapshot without optimistic tokens", async () => {
  const target = fixture();
  const numbered = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`m${i + 1}`, 10 + i * 0.5]));
  await target.tabs.addInstanceMeasurement("order-1", "instance-1", { ...measurementDto, ...numbered }, actor);
  assert.deepEqual(target.state.measurements[1].values, { standardHeight: 159, ...numbered });
  assert.equal(target.state.measurements[1].hips, 11);
  assert.equal(target.state.measurements[1].torso, 17);
});

test("repeating a saved instance edit with its old tokens returns 409 without another snapshot", async () => {
  const target = fixture();
  await target.tabs.addInstanceMeasurement("order-1", "instance-1", measurementDto, actor);
  const before = structuredClone(target.state);
  await assert.rejects(() => target.tabs.addInstanceMeasurement("order-1", "instance-1", measurementDto, actor), error => error.getStatus() === 409);
  assert.deepEqual(target.state, before);
});

test("DTOs require explicit optimistic tokens and retain measurement validation", async () => {
  const { UpdateAthleteDto } = load("../src/clients/clients.dto.ts");
  const { CreateInstanceMeasurementDto } = load("../src/orders/order-tabs.dto.ts");
  const validName = { firstName: "  Олена  ", lastName: "  ", expectedFirstName: "Анна", expectedLastName: null };
  const name = plainToInstance(UpdateAthleteDto, validName);
  assert.equal((await validate(name)).length, 0);
  assert.equal(name.firstName, "Олена"); assert.equal(name.lastName, null);
  for (const key of ["firstName", "lastName", "expectedFirstName", "expectedLastName"]) {
    const input = { ...validName }; delete input[key];
    assert.ok((await validate(plainToInstance(UpdateAthleteDto, input))).some(error => error.property === key));
  }
  assert.ok((await validate(plainToInstance(UpdateAthleteDto, { ...validName, firstName: "  " }))).some(error => error.property === "firstName"));
  assert.equal((await validate(plainToInstance(CreateInstanceMeasurementDto, measurementDto))).length, 0);
  assert.equal((await validate(plainToInstance(CreateInstanceMeasurementDto, { ...measurementDto, expectedMeasurementId: null }))).length, 0);
  for (const key of ["expectedMeasurementId", "expectedUpdatedAt", "m1", "m2", "m3", "m15", "measuredAt"]) {
    const input = { ...measurementDto }; delete input[key];
    assert.ok((await validate(plainToInstance(CreateInstanceMeasurementDto, input))).some(error => error.property === key));
  }
  for (const [key, value] of [["m1", 0], ["standardHeight", 171], ["expectedUpdatedAt", "invalid"]]) {
    assert.ok((await validate(plainToInstance(CreateInstanceMeasurementDto, { ...measurementDto, [key]: value }))).some(error => error.property === key));
  }
});

test("new routes retain guards and restrict name editing to CRM roles", () => {
  const { ClientsController } = load("../src/clients/clients.controller.ts");
  const { OrderTabsController } = load("../src/orders/order-tabs.controller.ts");
  const rename = ClientsController.prototype.updateAthlete;
  const save = OrderTabsController.prototype.addInstanceMeasurement;
  assert.equal(Reflect.getMetadata("path", rename), ":id/athletes/:athleteId");
  assert.equal(Reflect.getMetadata("method", rename), 4);
  assert.deepEqual(Reflect.getMetadata("roles", rename), ["OWNER", "ADMIN", "MANAGER"]);
  assert.equal(Reflect.getMetadata("path", save), ":orderId/instances/:instanceId/measurement");
  assert.equal(Reflect.getMetadata("method", save), 1);
  assert.deepEqual(Reflect.getMetadata("roles", save), ["OWNER", "ADMIN", "MANAGER", "PRODUCTION"]);
  for (const controller of [ClientsController, OrderTabsController]) assert.deepEqual(Reflect.getMetadata("__guards__", controller).map(guard => guard.name), ["SessionGuard", "RolesGuard"]);
});
