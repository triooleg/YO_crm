import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const nativeRequire = createRequire(import.meta.url);
const ts = nativeRequire('typescript');
nativeRequire('reflect-metadata');
const modules = new Map();
function load(relative) {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), relative);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name.endsWith('/prisma.service')) return { PrismaService: class {} };
    const target = resolve(dirname(file), name + '.ts');
    return name.startsWith('.') && existsSync(target) ? load(target) : nativeRequire(name);
  }, module, module.exports);
  return module.exports;
}
const { OrderMeasurementAssignmentsService } = load('../src/orders/order-measurement-assignments.service.ts');
const { OrderTabsService } = load('../src/orders/order-tabs.service.ts');
const { ClientsService } = load('../src/clients/clients.service.ts');
const stamp = '2026-10-15T10:00:00.000Z';
const actor = { id: 'manager-1' };
const date = () => new Date(stamp);

// Only the Prisma boundary is simulated. A failed callback discards the whole draft.
function fixture({ loseClaim = null, failAudit = false, beforeTransaction = null } = {}) {
  const state = {
    clients: [{ id: 'c1', archivedAt: null }, { id: 'c2', archivedAt: null }],
    orders: [{ id: 'o1', clientId: 'c1', number: 'QA-1', salesStatus: 'NEW_LEAD', archivedAt: null },
      { id: 'old', clientId: 'c1', number: 'QA-OLD', salesStatus: 'COMPLETED', archivedAt: date() },
      { id: 'foreign', clientId: 'c2', number: 'PRIVATE', salesStatus: 'NEW_LEAD', archivedAt: null }],
    items: [{ id: 'design', orderId: 'o1', name: 'Design', archivedAt: null },
      { id: 'design2', orderId: 'o1', name: 'Second design', archivedAt: null },
      { id: 'historical', orderId: 'old', name: 'Historical design', archivedAt: date() },
      { id: 'foreign-design', orderId: 'foreign', name: 'Private design', archivedAt: null }],
    athletes: Array.from({ length: 6 }, (_, i) => ({ id: 'a' + (i + 1), clientId: 'c1', archivedAt: null, updatedAt: date() }))
      .concat({ id: 'foreign-athlete', clientId: 'c2', archivedAt: null, updatedAt: date() }),
    measurements: Array.from({ length: 6 }, (_, i) => ({ id: 'm' + (i + 1), athleteId: 'a' + (i + 1), measuredAt: date(), archivedAt: null, values: { m1: 60 + i, m2: 50, m3: 70, m15: 120 } }))
      .concat({ id: 'foreign-m', athleteId: 'foreign-athlete', measuredAt: date(), archivedAt: null, values: { m1: 99 } }),
    instances: Array.from({ length: 6 }, (_, i) => ({ id: 'i' + (i + 1), orderItemId: 'design', ordinal: i + 1, athleteId: null, measurementId: null, standardHeight: null, productionStatus: 'NOT_SCHEDULED', completedAt: null, orderShipmentId: null, archivedAt: null, updatedAt: date() })),
    shipments: [], activities: [], audits: [], operations: [],
  };
  let tick = 0;
  function enrich(draft, table, row) {
    if (!row) return null;
    if (table === 'operations') return {...row,orderId_operationKey:{orderId:row.orderId,operationKey:row.operationKey}};
    if (table === 'orders') return { ...row, client: draft.clients.find(x => x.id === row.clientId) };
    if (table === 'athletes') return { ...row, client: draft.clients.find(x => x.id === row.clientId) };
    if (table === 'measurements') return { ...row, athlete: enrich(draft, 'athletes', draft.athletes.find(x => x.id === row.athleteId)) };
    if (table === 'items') return { ...row, order: enrich(draft, 'orders', draft.orders.find(x => x.id === row.orderId)) };
    if (table === 'instances') return { ...row,
      athlete: enrich(draft, 'athletes', draft.athletes.find(x => x.id === row.athleteId)),
      measurement: enrich(draft, 'measurements', draft.measurements.find(x => x.id === row.measurementId)),
      orderItem: enrich(draft, 'items', draft.items.find(x => x.id === row.orderItemId)),
      orderShipment: draft.shipments.find(x => x.id === row.orderShipmentId) ?? null,
    };
    return row;
  }
  function matches(row, where = {}) {
    return row != null && Object.entries(where).every(([key, value]) => {
      if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(w => matches(row, w));
      if (key === 'OR') return value.some(w => matches(row, w));
      if (value instanceof Date) return row[key] instanceof Date && row[key].getTime() === value.getTime();
      if (value && typeof value === 'object') {
        if ('in' in value) return value.in.includes(row[key]);
        if ('not' in value) return row[key] !== value.not;
        return matches(row[key], value);
      }
      return row[key] === value;
    });
  }
  const prisma = { athlete: { findFirst: async ({ where }) => state.athletes.find(row => matches(row, where)) ?? null }, $transaction: async callback => {
    beforeTransaction?.(state);
    const draft = structuredClone(state);
    const tx = { $executeRaw: async () => 1, $executeRawUnsafe: async () => 1, $queryRaw: async () => [] };
    for (const [name, table] of Object.entries({ client: 'clients', order: 'orders', orderItem: 'items', athlete: 'athletes', measurement: 'measurements', orderItemInstance: 'instances', orderCompositionOperation:'operations' })) {
      const filtered = where => draft[table].map(row => enrich(draft, table, row)).filter(row => matches(row, where));
      tx[name] = {
        findFirst: async ({ where }) => filtered(where)[0] ?? null,
        findUnique: async ({where}) => filtered(where)[0]??null,
        findUniqueOrThrow: async ({ where }) => { const row = filtered(where)[0]; if (!row) throw Error('not found'); return row; },
        findMany: async ({ where, skip = 0, take = 10000 }) => filtered(where).sort((a, b) => a.id.localeCompare(b.id)).slice(skip, skip + take),
        count: async ({ where }) => filtered(where).length,
        create: async ({ data }) => { const row = { id: 'new-' + draft[table].length, ...(['measurements','athletes'].includes(table) ? { archivedAt: null } : {}), ...(table==='athletes'?{updatedAt:date()}:{}), ...data }; draft[table].push(row); return row; },
        updateMany: async ({ where, data }) => {
          const rows = draft[table].filter(row => matches(enrich(draft, table, row), where));
          if (rows.some(row => row.id === loseClaim)) return { count: 0 };
          for (const row of rows) Object.assign(row, data, 'updatedAt' in row ? { updatedAt: new Date(Date.parse(stamp) + ++tick * 1000) } : {});
          return { count: rows.length };
        },
        update: async ({ where, data }) => {
          const row = draft[table].find(row => matches(enrich(draft, table, row), where));
          if (!row) throw Error('not found');
          Object.assign(row, data, 'updatedAt' in row ? { updatedAt: new Date(Date.parse(stamp) + ++tick * 1000) } : {});
          return enrich(draft, table, row);
        },
      };
    }
    tx.activity = { create: async ({ data }) => { draft.activities.push(data); return data; } };
    tx.auditLog = { create: async ({ data }) => { if (failAudit) throw Error('audit unavailable'); draft.audits.push(data); return data; } };
    const result = await callback(tx); Object.assign(state, draft); return result;
  } };
  return { state, service: new OrderMeasurementAssignmentsService(prisma), tabs: new OrderTabsService(prisma), clients: new ClientsService(prisma) };
}
const target = (id, expectedUpdatedAt = stamp) => ({ id, expectedUpdatedAt });

test('historical instance read keeps archived design/order/snapshot visible only inside the context client',async()=>{
 const {state,service}=fixture();state.orders.find(o=>o.id==='old').currency='EUR';
 Object.assign(state.instances[0],{orderItemId:'historical',athleteId:'a1',measurementId:'m1',archivedAt:date()});state.measurements[0].archivedAt=date();
 const result=await service.history('o1','i1');assert.equal(result.orderId,'old');assert.equal(result.design.id,'historical');assert.equal(result.instance.measurement.id,'m1');assert.equal(result.instance.measurement.values.m1,60);assert.equal(result.archived,true);assert.equal(state.audits.length,0);
 state.instances[1].orderItemId='foreign-design';await assert.rejects(service.history('o1','i2'),e=>e.getStatus()===404);
 state.instances[0].athleteId='foreign-athlete';await assert.rejects(service.history('o1','i1'),e=>e.getStatus()===404);
});

test('context creation retries return the same athlete and immutable snapshot without duplicate records',async()=>{
 const {state,service}=fixture(),original=JSON.stringify(state.instances),old=JSON.stringify(state.measurements[0]);
 const input={firstName:'Новая',operationKey:'new-athlete-request-123'};
 const athlete=await service.createAthlete('o1',input,actor);const replay=await service.createAthlete('o1',input,actor);assert.equal(replay.id,athlete.id);assert.equal(state.athletes.length,8);
 const body={measuredAt:stamp,m1:61.5,m2:51,m3:71,m15:121,operationKey:'new-snapshot-request-123'};
 const snapshot=await service.createSnapshot('o1',athlete.id,body,actor),again=await service.createSnapshot('o1',athlete.id,body,actor);
 assert.equal(snapshot.id,again.id);assert.equal(state.measurements.length,8);assert.equal(JSON.stringify(state.instances),original);assert.equal(JSON.stringify(state.measurements[0]),old);assert.equal('operationKey' in snapshot.values,false);
 await assert.rejects(service.createAthlete('o1',{...input,firstName:'Другая'},actor),e=>e.getStatus()===409);assert.equal(state.athletes.length,8);
 await assert.rejects(service.createSnapshot('o1','foreign-athlete',{...body,operationKey:'foreign-snapshot-123'},actor),e=>e.getStatus()===409);assert.equal(state.measurements.length,8);
});

test('context athlete creation and its retry record roll back on audit failure',async()=>{
 const {state,service}=fixture({failAudit:true}),before=JSON.stringify(state.athletes);await assert.rejects(service.createAthlete('o1',{firstName:'Новая',operationKey:'audit-failure-request'},actor));assert.equal(JSON.stringify(state.athletes),before);assert.equal(state.operations.length,0);
});

test('one design keeps six different athletes and snapshots, including two equal heights', async () => {
  const { state, service } = fixture();
  for (let n = 1; n <= 6; n++) await service.assign('o1', { targets: [target('i' + n)], athleteId: 'a' + n, measurementId: 'm' + n, standardHeight: n < 3 ? 134 : 140 }, actor);
  assert.equal(new Set(state.instances.map(x => x.id)).size, 6);
  assert.deepEqual(state.instances.map(x => x.measurementId), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  assert.equal(state.instances.filter(x => x.standardHeight === 134).length, 2);
  assert.equal(state.audits.length, 6);
  assert.equal(state.activities.length, 6);
  assert.equal(state.measurements[0].values.m1, 60);
});

test('the same immutable snapshot is explicitly shared across two costumes and three designs', async () => {
  const { state, service } = fixture();
  state.items.push({ id: 'design3', orderId: 'o1', name: 'Third', archivedAt: null });
  state.instances[2].orderItemId = 'design2'; state.instances[3].orderItemId = 'design3';
  const original = structuredClone(state.measurements);
  await service.assign('o1', { targets: [1, 2, 3, 4].map(n => target('i' + n)), athleteId: 'a1', measurementId: 'm1' }, actor);
  assert.deepEqual(state.instances.slice(0, 4).map(x => x.measurementId), ['m1', 'm1', 'm1', 'm1']);
  assert.equal(state.instances[4].measurementId, null);
  assert.deepEqual(state.measurements, original);
  assert.ok(state.activities.every(x => x.actorId === actor.id && x.metadata.before.measurementId === null && x.metadata.after.measurementId === 'm1'));
});

for (const [label, change, input] of [
  ['foreign athlete', () => {}, { athleteId: 'foreign-athlete', measurementId: 'foreign-m' }],
  ['foreign snapshot', () => {}, { athleteId: 'a1', measurementId: 'foreign-m' }],
  ['another athlete snapshot', () => {}, { athleteId: 'a1', measurementId: 'm2' }],
  ['archived athlete', s => { s.athletes[0].archivedAt = date(); }, {}],
  ['archived snapshot', s => { s.measurements[0].archivedAt = date(); }, {}],
  ['archived design', s => { s.items[0].archivedAt = date(); }, {}],
  ['archived instance', s => { s.instances[0].archivedAt = date(); }, {}],
  ['finished costume', s => { s.instances[0].productionStatus = 'READY'; }, {}],
  ['completed order', s => { s.orders[0].salesStatus = 'COMPLETED'; }, {}],
  ['sent costume', s => { s.instances[0].orderShipmentId = 'parcel'; s.shipments.push({ id: 'parcel', status: 'SHIPPED', trackingNumber: null }); }, {}],
  ['tracked parcel without raw sent status', s => { s.instances[0].orderShipmentId = 'parcel'; s.shipments.push({ id: 'parcel', status: 'NOT_READY', trackingNumber: 'QA-TRACK' }); }, {}],
  ['factual completion date', s => { s.instances[0].completedAt = date(); }, {}],
]) test(`assignment rejects ${label} without changing any reference or history`, async () => {
  const { state, service } = fixture(); change(state); const before = structuredClone(state);
  await assert.rejects(() => service.assign('o1', { targets: [target('i1')], athleteId: 'a1', measurementId: 'm1', ...input }, actor));
  assert.deepEqual(state, before);
});

test('root tracking proves historical dispatch even without child parcels; assignment is blocked', async () => {
  const { state, service } = fixture(); state.orders[0].deliveryTrackingCode = 'QA-TRACK';
  const before = structuredClone(state);
  await assert.rejects(() => service.assign('o1', { targets: [target('i1')], athleteId: 'a1', measurementId: 'm1' }, actor));
  assert.deepEqual(state, before);
});

for (const options of [{}, { loseClaim: 'i2' }, { failAudit: true }]) test(`all target writes roll back on ${JSON.stringify(options)}`, async () => {
  const { state, service } = fixture(options);
  const before = structuredClone(state);
  const targets = [target('i1'), target('i2', Object.keys(options).length ? stamp : '2026-10-14T00:00:00Z')];
  await assert.rejects(() => service.assign('o1', { targets, athleteId: 'a1', measurementId: 'm1' }, actor));
  assert.deepEqual(state, before);
});

test('an unshipped draft parcel and production dates remain unchanged during assignment', async () => {
  const { state, service } = fixture();
  state.instances[0].orderShipmentId = 'draft'; state.shipments.push({ id: 'draft', status: 'DRAFT' });
  state.instances[0].plannedStartAt = date(); state.instances[0].productionStatus = 'SCHEDULED';
  await service.assign('o1', { targets: [target('i1')], athleteId: 'a1', measurementId: 'm1' }, actor);
  assert.equal(state.instances[0].orderShipmentId, 'draft');
  assert.equal(state.instances[0].productionStatus, 'SCHEDULED');
  assert.equal(state.instances[0].plannedStartAt.toISOString(), stamp);
});

test('duplicate target IDs cannot create repeated history; null clears only the chosen assignment', async () => {
  const { state, service } = fixture();
  await assert.rejects(() => service.assign('o1', { targets: [target('i1'), target('i1')], athleteId: 'a1', measurementId: 'm1' }, actor));
  assert.equal(state.audits.length, 0);
  await service.assign('o1', { targets: [target('i1')], athleteId: 'a1', measurementId: 'm1', standardHeight: 134 }, actor);
  const currentStamp = state.instances[0].updatedAt.toISOString();
  await service.assign('o1', { targets: [target('i1', currentStamp)], athleteId: null, measurementId: null }, actor);
  assert.equal(state.instances[0].measurementId, null); assert.equal(state.instances[0].athleteId, null);
  assert.equal(state.instances[0].standardHeight, 134);
});

function historyFixture(target) {
  const s = target.state;
  Object.assign(s.instances[0], { athleteId: 'a1', measurementId: 'm1' });
  s.instances.push({ ...s.instances[0], id: 'old-i', orderItemId: 'historical', archivedAt: date(), productionStatus: 'READY' });
  s.instances.push({ ...s.instances[0], id: 'private-i', orderItemId: 'foreign-design', athleteId: 'foreign-athlete', measurementId: 'foreign-m' });
  return target;
}

test('archiving a used snapshot changes only archivedAt, keeping historical references and usage visible', async () => {
  const { state, service } = historyFixture(fixture());
  const values = structuredClone(state.measurements[0].values), ids = state.instances.map(x => x.measurementId);
  const archived = await service.archiveMeasurement('o1', 'm1', { expectedArchivedAt: null }, actor);
  assert.ok(archived.archivedAt);
  assert.deepEqual(state.measurements[0].values, values);
  assert.deepEqual(state.instances.map(x => x.measurementId), ids);
  const usage = await service.usage('o1', { athleteId: 'a1', page: 1, pageSize: 25 });
  assert.equal(usage.total, 2);
  assert.ok(usage.rows.every(x => x.measurementId === 'm1' && x.archived));
  assert.equal(state.audits[0].actorId, actor.id);
  await assert.rejects(() => service.assign('o1', { targets: [target('i2')], athleteId: 'a1', measurementId: 'm1' }, actor));
  await assert.rejects(() => service.archiveMeasurement('o1', 'm1', { expectedArchivedAt: null }, actor));
});

test('usage pagination includes past orders and archived designs, with no other-client rows or snapshot values', async () => {
  const { state, service } = historyFixture(fixture());
  const before = structuredClone(state);
  const result = await service.usage('o1', { athleteId: 'a1', page: 2, pageSize: 1 });
  assert.equal(result.total, 2); assert.equal(result.page, 2); assert.equal(result.pageSize, 1);
  assert.deepEqual(result.rows.map(x => [x.orderId, x.orderNumber, x.orderItemId, x.instanceId, x.archived]), [['old', 'QA-OLD', 'historical', 'old-i', true]]);
  assert.deepEqual(Object.keys(result.rows[0]).sort(), ['orderId', 'orderNumber', 'orderItemId', 'designName', 'instanceId', 'ordinal', 'measurementId', 'measuredAt', 'productionStatus', 'archived'].sort());
  assert.deepEqual(state, before);
  await assert.rejects(() => service.usage('o1', { athleteId: 'foreign-athlete', page: 1, pageSize: 25 }));
});

test('archiving an athlete is CAS-protected, preserving all snapshots and past assignments', async () => {
  const { state, service } = historyFixture(fixture());
  const measurements = structuredClone(state.measurements), assignments = structuredClone(state.instances);
  await service.archiveAthlete('o1', 'a1', { expectedUpdatedAt: stamp }, actor);
  assert.ok(state.athletes[0].archivedAt);
  assert.deepEqual(state.instances, assignments); assert.deepEqual(state.measurements, measurements);
  assert.equal((await service.usage('o1', { athleteId: 'a1', page: 1, pageSize: 25 })).total, 2);
  await assert.rejects(() => service.assign('o1', { targets: [target('i2')], athleteId: 'a1', measurementId: 'm1' }, actor));
  await assert.rejects(() => service.archiveAthlete('o1', 'a1', { expectedUpdatedAt: stamp }, actor));
});

for (const kind of ['Measurement', 'Athlete']) test(`${kind} archive cannot cross the context client's boundary`, async () => {
  const { state, service } = fixture(), before = structuredClone(state);
  await assert.rejects(() => kind === 'Measurement'
    ? service.archiveMeasurement('o1', 'foreign-m', { expectedArchivedAt: null }, actor)
    : service.archiveAthlete('o1', 'foreign-athlete', { expectedUpdatedAt: stamp }, actor));
  assert.deepEqual(state, before);
});

test('real ValidationPipe rejects missing tokens, duplicate/oversized batches and invalid size/query bounds', async () => {
  const { ValidationPipe } = nativeRequire('@nestjs/common');
  const dto = load('../src/orders/order-measurement-assignments.dto.ts');
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const payload = { targets: [target('i1')], athleteId: 'a1', measurementId: 'm1', standardHeight: 134 };
  const transform = (data, metatype, type = 'body') => pipe.transform(data, { type, metatype });
  assert.equal((await transform(payload, dto.AssignOrderMeasurementsDto)).standardHeight, 134);
  assert.equal((await transform({ ...payload, athleteId: null, measurementId: null, standardHeight: null }, dto.AssignOrderMeasurementsDto)).standardHeight, null);
  for (const invalid of [
    { ...payload, targets: [] }, { ...payload, targets: [null] }, { ...payload, targets: [target('i1'), target('i1')] },
    { ...payload, targets: [{ id: 'i1' }] }, { ...payload, targets: [{ id: 'i1', expectedUpdatedAt: 'yesterday' }] },
    { ...payload, targets: Array.from({ length: 1001 }, (_, n) => target('i' + n)) },
    { ...payload, athleteId: undefined }, { ...payload, measurementId: undefined },
    { ...payload, standardHeight: 134.5 }, { ...payload, standardHeight: 0 }, { ...payload, priceMinor: 100 },
  ]) await assert.rejects(() => transform(invalid, dto.AssignOrderMeasurementsDto), error => error.getStatus() === 400);
  assert.equal((await transform({ page: '2', pageSize: '10' }, dto.MeasurementUsageQueryDto, 'query')).page, 2);
  assert.equal((await transform({ ...payload, targets: Array.from({ length: 1000 }, (_, n) => target('i' + n)) }, dto.AssignOrderMeasurementsDto)).targets.length, 1000);
  for (const bad of [{ pageSize: '1001' }, { page: '0' }, { page: '1.5' }, { pageSize: 'no' }]) await assert.rejects(() => transform(bad, dto.MeasurementUsageQueryDto, 'query'), error => error.getStatus() === 400);
  await transform({ expectedArchivedAt: null }, dto.ArchiveOrderMeasurementDto);
  await assert.rejects(() => transform({}, dto.ArchiveOrderMeasurementDto), error => error.getStatus() === 400);
  await assert.rejects(() => transform({}, dto.ArchiveOrderAthleteDto), error => error.getStatus() === 400);
});

test('all four actual controller endpoints deny PRODUCTION and retain session/role guards', () => {
  const { OrderMeasurementAssignmentsController: Controller } = load('../src/orders/order-measurement-assignments.controller.ts');
  const { RolesGuard } = load('../src/auth/roles.guard.ts');
  const { Reflector } = nativeRequire('@nestjs/core');
  const { GUARDS_METADATA } = nativeRequire('@nestjs/common/constants');
  const guard = new RolesGuard(new Reflector());
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, Controller).map(c => c.name), ['SessionGuard', 'RolesGuard']);
  const { PATH_METADATA, METHOD_METADATA } = nativeRequire('@nestjs/common/constants');
  assert.equal(Reflect.getMetadata(PATH_METADATA, Controller), 'order-tabs');
  const expectedPaths = { assign: ':orderId/instances/assign', usage: ':orderId/measurements/usage', archiveMeasurement: ':orderId/measurements/:measurementId/archive', archiveAthlete: ':orderId/athletes/:athleteId/archive' };
  for (const method of ['assign', 'usage', 'archiveMeasurement', 'archiveAthlete']) {
    assert.equal(Reflect.getMetadata(PATH_METADATA, Controller.prototype[method]), expectedPaths[method]);
    assert.equal(Reflect.getMetadata(METHOD_METADATA, Controller.prototype[method]), method === 'usage' ? 0 : 1);
    const context = role => ({ getHandler: () => Controller.prototype[method], getClass: () => Controller, switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) });
    for (const role of ['OWNER', 'ADMIN', 'MANAGER']) assert.equal(guard.canActivate(context(role)), true);
    for (const role of ['PRODUCTION', 'ACCOUNTANT']) assert.throws(() => guard.canActivate(context(role)), error => error.getStatus() === 403);
  }
});

test('single-instance legacy endpoint cannot bypass archived snapshot selection guard', async () => {
  // Reuse the same transactional Prisma boundary with the legacy public service.
  const f = fixture(); f.state.measurements[0].archivedAt = date();
  const before = structuredClone(f.state);
  await assert.rejects(() => f.tabs.updateInstance('o1', 'i1', { athleteId: 'a1', measurementId: 'm1', expectedUpdatedAt: stamp }, actor));
  assert.deepEqual(f.state, before);
});

test('single-instance legacy endpoint preserves existing archived references on non-assignment edits', async () => {
  const f = fixture(); Object.assign(f.state.instances[0], { athleteId: 'a1', measurementId: 'm1' });
  f.state.athletes[0].archivedAt = date(); f.state.measurements[0].archivedAt = date();
  const result = await f.tabs.updateInstance('o1', 'i1', { expectedUpdatedAt: stamp }, actor);
  assert.equal(result.athleteId, 'a1'); assert.equal(result.measurementId, 'm1');
});

test('a newer profile version never implicitly replaces the explicitly selected known snapshot or a prior order', async () => {
  const f = historyFixture(fixture());
  f.state.measurements.push({ ...f.state.measurements[0], id: 'new-profile', measuredAt: new Date('2026-10-16'), values: { m1: 99 } });
  const prior = structuredClone(f.state.instances.find(x => x.id === 'old-i'));
  await f.service.assign('o1', { targets: [target('i2')], athleteId: 'a1', measurementId: 'm1' }, actor);
  assert.equal(f.state.instances[1].measurementId, 'm1');
  assert.deepEqual(f.state.instances.find(x => x.id === 'old-i'), prior);
  assert.equal(f.state.measurements[0].values.m1, 60);
  assert.equal(f.state.measurements.at(-1).values.m1, 99);
});

for (const kind of ['Measurement', 'Athlete']) test(`${kind} archive rolls back if audit cannot be persisted`, async () => {
  const f = historyFixture(fixture({ failAudit: true })), before = structuredClone(f.state);
  await assert.rejects(() => kind === 'Measurement'
    ? f.service.archiveMeasurement('o1', 'm1', { expectedArchivedAt: null }, actor)
    : f.service.archiveAthlete('o1', 'a1', { expectedUpdatedAt: stamp }, actor), /audit unavailable/);
  assert.deepEqual(f.state, before);
});

test('usage suppresses inconsistent cross-client relation links even on an owned order', async () => {
  const f = fixture(); Object.assign(f.state.instances[0], { athleteId: 'foreign-athlete', measurementId: 'foreign-m' });
  const result = await f.service.usage('o1', { page: 1, pageSize: 25 });
  assert.ok(!result.rows.some(x => x.instanceId === 'i1'));
});

test('legacy instance writes and snapshot creation reject an archived design with a domain conflict', async () => {
  const f = fixture(); f.state.items[0].archivedAt = date();
  Object.assign(f.state.instances[0], { athleteId: 'a1', measurementId: 'm1' });
  const before = structuredClone(f.state);
  await assert.rejects(() => f.tabs.updateInstance('o1', 'i1', { athleteId: 'a2', measurementId: 'm2', expectedUpdatedAt: stamp }, actor), e => e.getStatus() === 409);
  await assert.rejects(() => f.tabs.addInstanceMeasurement('o1', 'i1', { measuredAt: stamp, m1: 70, m2: 50, m3: 75, m15: 120, expectedMeasurementId: 'm1', expectedUpdatedAt: stamp }, actor), e => e.getStatus() === 409);
  assert.deepEqual(f.state, before);
});

test('client snapshot creation rechecks archive ownership inside the transaction', async () => {
  const f = fixture({ beforeTransaction: state => { state.athletes[0].archivedAt = date(); } });
  const oldCount = f.state.measurements.length;
  await assert.rejects(() => f.clients.addMeasurement('c1', 'a1', { measuredAt: stamp, m1: 70, m2: 50, m3: 75, m15: 120 }, actor), error => error.getStatus() === 404);
  assert.equal(f.state.measurements.length, oldCount); assert.equal(f.state.audits.length, 0);
});

test('a foreign target after an owned target aborts the entire assignment batch', async () => {
  const f = historyFixture(fixture()), before = structuredClone(f.state);
  await assert.rejects(() => f.service.assign('o1', { targets: [target('i1'), target('private-i')], athleteId: 'a1', measurementId: 'm1' }, actor), e => e.getStatus() === 404);
  assert.deepEqual(f.state, before);
});

test('an archived currently assigned snapshot remains a valid source for a new active version', async () => {
  const f = historyFixture(fixture()); f.state.measurements[0].archivedAt = date();
  const historical = structuredClone(f.state.measurements[0]);
  const result = await f.tabs.addInstanceMeasurement('o1', 'i1', {
    measuredAt: '2026-10-16T10:00:00.000Z', ...historical.values,
    expectedMeasurementId: 'm1', expectedUpdatedAt: stamp,
  }, actor);
  assert.notEqual(result.measurementId, 'm1');
  const created = f.state.measurements.find(x => x.id === result.measurementId);
  assert.equal(created.archivedAt, null); assert.equal(created.athleteId, 'a1');
  assert.equal(created.values.m1, 60); assert.equal(created.values.m15, 120);
  assert.deepEqual(f.state.measurements[0], historical);
  assert.equal(f.state.instances.find(x => x.id === 'old-i').measurementId, 'm1');
});


test('three designs keep three different athlete snapshots without copying or modifying measurements',async()=>{
 const {state,service}=fixture();state.items.push({id:'third',orderId:'o1',name:'Third',archivedAt:null});
 state.instances[1].orderItemId='design2';state.instances[2].orderItemId='third';const before=structuredClone(state.measurements);
 for(let n=1;n<=3;n++)await service.assign('o1',{targets:[target(`i${n}`)],athleteId:`a${n}`,measurementId:`m${n}`},actor);
 assert.deepEqual(state.instances.slice(0,3).map(i=>[i.orderItemId,i.athleteId,i.measurementId]),[['design','a1','m1'],['design2','a2','m2'],['third','a3','m3']]);
 assert.deepEqual(state.measurements,before);
});
