import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function compile(path, imports = {}) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'window', ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => imports[name] ?? require(name), mod, mod.exports, { requestAnimationFrame: fn => fn(), setTimeout: fn => fn() });
  return mod.exports;
}
const dictionary = compile('../lib/i18n.ts'), ui = dictionary.athleteMeasurementWizardUi, editorUi = dictionary.measurementEditorUi;
function harness(extra = {}) {
  const hooks = [], effects = [], writes = []; let cursor = 0;
  const react = { ...require('react'),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || deps.some((v, n) => v !== hooks[i][n])) { hooks[i] = deps; effects.push(fn); } },
  };
  const { AthleteMeasurementWizard } = compile('../components/athlete-measurement-wizard.tsx', { react, '@mantine/core': { Modal: 'Modal', Drawer: 'Drawer' }, '../lib/i18n': dictionary,
    './crm/alert': { CrmAlert: 'Alert' }, './crm/settings-controls': { CrmButton: 'Button', CrmNativeSelect: 'Select', CrmTextInput: 'Input', CrmTextarea: 'Textarea' },
    './measurement-definition': { measurementPresets: {} }, './measurement-editor': { MeasurementEditor: 'MeasurementEditor' },
  });
  const props = { clientId: 'c1', clientName: 'Клиент', request: async (path, init) => { writes.push({ path, body: JSON.parse(init.body) }); return { id: 'a1' }; }, onSaved: async () => {}, onClose() {}, returnFocusRef: { current: null }, ...extra };
  const all = node => !node || typeof node !== 'object' || node.props?.opened === false ? [] : Array.isArray(node) ? node.flatMap(all) : typeof node.type === 'function' ? all(node.type(node.props)) : [node, ...all(node.props?.children), ...all(node.props?.context), ...all(node.props?.footer)];
  function render() { cursor = 0; return AthleteMeasurementWizard(props); }
  const field = label => all(render()).find(node => node.props?.label === label);
  const editor = () => all(render()).find(node => node.type === 'MeasurementEditor');
  const settle = async () => { for (const fn of effects.splice(0)) fn(); await new Promise(setImmediate); };
  function enterMeasurements() { field(ui.firstName).props.onChange({ currentTarget: { value: 'Анна' } }); field(ui.comment).props.onChange({ currentTarget: { value: 'Профильный комментарий' } }); all(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); }
  function confirm() { for (const [key, value] of Object.entries({ m1: '60', m2: '50', m3: '65', m15: '110' })) editor().props.onValue(key, value); editor().props.onSubmit({ preventDefault() {} }); }
  async function save() { all(render()).find(node => node.type === 'Button' && node.props?.children === ui.save).props.onClick(); await settle(); }
  return { all, render, field, editor, enterMeasurements, confirm, save, settle, writes };
}
test('optional order metadata saves explicit measurement date and snapshot notes separately from athlete profile notes', async () => {
  const h = harness({ presentation: 'drawer', measurementMetadata: true });
  assert.ok(h.all(h.render()).some(node => node.type === 'Drawer' && node.props.position === 'right'));
  h.enterMeasurements();
  const initialDate = h.field(editorUi.measuredAt); assert.ok(initialDate, 'measurement date input exists'); assert.match(initialDate.props.value, /^\d{4}-\d{2}-\d{2}$/);
  initialDate.props.onChange({ currentTarget: { value: '2026-10-17' } });
  h.field(editorUi.note).props.onChange({ currentTarget: { value: '  Комментарий снимка  ' } });
  h.confirm(); assert.ok(h.all(h.render()).some(node => node.type === 'Drawer'));
  await h.save();
  assert.equal(h.writes[0].path, '/clients/c1/athletes'); assert.equal(h.writes[0].body.notes, 'Профильный комментарий');
  assert.equal(h.writes[1].path, '/clients/c1/athletes/a1/measurements');
  assert.equal(h.writes[1].body.measuredAt, '2026-10-17T00:00:00.000Z'); assert.equal(h.writes[1].body.notes, 'Комментарий снимка');
  assert.equal(h.writes[1].body.m15, 110);
});
test('default consumers retain modal profile/confirmation and the legacy snapshot payload without profile-note leakage', async () => {
  const h = harness(); const profile = h.all(h.render()).find(node => node.type === 'Modal'); assert.equal(profile.props.centered, true);
  h.enterMeasurements(); assert.equal(h.field(editorUi.measuredAt), undefined); assert.equal(h.field(editorUi.note), undefined);
  h.confirm(); assert.ok(h.all(h.render()).some(node => node.type === 'Modal'));
  await h.save(); assert.equal(h.writes.length, 2); assert.equal(h.writes[0].body.notes, 'Профильный комментарий');
  assert.equal('notes' in h.writes[1].body, false); assert.ok(Number.isFinite(Date.parse(h.writes[1].body.measuredAt)));
});

test('metadata remains stable through back navigation and invalid dates cannot advance or issue requests', async () => {
  const h = harness({ measurementMetadata: true }); h.enterMeasurements();
  const today = h.field(editorUi.measuredAt).props.value;
  h.field(editorUi.note).props.onChange({ currentTarget: { value: 'Снимок' } });
  h.confirm();h.all(h.render()).find(node => node.type === 'Button' && node.props?.children === ui.back).props.onClick();
  assert.equal(h.field(editorUi.measuredAt).props.value, today);assert.equal(h.field(editorUi.note).props.value, 'Снимок');
  for (const invalid of ['', '2026-02-30']) {
    h.field(editorUi.measuredAt).props.onChange({ currentTarget: { value: invalid } });h.confirm();assert.ok(h.editor());assert.equal(h.writes.length, 0);
  }
});
test('failed snapshot retry retains the created athlete and the exact explicit snapshot date and notes', async () => {
  const writes=[];let snapshots=0;
  const h=harness({measurementMetadata:true,request:async(path,init)=>{writes.push({path,body:JSON.parse(init.body)});if(path.endsWith('/measurements')&&++snapshots===1)throw Error('response lost');return{id:'a1'};}});
  h.enterMeasurements();h.field(editorUi.measuredAt).props.onChange({currentTarget:{value:'2026-09-15'}});h.field(editorUi.note).props.onChange({currentTarget:{value:'Снимок'}});h.confirm();
  await h.save();await h.save();
  assert.equal(writes.filter(write=>write.path==='/clients/c1/athletes').length,1);
  assert.equal(writes.filter(write=>write.path.endsWith('/measurements')).length,2);
  assert.deepEqual(writes[1],writes[2]);assert.equal(writes[2].body.measuredAt,'2026-09-15T00:00:00.000Z');assert.equal(writes[2].body.notes,'Снимок');
});
