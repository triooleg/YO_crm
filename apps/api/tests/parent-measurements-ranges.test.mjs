import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const native = createRequire(import.meta.url); native('reflect-metadata');
const modules = new Map();
function load(path) {
  const file = resolve(fileURLToPath(new URL('../src/', import.meta.url)), path);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  const local = createRequire(file);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(name => name.startsWith('.') && existsSync(resolve(dirname(file), name + '.ts')) ? load(resolve(dirname(file), name + '.ts')) : local(name), module, module.exports);
  return module.exports;
}
const serviceModule = () => load('parent-measurements/parent-measurements-ranges.service.ts');
const actor = { id: 'owner1', role: 'OWNER' };
const input = rules => ({ rules, expectedVersion: null, approvedForBodyMeasurements: true });
function database() {
  let state = { settings: [{ id: 'finance', section: 'finance', key: 'ranges-active', value: { private: true } }, { id: 'other-pm', section: 'parent-measurements', key: 'other', value: { preserved: true } }], audits: [] };
  let queue = Promise.resolve(), failAudit = false;
  const operations = [];
  const delegate = data => ({
    async findUnique({ where }) { const { section, key } = where.section_key; return structuredClone(data().settings.find(row => row.section === section && row.key === key) ?? null); },
    async create({ data: row }) {
      operations.push({ method: 'create', ...structuredClone(row) });
      if (data().settings.some(existing => existing.section === row.section && existing.key === row.key)) throw Error('unique key');
      const result = { id: `setting-${data().settings.length}`, ...structuredClone(row) }; data().settings.push(result); return structuredClone(result);
    },
    async upsert({ where, create, update }) {
      operations.push({ method: 'upsert', section: where.section_key.section, key: where.section_key.key });
      const row = data().settings.find(row => row.section === where.section_key.section && row.key === where.section_key.key);
      if (row) { Object.assign(row, structuredClone(update)); return structuredClone(row); }
      return this.create({ data: create });
    },
  });
  const db = { appSetting: delegate(() => state), async $transaction(callback) {
    let draft, release;
    const tx = { appSetting: delegate(() => { assert.ok(draft, 'transaction must lock before any setting access'); return draft; }),
      async $executeRaw(strings, ...params) {
        assert.match(strings.join('?'), /pg_advisory_xact_lock/); assert.ok(params.includes('pm-ranges'));
        const previous = queue; queue = new Promise(accept => { release = accept; }); await previous; draft = structuredClone(state);
      },
      auditLog: { async create({ data }) { if (failAudit) throw Error('audit unavailable'); draft.audits.push(structuredClone(data)); return data; } },
    };
    try { const result = await callback(tx); state = draft; return result; } finally { release?.(); }
  } };
  return { db, operations, get state() { return structuredClone(state); }, failAudit() { failAudit = true; }, seed(row) { state.settings.push(structuredClone(row)); } };
}

test('empty policy invents no ranges; configuration appends immutable versions and audits the pointer change', async () => {
  const { ParentMeasurementsRangesService } = serviceModule(), d = database(), service = new ParentMeasurementsRangesService(d.db);
  assert.deepEqual(await service.policy(), { version: null, rules: [] });
  const first = await service.configure(input([{ field: 1, lowerCm: 60, upperCm: 85 }]), actor);
  assert.match(first.version, /^[0-9a-f-]{36}$/); assert.equal(first.rules[0].field, 1); assert.ok(first.rules[0].id);
  assert.deepEqual(await service.policy(), first);
  const firstRecord = d.state.settings.find(row => row.key === `range-version:${first.version}`);
  const second = await service.configure({ ...input([]), expectedVersion: first.version }, { id: 'admin1', role: 'ADMIN' });
  assert.notEqual(first.version, second.version); assert.deepEqual(second.rules, []);
  assert.deepEqual(d.state.settings.find(row => row.key === firstRecord.key), firstRecord);
  assert.equal(d.state.audits.length, 2); assert.equal(d.state.audits[0].actorId, actor.id);
  assert.ok(d.operations.every(operation => operation.section === 'parent-measurements'));
  assert.deepEqual(d.state.settings.find(row => row.id === 'finance').value, { private: true });
  assert.deepEqual(d.state.settings.find(row => row.id === 'other-pm').value, { preserved: true });
});

test('only approved finite half-centimetre rules and unambiguous height intervals can be configured', async () => {
  const { ParentMeasurementsRangesService } = serviceModule();
  const valid = { id: 'chest', field: 1, lowerCm: 60, upperCm: 85 };
  const invalidRules = [
    [{ ...valid, field: 0 }], [{ ...valid, field: 18 }], [{ ...valid, field: 1.5 }],
    [{ ...valid, lowerCm: NaN }], [{ ...valid, upperCm: Infinity }], [{ ...valid, lowerCm: 0.5 }],
    [{ ...valid, upperCm: 9997 }], [{ ...valid, lowerCm: 60.25 }], [{ ...valid, lowerCm: 85 }],
    [{ ...valid, discipline: 'ACROBATICS' }], [{ ...valid, minHeightCm: 100.25 }],
    [{ ...valid, minHeightCm: 140, maxHeightCm: 120 }], [{ ...valid, minHeightCm: null }],
    [{ ...valid, guessedNorm: true }], [{ ...valid, id: 'bad id' }], [{ ...valid, id: '123456789' }],
    [valid, { ...valid, field: 2 }], // duplicate stable IDs
    [valid, { ...valid, id: 'second', minHeightCm: 140 }], // unbounded generic overlap
    [{ ...valid, minHeightCm: 120, maxHeightCm: 140 }, { ...valid, id: 'second', minHeightCm: 140, maxHeightCm: 160 }],
  ];
  for (const rules of invalidRules) {
    const d = database();
    await assert.rejects(new ParentMeasurementsRangesService(d.db).configure(input(rules), actor), error => error.getStatus() === 400);
    assert.equal(d.operations.length, 0);
  }
  const d = database(), service = new ParentMeasurementsRangesService(d.db);
  await assert.rejects(service.configure({ ...input([valid]), approvedForBodyMeasurements: false }, actor));
  await assert.rejects(service.configure({ rules: [valid], approvedForBodyMeasurements: true }, actor));
  await assert.rejects(service.configure({ ...input([valid]), section: 'finance' }, actor));
  const policy = await service.configure(input([
    { ...valid, maxHeightCm: 140 }, { ...valid, id: 'taller', minHeightCm: 140.5 },
    { ...valid, id: 'specific', discipline: 'ACROBATIC_GYMNASTICS' },
    { id: 'maximum', field: 17, lowerCm: 9996, upperCm: 9996.5 },
  ]), actor);
  assert.equal(policy.rules.length, 4);
});

test('rule selection prefers matching sport, requires actual height for bounded rules and invents no fallback', () => {
  const { rangeForDraft } = serviceModule();
  const generic = { id: 'generic', field: 1, lowerCm: 60, upperCm: 85 };
  const specific = { id: 'specific', field: 1, lowerCm: 62, upperCm: 80, discipline: 'ACROBATIC_GYMNASTICS', minHeightCm: 120, maxHeightCm: 140 };
  const policy = { version: 'b10771ad-3ccd-4444-8fc4-731ce39a89c1', rules: [generic, specific] };
  assert.equal(rangeForDraft(policy, { discipline: 'ACROBATIC_GYMNASTICS', heightCm: 130, values: {} }, 1).id, 'specific');
  assert.equal(rangeForDraft(policy, { discipline: 'ACROBATIC_GYMNASTICS', values: {} }, 1).id, 'generic');
  assert.equal(rangeForDraft(policy, { discipline: 'RHYTHMIC_GYMNASTICS', heightCm: 130, values: {} }, 1).id, 'generic');
  assert.equal(rangeForDraft(policy, { discipline: 'ACROBATIC_GYMNASTICS', heightCm: 150, values: {} }, 1).id, 'generic');
  assert.equal(rangeForDraft(policy, { discipline: 'ACROBATIC_GYMNASTICS', heightCm: 120, values: {} }, 1).id, 'specific');
  assert.equal(rangeForDraft(policy, { discipline: 'ACROBATIC_GYMNASTICS', heightCm: 140, values: {} }, 1).id, 'specific');
  assert.equal(rangeForDraft({ ...policy, rules: [specific] }, { values: {} }, 1), null);
  assert.equal(rangeForDraft(policy, { values: {} }, 2), null);
  assert.equal(rangeForDraft({ version: null, rules: [] }, { values: {} }, 1), null);
});

test('outside values remain unchanged and require a version/rule/value-bound ASCII acknowledgement', () => {
  const { rangeAcknowledgement, assertRangesAcknowledged } = serviceModule();
  const rule = { id: 'chest', field: 1, lowerCm: 60, upperCm: 85 };
  const policy = { version: 'b10771ad-3ccd-4444-8fc4-731ce39a89c1', rules: [rule] };
  const draft = { values: { m1: 59.5, m2: 50, m3: 65, m15: 110 }, rangeVersion: policy.version };
  const token = rangeAcknowledgement(policy, rule, 1, 59.5);
  assert.equal(token, 'b10771ad-3ccd-4444-8fc4-731ce39a89c1:chest:m1:119');
  assert.match(token, /^[A-Za-z0-9:_-]{1,56}$/);
  assert.equal(token, rangeAcknowledgement(structuredClone(policy), { ...rule }, 1, 59.5));
  assert.notEqual(token, rangeAcknowledgement(policy, rule, 1, 59));
  assert.notEqual(token, rangeAcknowledgement(policy, { ...rule, id: 'another' }, 1, 59.5));
  assert.notEqual(token, rangeAcknowledgement(policy, rule, 2, 59.5));
  assert.notEqual(token, rangeAcknowledgement({ ...policy, version: 'b10771ad-3ccd-4444-8fc4-731ce39a89c2' }, rule, 1, 59.5));
  assert.throws(() => assertRangesAcknowledged(policy, draft), error => error.getStatus() === 400 && error.getResponse().warnings[0].acknowledgement === token);
  const confirmed = { ...draft, warningsAcknowledged: [token] }, before = structuredClone(confirmed);
  assert.deepEqual(assertRangesAcknowledged(policy, confirmed), [{ code: 'OUTSIDE_APPROVED_RANGE', field: 1, ruleId: 'chest', rangeVersion: policy.version, valueCm: 59.5, lowerCm: 60, upperCm: 85, acknowledgement: token, acknowledged: true }]);
  assert.deepEqual(confirmed, before);
  assert.throws(() => assertRangesAcknowledged(policy, { ...confirmed, values: { m1: 59 } }), error => error.getStatus() === 400);
  assert.throws(() => assertRangesAcknowledged(policy, { ...confirmed, rangeVersion: null }), error => error.getStatus() === 409);
  assert.throws(() => assertRangesAcknowledged(policy, { ...confirmed, rangeVersion: 'old' }), error => error.getStatus() === 409);
  assert.deepEqual(assertRangesAcknowledged(policy, { ...draft, values: { m1: 60 } }), []);
  assert.deepEqual(assertRangesAcknowledged(policy, { ...draft, values: { m1: 85 } }), []);
  assert.deepEqual(assertRangesAcknowledged({ version: null, rules: [] }, { values: { m1: 400 } }), []);
  assert.deepEqual(assertRangesAcknowledged(policy, { rangeVersion: policy.version, values: { m2: 400 } }), []);
  assert.throws(() => assertRangesAcknowledged(policy, { ...draft, warningsAcknowledged: token }), error => error.getStatus() === 400);
  assert.throws(() => assertRangesAcknowledged(policy, { ...draft, values: { m1: NaN } }), error => error.getStatus() === 400);
});

test('owner/admin CAS serializes competing configurations and rejects other staff before any transaction writes', async () => {
  const { ParentMeasurementsRangesService } = serviceModule(), d = database(), service = new ParentMeasurementsRangesService(d.db);
  for (const role of ['MANAGER', 'ACCOUNTANT', 'PRODUCTION', undefined]) {
    await assert.rejects(service.configure(input([]), { id: 'staff1', role }), error => error.getStatus() === 403);
  }
  assert.equal(d.operations.length, 0);
  const results = await Promise.allSettled([service.configure(input([]), actor), service.configure(input([]), actor)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.getStatus(), 409);
  assert.equal(d.state.settings.filter(row => row.key.startsWith('range-version:')).length, 1);
  assert.equal(d.state.audits.length, 1);
  await assert.rejects(service.configure(input([]), actor), error => error.getStatus() === 409);
});

test('audit failure rolls back both the active pointer and the newly appended version', async () => {
  const { ParentMeasurementsRangesService } = serviceModule(), d = database(), service = new ParentMeasurementsRangesService(d.db);
  const first = await service.configure(input([]), actor), before = d.state;
  d.failAudit();
  await assert.rejects(service.configure({ ...input([{ field: 1, lowerCm: 60, upperCm: 85 }]), expectedVersion: first.version }, actor), /audit unavailable/);
  assert.deepEqual(d.state, before); assert.deepEqual(await service.policy(), first);
});

test('dangling/corrupted active configurations fail closed rather than silently disabling warnings', async () => {
  const { ParentMeasurementsRangesService } = serviceModule();
  for (const payload of [null, { version: 'bad' }, { version: 'b10771ad-3ccd-4444-8fc4-731ce39a89c1' }]) {
    const d = database(); d.seed({ id: 'pointer', section: 'parent-measurements', key: 'ranges-active', value: payload });
    await assert.rejects(new ParentMeasurementsRangesService(d.db).policy(), error => error.getStatus() === 503);
  }
  const d = database(), version = 'b10771ad-3ccd-4444-8fc4-731ce39a89c1';
  d.seed({ id: 'pointer', section: 'parent-measurements', key: 'ranges-active', value: { version } });
  d.seed({ id: 'version', section: 'parent-measurements', key: `range-version:${version}`, value: { version, approvedForBodyMeasurements: true, rules: [{ id: 'bad', field: 1, lowerCm: 90, upperCm: 60 }] } });
  await assert.rejects(new ParentMeasurementsRangesService(d.db).policy(), error => error.getStatus() === 503);
});

test('range DTOs retain strict whitelisting metadata for all nested fields and require explicit approval/CAS', async () => {
  const { ParentRangesConfigureDto } = load('parent-measurements/parent-measurements-ranges.dto.ts');
  const { ValidationPipe } = native('@nestjs/common');
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const meta = { type: 'body', metatype: ParentRangesConfigureDto };
  const good = { ...input([{ id: 'chest', field: 1, lowerCm: 60.5, upperCm: 85, discipline: 'ACROBATIC_GYMNASTICS', minHeightCm: 120, maxHeightCm: 140 }]) };
  const transformed = await pipe.transform(good, meta);
  assert.equal(transformed.rules[0].lowerCm, 60.5); assert.equal(transformed.expectedVersion, null);
  for (const bad of [
    { ...good, guessedNorms: true }, { ...good, approvedForBodyMeasurements: false }, { rules: good.rules, approvedForBodyMeasurements: true },
    { ...good, expectedVersion: 'old' }, { ...good, rules: [{ ...good.rules[0], lowerCm: 60.25 }] },
    { ...good, rules: [{ ...good.rules[0], minHeightCm: null }] }, { ...good, rules: [{ ...good.rules[0], extra: true }] },
    { ...good, rules: [{ ...good.rules[0], discipline: 'ACROBATICS' }] },
    { ...good, rules: [{ ...good.rules[0], id: '123456789' }] },
  ]) await assert.rejects(pipe.transform(bad, meta), error => error.getStatus() === 400);
});

test('literal acknowledgement interoperates with the mobile declaration and remains within 56 ASCII characters', () => {
  const { rangeAcknowledgement, assertRangesAcknowledged } = serviceModule();
  const version = 'b10771ad-3ccd-4444-8fc4-731ce39a89c1';
  const rule = { id: 'r1', field: 1, lowerCm: 60, upperCm: 65 }, policy = { version, rules: [rule] };
  assert.equal(rangeAcknowledgement(policy, rule, 1, 70), 'b10771ad-3ccd-4444-8fc4-731ce39a89c1:r1:m1:140');
  const mobileDeclaration = `${version}:${rule.id}:m1:${Math.round(70 * 2)}`;
  assert.equal(assertRangesAcknowledged(policy, { rangeVersion: version, values: { m1: 70 }, warningsAcknowledged: [mobileDeclaration] })[0].acknowledged, true);
  assert.match(rangeAcknowledgement(policy, { ...rule, id: 'A_z-0123' }, 17, 9999.5), /^[A-Za-z0-9:_-]{1,56}$/);
  for (const id of ['', '123456789', 'r:1', 'мерка']) assert.throws(() => rangeAcknowledgement(policy, { ...rule, id }, 1, 70));
});

test('generated eight-character rule IDs retry collisions with supplied and generated IDs', async t => {
  const { ParentMeasurementsRangesService } = serviceModule();
  const candidates = ['AAAAAAAA', 'BBBBBBBB', 'BBBBBBBB', 'CCCCCCCC'];
  t.mock.method(native('node:crypto'), 'randomBytes', size => { assert.equal(size, 6); assert.ok(candidates.length); return Buffer.from(candidates.shift(), 'base64url'); });
  const d = database();
  const policy = await new ParentMeasurementsRangesService(d.db).configure(input([
    { field: 1, lowerCm: 60, upperCm: 85 },
    { id: 'AAAAAAAA', field: 2, lowerCm: 50, upperCm: 70 },
    { field: 3, lowerCm: 65, upperCm: 90 },
  ]), actor);
  assert.deepEqual(policy.rules.map(rule => rule.id), ['BBBBBBBB', 'AAAAAAAA', 'CCCCCCCC']);
  assert.ok(policy.rules.every(rule => /^[A-Za-z0-9_-]{8}$/.test(rule.id)));
  assert.equal(candidates.length, 0);
});

test('policy reads the supplied submit transaction instead of the root client', async () => {
  const { ParentMeasurementsRangesService } = serviceModule();
  const version = 'b10771ad-3ccd-4444-8fc4-731ce39a89c1';
  const rules = [{ id: 'r1', field: 1, lowerCm: 60, upperCm: 85 }];
  const reads = [];
  const tx = { appSetting: { async findUnique({ where }) {
    reads.push(where.section_key);
    return where.section_key.key === 'ranges-active'
      ? { value: { version } }
      : { value: { version, rules, approvedForBodyMeasurements: true } };
  } } };
  const root = { appSetting: { findUnique() { throw Error('root client must not be used'); } } };
  assert.deepEqual(await new ParentMeasurementsRangesService(root).policy(tx), { version, rules });
  assert.deepEqual(reads, [
    { section: 'parent-measurements', key: 'ranges-active' },
    { section: 'parent-measurements', key: `range-version:${version}` },
  ]);
});
