import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url), ts = require('typescript');
require('reflect-metadata');
const modules = new Map();
function load(relative) {
  const filename = resolve(dirname(fileURLToPath(import.meta.url)), relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name.endsWith('/prisma.service')) return { PrismaService: class {} };
    const file = resolve(dirname(filename), name + '.ts');
    return name.startsWith('.') && existsSync(file) ? load(file) : require(name);
  }, module, module.exports);
  return module.exports;
}
const { ClientsService } = load('../src/clients/clients.service.ts');
const { clientMergeSnapshot, parseMovedEntityIds } = load('../src/clients/client-merge-provenance.ts');
const stamp = new Date('2026-10-15T12:00:00.000Z');
const actor = { id: 'manager' };

// A Prisma-boundary model: nested some/OR predicates are evaluated against actual
// order/design/instance records, not recognized by a query-string or canned answer.
function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return expected.some(part => matches(row, part));
    if (key === 'AND') return expected.every(part => matches(row, part));
    const value = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('some' in expected) return Array.isArray(value) && value.some(item => matches(item, expected.some));
      if ('in' in expected || 'notIn' in expected || 'not' in expected) return (!('in' in expected) || expected.in.includes(value)) && (!('notIn' in expected) || value != null && !expected.notIn.includes(value)) && (!('not' in expected) || value !== expected.not);
      return matches(value, expected);
    }
    return expected instanceof Date ? value?.getTime() === expected.getTime() : value === expected;
  });
}

function fixture() {
  const target = { id: 'target', firstName: '', displayName: 'Target', source: 'MANUAL', status: 'ACTIVE', archivedAt: null, updatedAt: stamp };
  const source = { id: 'source', firstName: '', displayName: 'Source', source: 'MANUAL', status: 'ACTIVE', archivedAt: null, updatedAt: stamp };
  const moved = { ...parseMovedEntityIds(null), sourceAiModes: [], targetAiModes: [], athletes: ['moved-athlete'], orders: ['moved-order'] };
  const item = id => ({ id: id + '-design', athleteId: null, measurement: null, archivedAt: null, instances: [] });
  const state = { measurementSubmission: [],
    client: [target, { ...source, archivedAt: stamp }],
    athlete: [{ id: 'moved-athlete', clientId: 'target' }, { id: 'kept-athlete', clientId: 'target' }],
    order: ['moved-order', 'retained-order'].map(id => ({ id, clientId: 'target', athleteId: null, measurement: null, archivedAt: null, items: [item(id)] })),
    conversation: [], activity: [], auditLog: [], agreement: [], aiRuntimeSetting: [], aiModeOverride: [],
    clientMergeRedirect: [{ sourceClientId: 'source', targetClientId: 'target' }],
    clientMergeOperation: [{ id: 'merge', sourceClientId: 'source', targetClientId: 'target', splitAt: null,
      movedEntityIds: moved, sourceSnapshot: clientMergeSnapshot(source), targetBeforeSnapshot: clientMergeSnapshot(target), targetAfterSnapshot: clientMergeSnapshot(target), deletedAiSettings: [] }],
  };
  const prisma = { $transaction: async callback => {
    const draft = structuredClone(state);
    const tx = { $executeRaw: async () => 1, $queryRaw: async () => [] };
    for (const [name, rows] of Object.entries(draft)) tx[name] = {
      findFirst: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
      findUnique: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
      findUniqueOrThrow: async ({ where }) => { const row = rows.find(row => matches(row, where)); if (!row) throw Error('Missing record'); return row; },
      findMany: async ({ where }) => rows.filter(row => matches(row, where)),
      update: async ({ where, data }) => { const row = rows.find(row => matches(row, where)); if (!row) throw Error('Missing record'); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }) => { const selected = rows.filter(row => matches(row, where)); selected.forEach(row => Object.assign(row, data)); return { count: selected.length }; },
      delete: async ({ where }) => { const index = rows.findIndex(row => matches(row, where)); if (index < 0) throw Error('Missing record'); return rows.splice(index, 1)[0]; },
      create: async ({ data }) => { const row = { id: name + '-' + rows.length, ...data }; rows.push(row); return row; },
    };
    const result = await callback(tx); Object.assign(state, draft); return result;
  } };
  return { state, service: new ClientsService(prisma) };
}

for (const direction of ['retained order uses moved athlete', 'moved order uses retained athlete']) {
  for (const link of ['athlete', 'snapshot']) {
    for (const historical of ['active', 'archived instance', 'archived design', 'archived order']) {
      test(`split refuses ${direction} through instance-only ${link}, ${historical}`, async () => {
        const { state, service } = fixture();
        const retained = direction.startsWith('retained'), order = state.order.find(row => row.id === (retained ? 'retained-order' : 'moved-order'));
        const athleteId = retained ? 'moved-athlete' : 'kept-athlete';
        const instance = { id: 'physical-costume', athleteId: link === 'athlete' ? athleteId : null,
          measurement: link === 'snapshot' ? { id: 'historical-snapshot', athleteId } : null, archivedAt: null };
        order.items[0].instances.push(instance);
        if (historical === 'archived instance') instance.archivedAt = stamp;
        if (historical === 'archived design') order.items[0].archivedAt = stamp;
        if (historical === 'archived order') order.archivedAt = stamp;
        const before = structuredClone(state);
        await assert.rejects(() => service.split('target', 'source', actor), error => error.getStatus() === 400 && error.message === 'CLIENT_SPLIT_DEPENDENCY_CONFLICT');
        assert.deepEqual(state, before);
      });
    }
  }
}

test('split still succeeds when every instance stays with its athlete, keeping historical IDs and snapshots', async () => {
  const { state, service } = fixture();
  for (const order of state.order) {
    const athleteId = order.id === 'moved-order' ? 'moved-athlete' : 'kept-athlete';
    order.items[0].instances.push({ id: order.id + '-instance', athleteId, measurement: { id: athleteId + '-snapshot', athleteId }, archivedAt: stamp });
  }
  const instances = structuredClone(state.order.map(order => order.items[0].instances));
  await service.split('target', 'source', actor);
  assert.equal(state.order.find(row => row.id === 'moved-order').clientId, 'source');
  assert.equal(state.order.find(row => row.id === 'retained-order').clientId, 'target');
  assert.equal(state.athlete.find(row => row.id === 'moved-athlete').clientId, 'source');
  assert.equal(state.athlete.find(row => row.id === 'kept-athlete').clientId, 'target');
  assert.deepEqual(state.order.map(order => order.items[0].instances), instances);
  assert.equal(state.clientMergeRedirect.length, 0);
  assert.ok(state.clientMergeOperation[0].splitAt);
});
