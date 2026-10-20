import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const native = createRequire(import.meta.url);
native('reflect-metadata');
const root = fileURLToPath(new URL('../src/', import.meta.url));
const modules = new Map();
function load(path) {
  const file = resolve(root, path);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  const local = createRequire(file);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    name => name.startsWith('.') && existsSync(resolve(dirname(file), name + '.ts'))
      ? load(resolve(dirname(file), name + '.ts')) : local(name), module, module.exports);
  return module.exports;
}
const reference = () => load('parent-measurements/parent-measurements-reference-ranges.ts');
const backend = () => load('parent-measurements/parent-measurements-ranges.service.ts');
const fields = [1, 2, 3, 15];
function bounds(rules, height) {
  return fields.map(field => {
    const selected = rules.filter(rule => rule.field === field && height >= rule.minHeightCm && height <= rule.maxHeightCm);
    assert.equal(selected.length, 1);
    return [selected[0].lowerCm, selected[0].upperCm];
  });
}

test('approved photographic examples at 140 and 168 cm use both gymnastic charts', () => {
  const rules = reference().generateParentMeasurementsReferenceRanges();
  assert.deepEqual(bounds(rules, 140), [[67, 73], [55, 61], [71, 77], [122, 129]]);
  assert.deepEqual(bounds(rules, 168), [[83, 91], [66, 73], [88, 101], [150, 157]]);
});

// Independently retained photograph transcription: height/chest/waist/hips/full arc.
const photoRows = [
  `105 56 50 59 104;110 58 51 61 107;115 60 52 63 110;120 62 53 65 113;
125 64 54 68 116;130 66 55 70 119;135 68 56 72 122;140 70 58 74 125;
144 72 59 76 128;148 74 61 78 131;152 76 62 81 134;156 78 64 83 137;
159 80 65 85 141;162 82 67 87 145;165 84 68 89 149;168 86 70 91 153;172 88 71 93 158`,
  `95 52 48 55 96;100 54 49 57 100;105 56 51 59 104;110 58 52 61 108;
115 60 53 63 111;120 62 54 65 114;125 64 55 68 117;130 66 56 70 120;
135 68 57 72 123;140 70 58 74 126;144 72 60 77 129;148 74 61 79 133;
152 76 62 81 136;156 78 64 84 139;159 80 65 86 142;161 82 66 88 145;
164 84 67 91 148;166 86 68 94 151;168 88 69 98 154;170 90 70 100 157;
172 92 72 102 160;174 94 74 104 163;176 96 76 106 167`,
].map(table => table.split(';').map(row => row.trim().split(/\s+/).map(Number)));

test('source metadata pins both original files and only the five approved columns', () => {
  const { PARENT_MEASUREMENTS_REFERENCE_SOURCES: sources, PARENT_MEASUREMENTS_REFERENCE_PACK: pack } = reference();
  assert.equal(pack.id, 'gym-two-charts-v1');
  assert.equal(pack.marginCm, 3); assert.equal(pack.heightStepCm, 0.5);
  assert.deepEqual(pack.fields, fields);
  assert.deepEqual(sources.map(source => [source.filename, source.sha256, source.minHeightCm, source.maxHeightCm]), [
    ['IMG_20210223_095236 (1).jpg', '21cb1513aff594536136b544bbbfe589c35954c9a44808f0c73cf592f2ef07e4', 105, 172],
    ['1708664899317.jpg', '3b94dee146198ea9aa58ca0d71739064fd3893696e0a2400abcf85c343c8d51a', 95, 176],
  ]);
  for (const [index, source] of sources.entries()) {
    assert.deepEqual(source.rows.map(row => Object.values(row)), photoRows[index]);
    for (const row of source.rows) assert.deepEqual(Object.keys(row), ['heightCm', 'chestCm', 'waistCm', 'hipsCm', 'fullTorsoArcCm']);
  }
});

test('coverage endpoints and half-cm midpoint ties do not extrapolate either source', () => {
  const rules = reference().generateParentMeasurementsReferenceRanges();
  for (const [height, expected] of [
    [95, [[49, 55], [45, 51], [52, 58], [93, 99]]],
    [104.5, [[53, 59], [48, 54], [56, 62], [101, 107]]],
    [105, [[53, 59], [47, 54], [56, 62], [101, 107]]],
    [107.5, [[53, 59], [47, 54], [56, 62], [101, 107]]],
    [108, [[55, 61], [48, 55], [58, 64], [104, 111]]],
    [142, [[67, 73], [55, 61], [71, 77], [122, 129]]],
    [142.5, [[69, 75], [56, 63], [73, 80], [125, 132]]],
    [167, [[83, 89], [65, 73], [88, 97], [148, 156]]],
    [172, [[85, 95], [68, 75], [90, 105], [155, 163]]],
    [172.5, [[89, 95], [69, 75], [99, 105], [157, 163]]],
    [176, [[93, 99], [73, 79], [103, 109], [164, 170]]],
  ]) assert.deepEqual(bounds(rules, height), expected, `height ${height}`);
  const { rangeForDraft } = backend(), policy = { version: null, rules };
  for (const heightCm of [undefined, 94.5, 176.5, 1, 9999.5, NaN, 140.25]) {
    for (const field of fields) assert.equal(rangeForDraft(policy, { heightCm, values: {} }, field), null);
  }
});

test('every canonical height has exactly four nonoverlapping rules agreeing with an independent photo oracle', () => {
  const rules = reference().generateParentMeasurementsReferenceRanges();
  const { rangeForDraft } = backend();
  const policy = { version: null, rules };
  for (let heightCm = 95; heightCm <= 176; heightCm += 0.5) {
    const nearest = photoRows.filter(table => heightCm >= table[0][0] && heightCm <= table.at(-1)[0])
      .map(table => [...table].sort((a, b) => Math.abs(a[0] - heightCm) - Math.abs(b[0] - heightCm) || a[0] - b[0])[0]);
    const expected = [1, 2, 3, 4].map(column => {
      const candidates = nearest.map(row => row[column]).sort((a, b) => a - b);
      return [candidates[0] - 3, candidates.at(-1) + 3];
    });
    assert.deepEqual(bounds(rules, heightCm), expected, `photo oracle at ${heightCm}`);
    for (const field of fields) assert.ok(rangeForDraft(policy, { heightCm, values: {} }, field));
    for (let field = 1; field <= 17; field++) {
      if (!fields.includes(field)) assert.equal(rangeForDraft(policy, { heightCm, values: {} }, field), null);
    }
  }
  assert.ok(rules.length <= 512);
  assert.equal(new Set(rules.map(rule => rule.id)).size, rules.length);
  for (const rule of rules) {
    assert.match(rule.id, /^[A-Za-z0-9_-]{1,8}$/);
    assert.deepEqual(Object.keys(rule).sort(), ['field', 'id', 'lowerCm', 'maxHeightCm', 'minHeightCm', 'upperCm']);
    for (const key of ['minHeightCm', 'maxHeightCm', 'lowerCm', 'upperCm']) assert.ok(Number.isInteger(rule[key] * 2));
    assert.ok(rule.lowerCm < rule.upperCm);
  }
  for (const field of fields) {
    const intervals = rules.filter(rule => rule.field === field);
    assert.equal(intervals[0].minHeightCm, 95); assert.equal(intervals.at(-1).maxHeightCm, 176);
    for (let i = 1; i < intervals.length; i++) {
      const a = intervals[i - 1], b = intervals[i];
      assert.equal(b.minHeightCm, a.maxHeightCm + 0.5);
      assert.ok(a.lowerCm !== b.lowerCm || a.upperCm !== b.upperCm, 'adjacent identical bounds must merge');
    }
  }
});

test('pure generation has no runtime imports, frozen provenance and independent deterministic results', () => {
  const file = resolve(root, 'parent-measurements/parent-measurements-reference-ranges.ts');
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  // No process, DB, filesystem, clock, network or runtime imports available.
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    Date: undefined, process: undefined, fetch: undefined,
  })(name => { throw Error(`unexpected runtime import ${name}`); }, module, module.exports);
  const a = JSON.stringify(module.exports.generateParentMeasurementsReferenceRanges());
  assert.equal(a, JSON.stringify(reference().generateParentMeasurementsReferenceRanges()));
  const original = reference().generateParentMeasurementsReferenceRanges();
  original[0].lowerCm = 999; original.pop();
  assert.equal(a, JSON.stringify(reference().generateParentMeasurementsReferenceRanges()));
  const { PARENT_MEASUREMENTS_REFERENCE_SOURCES: sources } = reference();
  assert.throws(() => { sources[0].rows[0].chestCm = 999; }, TypeError);
  assert.throws(() => { sources.push({}); }, TypeError);
});

test('generated payload passes existing DTO and persisted-rule validation without any writes', async () => {
  const rules = reference().generateParentMeasurementsReferenceRanges();
  const { ParentRangesConfigureDto } = load('parent-measurements/parent-measurements-ranges.dto.ts');
  const { ValidationPipe } = native('@nestjs/common');
  const input = { rules, expectedVersion: null, approvedForBodyMeasurements: true };
  const validated = await new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
    .transform(input, { type: 'body', metatype: ParentRangesConfigureDto });
  assert.equal(validated.rules.length, rules.length);
  const version = 'b10771ad-3ccd-4444-8fc4-731ce39a89c1';
  const { ParentMeasurementsRangesService } = backend();
  const service = new ParentMeasurementsRangesService({ appSetting: { async findUnique({ where }) {
    assert.equal(where.section_key.section, 'parent-measurements');
    assert.ok(['ranges-active', `range-version:${version}`].includes(where.section_key.key));
    return { value: where.section_key.key === 'ranges-active' ? { version } : { version, rules, approvedForBodyMeasurements: true } };
  } } });
  assert.deepEqual(await service.policy(), { version, rules });
});

test('public acknowledgement preserves exact values and rejects stale value, version and changed range', () => {
  const { rangeForDraft, rangeAcknowledgement, assertRangesAcknowledged } = backend();
  const policy = { version: 'b10771ad-3ccd-4444-8fc4-731ce39a89c1', rules: reference().generateParentMeasurementsReferenceRanges() };
  const draft = { heightCm: 140, values: { m1: 66.5, m2: 58, m3: 74, m15: 125, m6: 999 }, rangeVersion: policy.version };
  const rule = rangeForDraft(policy, draft, 1);
  const acknowledgement = rangeAcknowledgement(policy, rule, 1, 66.5);
  assert.match(acknowledgement, /^[A-Za-z0-9:_-]{1,56}$/);
  assert.throws(() => assertRangesAcknowledged(policy, draft), error => error.getStatus() === 400);
  const confirmed = { ...draft, warningsAcknowledged: [acknowledgement] }, before = structuredClone(confirmed);
  assert.equal(assertRangesAcknowledged(policy, confirmed)[0].acknowledged, true);
  assert.deepEqual(confirmed, before);
  assert.throws(() => assertRangesAcknowledged(policy, { ...confirmed, values: { ...draft.values, m1: 66 } }), error => error.getStatus() === 400);
  assert.throws(() => assertRangesAcknowledged(policy, { ...confirmed, heightCm: 144 }), error => error.getStatus() === 400);
  assert.throws(() => assertRangesAcknowledged({ ...policy, version: 'b10771ad-3ccd-4444-8fc4-731ce39a89c2' }, confirmed), error => error.getStatus() === 409);
  for (const value of [67, 73]) assert.deepEqual(assertRangesAcknowledged(policy, { ...draft, values: { m1: value } }), []);
  for (const value of [66.5, 73.5]) assert.throws(() => assertRangesAcknowledged(policy, { ...draft, values: { m1: value } }), error => error.getStatus() === 400);
  for (const heightCm of [undefined, 94.5, 176.5]) assert.deepEqual(assertRangesAcknowledged(policy, { ...draft, heightCm }), []);
});
