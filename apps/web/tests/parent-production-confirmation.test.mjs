import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
const labels = { title: 'PRODUCTION', hint: 'BODY CHANGE', confirmed: 'CONFIRM', reason: 'REASON', required: 'REQUIRED', continue: 'CONTINUE', cancel: 'CANCEL', changed: 'CHANGED' };
const designLabels = { athlete: 'ATHLETE', version: 'SNAPSHOT', height: 'HEIGHT', save: 'SAVE', cancel: 'CANCEL', newVersion: 'NEW VERSION' };
const MeasurementPanel = () => null;
function compile(source, imports) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'crypto', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => imports[name] ?? require(name), mod, mod.exports, { randomUUID: () => 'operation-key' });
  return mod.exports;
}
function harness(kind, overrides = {}) {
  const state = [], effects = []; let cursor = 0; const requests = [];
  const react = { ...require('react'), useState(initial) { const n = cursor++; if (!(n in state)) state[n] = typeof initial === 'function' ? initial() : initial; return [state[n], value => { state[n] = typeof value === 'function' ? value(state[n]) : value; }]; }, useRef(initial) { const n = cursor++; return state[n] ??= { current: initial }; }, useEffect(fn, deps) { const n = cursor++; if (!state[n] || deps.some((value, index) => value !== state[n][index])) { state[n] = deps; effects.push(fn); } } };
  const old = { id: 'old', athleteId: 'a1', measuredAt: '2026-10-18', definitionVersion: null, values: { m1: 60 } };
  const body = { ...old, id: 'body', definitionVersion: 'PARENT_BODY_V1' };
  const athlete = { id: 'a1', firstName: 'Анна', measurements: [old, body] };
  const instance = { id: 'piece1', updatedAt: 'piece-v1', ordinal: 1, productionStatus: 'SEWING', athlete, measurement: old, ...overrides.instance };
  const item = { id: 'item1', name: 'Дизайн', instances: [instance] };
  const bridge = { request: async (path, init) => { requests.push({ path, body: JSON.parse(init.body) }); return { ...body, id: 'created' }; }, onSaved: async () => {} };
  let props = { order: { id: 'order1', client: { id: 'client1', displayName: 'Клиент', athletes: [athlete] } }, items: [item], bridge, onClose() {}, athlete, assignment: { id: 'assignment1', item, instance }, measurement: body, actions: bridge, ...overrides, instance };
  // The direct editor is private. Extract its complete function, leaving the owning module's other exports untouched.
  let source = readFileSync(new URL(`../components/orders/${kind === 'drawer' ? 'instance-measurement-drawer' : 'order-expanded-tabs'}.tsx`, import.meta.url), 'utf8');
  if (kind === 'editor') {
    const ast = ts.createSourceFile('tabs.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'OrderMeasurementEditor');
    source = `const {useState,useRef,useEffect}=require('react'); const {Modal}=require('@mantine/core'); const {CrmAlert,CrmCheckbox,CrmTextarea,CrmButton}=require('controls'); const {MeasurementPanel}=require('../measurement-panel'); const {ordersDashboardUi:ui,parentProductionConfirmationUi:parentProductionUi}=require('../../lib/i18n'); export ${node.getText(ast)}`;
  }
  const mod = compile(source, { react,
    '../../lib/i18n': { designsInstancesUi: designLabels, ordersDashboardUi: { editMeasurements: 'EDIT', addMeasurements: 'ADD' }, parentProductionConfirmationUi: labels },
    '../../lib/measurement-semantics': { measurementSemanticNote: () => undefined, measurementDefinitionSupported: () => true },
    '../measurement-panel': { MeasurementPanel }, controls: { CrmAlert: 'alert', CrmCheckbox: 'checkbox', CrmTextarea: 'textarea', CrmButton: 'button' },
  });
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
  function render() { cursor = 0; let node = (kind === 'drawer' ? mod.InstanceMeasurementDrawer : mod.OrderMeasurementEditor)(props); if (effects.length) { for (const effect of effects.splice(0)) effect(); cursor = 0; node = (kind === 'drawer' ? mod.InstanceMeasurementDrawer : mod.OrderMeasurementEditor)(props); } return node; }
  const field = label => all(render()).find(node => node.props?.label === label);
  const button = label => all(render()).find(node => node.props?.children === label && node.props?.onClick);
  const panel = () => all(render()).find(node => node.type === MeasurementPanel);
  async function click(label) { const node = button(label); assert.ok(node, label); await node.props.onClick(); await new Promise(setImmediate); }
  return { all, render, field, button, panel, click, requests, instance, item, athlete, old, body, setProps: next => { props = { ...props, ...next }; } };
}

test('bulk parent-body WIP reassignment requires explicit confirmation/reason and preserves captured CAS', async () => {
  const h = harness('drawer'); h.field('SNAPSHOT').props.onChange('body');
  await h.click('SAVE'); assert.equal(h.requests.length, 0);
  assert.ok(h.field('CONFIRM')); h.field('CONFIRM').props.onChange({ currentTarget: { checked: true } });
  await h.click('SAVE'); assert.equal(h.requests.length, 0);
  h.field('REASON').props.onChange({ currentTarget: { value: 'Подтверждено после проверки рукава' } });
  await h.click('SAVE');
  assert.deepEqual(h.requests[0].body.targets, [{ id: 'piece1', expectedUpdatedAt: 'piece-v1' }]);
  assert.equal(h.requests[0].body.confirmProduction, true); assert.equal(h.requests[0].body.reason, 'Подтверждено после проверки рукава');
});

test('direct instance snapshot editor confirms WIP before opening and forwards frozen expected versions', async () => {
  const h = harness('editor');
  assert.equal(h.panel(), undefined); assert.ok(h.field('CONFIRM'));
  await h.click('CONTINUE'); assert.equal(h.panel(), undefined);
  h.field('CONFIRM').props.onChange({ currentTarget: { checked: true } });
  h.field('REASON').props.onChange({ currentTarget: { value: '  Рукав согласован с производством  ' } });
  await h.click('CONTINUE');
  assert.ok(h.panel()); assert.equal(h.requests.length, 0);
  await h.panel().props.request('/clients/client1/athletes/a1/measurements', { method: 'POST', body: JSON.stringify({ m1: 61, sourceMeasurementId: 'body' }) });
  assert.equal(h.requests[0].path, '/order-tabs/order1/instances/piece1/measurement');
  assert.deepEqual(h.requests[0].body, { m1: 61, sourceMeasurementId: 'body', expectedMeasurementId: 'old', expectedUpdatedAt: 'piece-v1', confirmProduction: true, reason: 'Рукав согласован с производством' });
});

for (const selection of ['old', null]) test(`removing parent-body snapshot to ${selection ?? 'no snapshot'} still requires confirmation`, async () => {
  const h = harness('drawer', { instance: { measurement: { id: 'body', athleteId: 'a1', definitionVersion: 'PARENT_BODY_V1' } } });
  h.field('SNAPSHOT').props.onChange(selection);
  await h.click('SAVE'); assert.equal(h.requests.length, 0); assert.ok(h.field('CONFIRM'));
});

for (const change of ['snapshot', 'athlete', 'targets', 'stored version']) test(`${change} change resets production confirmation`, async () => {
  const h = harness('drawer'); h.field('SNAPSHOT').props.onChange('body');
  h.field('CONFIRM').props.onChange({ currentTarget: { checked: true } });
  h.field('REASON').props.onChange({ currentTarget: { value: 'Согласовано' } });
  if (change === 'snapshot') { h.field('SNAPSHOT').props.onChange('old'); h.field('SNAPSHOT').props.onChange('body'); }
  if (change === 'athlete') { h.field('ATHLETE').props.onChange(null); h.field('ATHLETE').props.onChange('a1'); h.field('SNAPSHOT').props.onChange('body'); }
  if (change === 'targets') {
    let field = h.all(h.render()).find(node => node.props?.label?.startsWith('Дизайн'));
    field.props.onChange({ currentTarget: { checked: false } });
    field = h.all(h.render()).find(node => node.props?.label?.startsWith('Дизайн'));
    field.props.onChange({ currentTarget: { checked: true } });
  }
  if (change === 'stored version') h.setProps({ items: [{ ...h.item, instances: [{ ...h.instance, updatedAt: 'piece-v2' }] }] });
  assert.equal(h.field('CONFIRM').props.checked, false); assert.equal(h.field('REASON').props.value, '');
  await h.click('SAVE'); assert.equal(h.requests.length, 0);
});

for (const status of ['NOT_SCHEDULED', 'TENTATIVE', 'SCHEDULED']) test(`${status} parent-body assignment preserves the prestart save contract`, async () => {
  const h = harness('drawer', { instance: { productionStatus: status } }); h.field('SNAPSHOT').props.onChange('body');
  assert.equal(h.field('CONFIRM'), undefined); await h.click('SAVE');
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body.confirmProduction, undefined);
});

test('startedAt overrides a planning status; legacy WIP and parent-body size-only no-ops need no flags', async () => {
  const started = harness('drawer', { instance: { productionStatus: 'SCHEDULED', startedAt: '2026-10-19' } });
  started.field('SNAPSHOT').props.onChange('body'); await started.click('SAVE'); assert.equal(started.requests.length, 0);
  const legacy = harness('drawer'); assert.equal(legacy.field('CONFIRM'), undefined); await legacy.click('SAVE'); assert.equal(legacy.requests[0].body.confirmProduction, undefined);
  const unchanged = harness('drawer', { instance: { measurement: { id: 'body', athleteId: 'a1', definitionVersion: 'PARENT_BODY_V1' } } });
  unchanged.field('HEIGHT').props.onChange(140); assert.equal(unchanged.field('CONFIRM'), undefined); await unchanged.click('SAVE');
  assert.equal(unchanged.requests[0].body.standardHeight, 140); assert.equal(unchanged.requests[0].body.confirmProduction, undefined);
});

test('direct editor requires confirmation for old parent-body to new legacy, but not legacy to legacy', () => {
  const oldBody = harness('editor', { instance: { measurement: { id: 'body', athleteId: 'a1', definitionVersion: 'PARENT_BODY_V1' } }, measurement: { id: 'legacy-source', definitionVersion: null } });
  assert.equal(oldBody.panel(), undefined); assert.ok(oldBody.field('CONFIRM'));
  const legacy = harness('editor', { measurement: { id: 'legacy-source', definitionVersion: null } });
  assert.ok(legacy.panel()); assert.equal(legacy.field('CONFIRM'), undefined);
});

test('direct editor invalidates approval when its selected snapshot or instance version changes', async () => {
  const h = harness('editor');
  h.render(); h.field('CONFIRM').props.onChange({ currentTarget: { checked: true } });
  h.field('REASON').props.onChange({ currentTarget: { value: 'Согласовано' } }); await h.click('CONTINUE'); assert.ok(h.panel());
  h.setProps({ measurement: { ...h.body, id: 'different-source' } });
  assert.equal(h.panel(), undefined); assert.equal(h.field('CONFIRM').props.checked, false);
  h.setProps({ measurement: h.body });
  assert.equal(h.panel(), undefined); assert.equal(h.field('CONFIRM').props.checked, false);
});

test('legacy-to-legacy WIP changes keep the original payload; oversized parent-body reasons cannot be submitted', async () => {
  const legacy = harness('drawer'); legacy.athlete.measurements.push({ ...legacy.old, id: 'legacy2' });
  legacy.field('SNAPSHOT').props.onChange('legacy2'); await legacy.click('SAVE');
  assert.equal(legacy.requests[0].body.measurementId, 'legacy2'); assert.equal(legacy.requests[0].body.confirmProduction, undefined);
  const body = harness('drawer'); body.field('SNAPSHOT').props.onChange('body');
  body.field('CONFIRM').props.onChange({ currentTarget: { checked: true } });
  body.field('REASON').props.onChange({ currentTarget: { value: 'x'.repeat(2001) } });
  await body.click('SAVE'); assert.equal(body.requests.length, 0); assert.equal(body.field('REASON').props.maxLength, 2000);
  body.field('REASON').props.onChange({ currentTarget: { value: 'x'.repeat(2000) } });
  await body.click('SAVE'); assert.equal(body.requests.length, 1); assert.equal(body.requests[0].body.reason.length, 2000);
});

test('bulk consent covers the exact mixed selected cohort with original versions after a parent rerender', async () => {
  const h = harness('drawer');
  const sibling = { ...h.instance, id: 'piece2', ordinal: 2, updatedAt: 'sibling-v1', productionStatus: 'SCHEDULED' };
  // A new editor opening captures this complete cohort before the first render.
  h.setProps({ items: [{ ...h.item, instances: [h.instance, sibling] }] });
  h.field('SNAPSHOT').props.onChange('body');
  h.all(h.render()).find(node => node.props?.label?.startsWith('Дизайн · 1.2')).props.onChange({ currentTarget: { checked: true } });
  h.field('CONFIRM').props.onChange({ currentTarget: { checked: true } });
  h.field('REASON').props.onChange({ currentTarget: { value: 'Оба изделия проверены' } });
  await h.click('SAVE');
  assert.deepEqual(h.requests[0].body.targets, [{ id: 'piece1', expectedUpdatedAt: 'piece-v1' }, { id: 'piece2', expectedUpdatedAt: 'sibling-v1' }]);
  assert.equal(h.requests[0].body.confirmProduction, true);
});

test('manual unassigned version prefills an owned athlete and snapshot but requires explicit costume selection',async()=>{
 const h=harness('drawer',{initialSelection:{athleteId:'a1',measurementId:'body'},initialTargets:[]});
 assert.equal(h.field('ATHLETE').props.value,'a1');assert.equal(h.field('SNAPSHOT').props.value,'body');
 await h.click('SAVE');assert.equal(h.requests.length,0);
 assert.equal(h.all(h.render()).find(n=>n.props?.label?.startsWith('Дизайн · 1.1')).props.checked,false);
});

test('manual profile sport updates advance the expected discipline independently of opening props',async()=>{
 const h=harness('editor',{assignment:undefined});
 await h.panel().props.onDisciplineSave('FIGURE_SKATING');await h.panel().props.onDisciplineSave('RHYTHMIC_GYMNASTICS');
 assert.equal(h.requests[0].body.expectedDiscipline,null);assert.equal(h.requests[1].body.expectedDiscipline,'FIGURE_SKATING');assert.equal(h.requests[1].body.discipline,'RHYTHMIC_GYMNASTICS');assert.equal(h.requests[0].path,'/clients/client1/athletes/a1');
});
