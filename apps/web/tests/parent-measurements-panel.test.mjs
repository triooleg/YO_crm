import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), ts = require('typescript');
function compile(path, imports = {}, globals = {}) {
  const mod = { exports: {} };
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  new Function('require', 'module', 'exports', ...Object.keys(globals), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)(name => imports[name] ?? require(name), mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const ui = () => compile('../lib/i18n.ts').parentMeasurementsStaffUi;
const submission = { id: 's1', childName: 'Анна', measuredAt: '2026-10-18', measurementId: 'm1', athleteId: 'a1', reviewStatus: 'RECEIVED', assignmentStatus: 'UNASSIGNED', definitionVersion: 'PARENT_BODY_V1', values: { m1: 60, m2: 50, m3: 65, m6: 40, m15: 110 }, warnings: [], updatedAt: 'submission-v1' };
const instance = { id: 'piece1', updatedAt: 'piece-v1', ordinal: 1, designName: 'Дизайн', productionStatus: 'SEWING' };
function harness(handler, extra = {}, qrHelper = compile('../lib/parent-measurements-qr.ts')) {
  const hooks = [], effects = [], requests = []; let cursor = 0, sequence = 0;
  const react = { ...require('react'),
    useState(initial) { const n = cursor++; if (!(n in hooks)) hooks[n] = typeof initial === 'function' ? initial() : initial; return [hooks[n], value => { hooks[n] = typeof value === 'function' ? value(hooks[n]) : value; }]; },
    useRef(initial) { const n = cursor++; return hooks[n] ??= { current: initial }; },
    useEffect(fn, deps) { const n = cursor++; if (!hooks[n] || deps.some((v, i) => v !== hooks[n][i])) { hooks[n] = deps; effects.push(fn); } },
  };
  const labels = ui();
  const mod = compile('../components/orders/parent-measurements-panel.tsx', { react, '../measurement-definition': compile('../components/measurement-definition.ts', { '../lib/i18n': compile('../lib/i18n.ts') }), '../../lib/i18n': { parentMeasurementsStaffUi: labels }, '../../lib/parent-measurements-qr': qrHelper }, {
    fetch: async (path, init) => { const request = { path, ...init, body: init?.body ? JSON.parse(init.body) : undefined }; requests.push(request); const result = await handler(request); return result?.httpStatus ? { ok: false, status: result.httpStatus } : { ok: true, status: 200, json: async () => result }; },
    crypto: { randomUUID: () => `operation-${++sequence}` }, navigator: { clipboard: { writeText: async () => {} } },
  });
  let props = { orderId: 'order1', instances: [instance], ...extra };
  function render() { cursor = 0; let node = mod.ParentMeasurementsPanel(props); if (typeof node.type === 'function') node = node.type(node.props); return node; }
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
  const find = label => all(render()).find(n => n.props?.children === label && n.props?.onClick);
  const field = label => all(render()).find(n => n.props?.label === label);
  async function settle() { for (const fn of effects.splice(0)) fn(); await new Promise(setImmediate); }
  async function click(label) { const button = find(label); assert.ok(button, `button: ${label}`); await button.props.onClick(); await settle(); }
  return { render, all, find, field, click, settle, requests, labels, setProps: value => { props = { ...props, ...value }; } };
}
const data = { invitations: [], submissions: [submission], expectedPieces: 1 };

test('creates a 14-day shared invitation; draft callback is explicit and optional', async () => {
  const drafts = [];
  const h = harness(async r => r.method === 'POST' ? { id: 'invite1', url: 'https://crm.example/parent-measurements#secret', expiresAt: '2026-11-02' } : data, { onDraftMessage: text => drafts.push(text) });
  h.render(); await h.settle(); await h.click(h.labels.create);
  assert.deepEqual(h.requests.find(r => r.method === 'POST').body, { mode: 'SHARED', days: 14 });
  assert.equal(drafts.length, 0);
  await h.click(h.labels.draftMessage); assert.equal(drafts.length, 1); assert.match(drafts[0], /#secret/);
  assert.ok(h.requests.every(r => !r.path.includes('messages')));
});

test('assignment requires explicit targets, production confirmation and reason; lost response retries frozen CAS payload', async () => {
  let writes = 0;
  const h = harness(async r => { if (r.method === 'POST') { if (++writes === 1) throw Error('response lost'); return { instances: [] }; } return data; });
  h.render(); await h.settle(); await h.click(h.labels.assign);
  await h.click(h.labels.saveAssignment); assert.equal(writes, 0);
  const target = h.all(h.render()).find(n => n.props?.label?.startsWith('Дизайн'));
  target.props.onChange({ currentTarget: { checked: true } });
  await h.click(h.labels.saveAssignment); assert.equal(writes, 0);
  h.field(h.labels.productionConfirm).props.onChange({ currentTarget: { checked: true } });
  h.field(h.labels.reason).props.onChange({ currentTarget: { value: 'Уточнён рукав' } });
  h.setProps({ instances: [{ ...instance, updatedAt: 'piece-v2' }] });
  await h.click(h.labels.saveAssignment);
  assert.equal(h.field(h.labels.reason).props.disabled, true);
  assert.equal(h.find(h.labels.cancel).props.disabled, true);
  await h.click(h.labels.retryAssignment);
  const requests = h.requests.filter(r => r.method === 'POST');
  assert.equal(requests.length, 2); assert.deepEqual(requests[0].body, requests[1].body);
  assert.deepEqual(requests[0].body, { targets: [{ id: 'piece1', expectedUpdatedAt: 'piece-v1' }], confirmProduction: true, reason: 'Уточнён рукав', operationKey: 'operation-1' });
});

test('clarification is a versioned review only, never an outbound message', async () => {
  const h = harness(async r => r.method === 'POST' ? submission : data);
  h.render(); await h.settle(); await h.click(h.labels.clarify);
  await h.click(h.labels.saveReview); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  h.field(h.labels.reason).props.onChange({ currentTarget: { value: 'Перепроверьте №15' } });
  await h.click(h.labels.saveReview);
  assert.deepEqual(h.requests.find(r => r.method === 'POST').body, { expectedUpdatedAt: 'submission-v1', status: 'NEEDS_CLARIFICATION', reason: 'Перепроверьте №15' });
  assert.ok(h.requests.every(r => !r.path.includes('messages')));
});

test('17 values preserve missing fields and raw m6; absent callbacks never claim delivery', async () => {
  const h = harness(async r => r.method === 'POST' ? { id: 'i', url: 'https://crm.example/#secret', expiresAt: '2026-11-02' } : data, { instances: undefined });
  h.render(); await h.settle();
  const rows = h.all(h.render()).filter(n => n.props?.children?.[0]?.props?.children?.[0] === '№');
  assert.equal(rows.length, 17);
  const text = JSON.stringify(h.render()); assert.ok(text.includes(h.labels.bodyM6)); assert.ok(text.includes(h.labels.absent));
  assert.equal(rows[5].props.children[1].props.children, 40);
  assert.equal(h.find(h.labels.assign).props.disabled, true);
  await h.click(h.labels.create);
  assert.equal(h.find(h.labels.draftMessage).props.disabled, true);
  await h.click(h.labels.draftMessage);
  assert.ok(!JSON.stringify(h.render()).includes(h.labels.draftInserted));
});

test('saved assignment with failed host refresh never repeats the mutation', async () => {
  const h = harness(async r => r.method === 'POST' ? { instances: [] } : data, { instances: [{ ...instance, productionStatus: 'SCHEDULED' }], onUpdated: async () => { throw Error('host read failed'); } });
  h.render(); await h.settle(); await h.click(h.labels.assign);
  h.all(h.render()).find(n => n.props?.label?.startsWith('Дизайн')).props.onChange({ currentTarget: { checked: true } });
  await h.click(h.labels.saveAssignment); await h.click(h.labels.refresh);
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
});

test('ready and cancelled pieces cannot be selected for assignment', async () => {
  const h = harness(async () => data, { instances: [{ ...instance, productionStatus: 'READY' }, { ...instance, id: 'piece2', productionStatus: 'CANCELLED' }] });
  h.render(); await h.settle(); assert.equal(h.find(h.labels.assign).props.disabled, true);
});

test('review conflict closes the stale editor and requires a fresh read before reopening', async () => {
  let currentData = data;
  const h = harness(async r => r.method === 'POST' ? { httpStatus: 409 } : currentData);
  h.render(); await h.settle(); await h.click(h.labels.verify); await h.click(h.labels.saveReview);
  assert.equal(h.find(h.labels.saveReview), undefined);
  assert.equal(h.find(h.labels.verify).props.disabled, true);
  currentData = { ...data, submissions: [{ ...submission, updatedAt: 'submission-v2' }] };
  await h.click(h.labels.refresh); await h.click(h.labels.verify); await h.click(h.labels.saveReview);
  assert.equal(h.requests.filter(r => r.method === 'POST').at(-1).body.expectedUpdatedAt, 'submission-v2');
});

test('existing athlete binding requires a pre-submit child, representative confirmation and a reason', async () => {
  const h = harness(async r => r.method === 'POST' ? { ok: true } : data, {
    children: [{ id: 'child1', revision: 3, childName: 'Анна', submitted: false }, { id: 'child2', revision: 4, childName: 'История', submitted: true }],
    athletes: [{ id: 'athlete-existing', displayName: 'Анна Иванова' }],
  });
  h.render(); await h.settle();
  assert.ok(!h.field(h.labels.bindChild).props.data.some(item => item.value === 'child2'));
  h.field(h.labels.bindChild).props.onChange('child1');
  h.field(h.labels.bindAthlete).props.onChange('athlete-existing');
  await h.click(h.labels.bind); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  h.field(h.labels.bindConfirmed).props.onChange({ currentTarget: { checked: true } });
  h.field(h.labels.bindReason).props.onChange({ currentTarget: { value: 'Представитель подтвердил профиль' } });
  await h.click(h.labels.bind);
  const write = h.requests.find(r => r.method === 'POST');
  assert.equal(write.path, '/api/orders/order1/parent-measurements/children/child1/bind');
  assert.deepEqual(write.body, { athleteId: 'athlete-existing', reason: 'Представитель подтвердил профиль', expectedRevision: 3, representativeVerified: true });
});

test('staff dashboard supplies binding options without any extra host props', async () => {
  const dashboard = { ...data, drafts: [{ id: 'draft1', revision: 7, firstName: 'Анна', athleteId: null }], athletes: [{ id: 'a-existing', firstName: 'Анна', lastName: 'Иванова' }] };
  const h = harness(async r => r.method === 'POST' ? { ok: true } : dashboard);
  h.render(); await h.settle(); await h.click(h.labels.bindingAction);
  assert.deepEqual(h.field(h.labels.bindAthlete).props.data, [{ value: 'a-existing', label: 'Анна Иванова' }]);
  h.field(h.labels.bindChild).props.onChange('draft1'); h.field(h.labels.bindAthlete).props.onChange('a-existing');
  h.field(h.labels.bindReason).props.onChange({ currentTarget: { value: 'Профиль подтверждён' } });
  h.field(h.labels.bindConfirmed).props.onChange({ currentTarget: { checked: true } });
  await h.click(h.labels.bind);
  assert.deepEqual(h.requests.find(r => r.method === 'POST').body, { athleteId: 'a-existing', reason: 'Профиль подтверждён', expectedRevision: 7, representativeVerified: true });
});

test('startedAt requires explicit production consent even if status is scheduled; completed pieces stay blocked', async () => {
  const h = harness(async () => data, { instances: [{ ...instance, productionStatus: 'SCHEDULED', startedAt: '2026-10-18' }, { ...instance, id: 'completed', completedAt: '2026-10-18' }] });
  h.render(); await h.settle(); await h.click(h.labels.assign);
  const targets = h.all(h.render()).filter(n => n.props?.label?.startsWith('Дизайн'));
  assert.equal(targets.length, 1); targets[0].props.onChange({ currentTarget: { checked: true } });
  await h.click(h.labels.saveAssignment); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  assert.ok(h.field(h.labels.productionConfirm));
});

test('a concurrent bind conflict closes the stale dialog until the dashboard is refreshed', async () => {
  const dashboard = { ...data, drafts: [{ id: 'draft1', revision: 7, firstName: 'Анна', athleteId: null }], athletes: [{ id: 'a-existing', firstName: 'Анна' }] };
  const h = harness(async r => r.method === 'POST' ? { httpStatus: 409 } : dashboard);
  h.render(); await h.settle(); await h.click(h.labels.bindingAction);
  h.field(h.labels.bindChild).props.onChange('draft1'); h.field(h.labels.bindAthlete).props.onChange('a-existing');
  h.field(h.labels.bindReason).props.onChange({ currentTarget: { value: 'Подтверждено' } });
  h.field(h.labels.bindConfirmed).props.onChange({ currentTarget: { checked: true } });
  await h.click(h.labels.bind);
  assert.equal(h.all(h.render()).find(n => n.props?.title === h.labels.binding).props.opened, false);
  assert.equal(h.find(h.labels.bindingAction).props.disabled, true);
});

test('personal invitation includes the chosen locale and preserves one-time URL only from creation', async () => {
  const h = harness(async r => r.method === 'POST' ? { id: 'invite1', url: 'https://crm.example/#secret', expiresAt: '2026-11-02' } : data);
  h.render(); await h.settle(); h.field(h.labels.mode).props.onChange('PERSONAL'); h.field(h.labels.locale).props.onChange('fr');
  await h.click(h.labels.create);
  assert.deepEqual(h.requests.find(r => r.method === 'POST').body, { mode: 'PERSONAL', days: 14, locale: 'fr' });
});

test('issued link opens a real local PNG QR preview without extra API requests', async () => {
  const h = harness(async r => r.method === 'POST' ? { id: 'i', url: 'https://crm.example/#private-token', expiresAt: '2026-11-02' } : data);
  h.render(); await h.settle(); await h.click(h.labels.create);
  const before = h.requests.length; await h.click(h.labels.qr);
  const modal = h.all(h.render()).find(n => n.props?.title === h.labels.qr);
  assert.equal(modal.props.opened, true);
  const image = h.all(h.render()).find(n => n.props?.alt === h.labels.qrAlt);
  assert.ok(image.props.src.startsWith('data:image/png;base64,'));
  assert.equal(h.requests.length, before);
  modal.props.onClose();
  assert.equal(h.all(h.render()).find(n => n.props?.alt === h.labels.qrAlt), undefined);
});

test('closing the QR modal discards late results', async () => {
  let finish;
  const h = harness(async r => r.method === 'POST' ? { id: 'i', url: 'https://crm.example/#private-token', expiresAt: '2026-11-02' } : data, {}, {
    measurementLinkQrDataUrl: () => new Promise(resolve => { finish = resolve; }),
  });
  h.render(); await h.settle(); await h.click(h.labels.create);
  const pending = h.find(h.labels.qr).props.onClick();
  h.all(h.render()).find(n => n.props?.title === h.labels.qr).props.onClose();
  finish('data:image/png;base64,late'); await pending;
  assert.equal(h.all(h.render()).find(n => n.props?.alt === h.labels.qrAlt), undefined);
  assert.equal(h.all(h.render()).find(n => n.props?.title === h.labels.qr).props.opened, false);
});

test('QR encoding failure offers a local retry without recreating the invitation', async () => {
  let attempts = 0;
  const h = harness(async r => r.method === 'POST' ? { id: 'i', url: 'https://crm.example/#private-token', expiresAt: '2026-11-02' } : data, {}, {
    measurementLinkQrDataUrl: async () => { if (++attempts === 1) throw Error('encoding failed'); return 'data:image/png;base64,retry'; },
  });
  h.render(); await h.settle(); await h.click(h.labels.create); await h.click(h.labels.qr);
  assert.ok(h.all(h.render()).some(n => n.props?.children === h.labels.qrError));
  await h.click(h.labels.qrRetry);
  assert.ok(h.all(h.render()).some(n => n.props?.src === 'data:image/png;base64,retry'));
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
});

test('compact summary exposes four basic values and explicitly expands all 17 without losing issued links', async () => {
  const h = harness(async r => r.method === 'POST' ? { id: 'i', url: 'https://crm.example/#one-time', expiresAt: '2026-11-02' } : data, { compact: true });
  h.render(); await h.settle();
  const rows = () => h.all(h.render()).filter(n => n.type === require('@mantine/core').Table.Tr && n.props?.children?.[0]?.props?.children?.[0] === '№');
  assert.equal(rows().length, 0, 'full measurement table is initially collapsed');
  const summary = h.all(h.render()).find(n => n.props?.className === 'orders-parent-measurements-basics');
  assert.ok(summary, 'four basic measurements are visible in the summary');
  assert.equal(summary.props.children.length, 4);
  await h.click(h.labels.allParameters);
  assert.equal(rows().length, 17);
  assert.equal(rows()[5].props.children[1].props.children, 40, 'm6 stays pure body and read-only');
  await h.click(h.labels.hideParameters);
  assert.equal(rows().length, 0);
  const management = () => h.all(h.render()).find(n => n.props?.title === h.labels.manage);
  assert.equal(management().props.opened, false);
  await h.click(h.labels.manage); await h.click(h.labels.create);
  management().props.onClose();
  assert.equal(management().props.opened, false);
  await h.click(h.labels.manage);
  assert.equal(h.field(h.labels.link).props.value, 'https://crm.example/#one-time');
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
});

test('compact dialog can close during invitation creation and retains the late one-time result', async () => {
  let finish;
  const h = harness(async r => r.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : data, { compact: true });
  h.render(); await h.settle(); await h.click(h.labels.manage);
  const pending = h.find(h.labels.create).props.onClick();
  const management = () => h.all(h.render()).find(n => n.props?.title === h.labels.manage);
  management().props.onClose();
  finish({ id: 'late', url: 'https://crm.example/#late-result', expiresAt: '2026-11-02' });
  await pending; await h.settle(); await h.click(h.labels.manage);
  assert.equal(h.field(h.labels.link).props.value, 'https://crm.example/#late-result');
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
});

test('compact collapse and management close preserve the uncertain assignment and exact retry command', async () => {
  let writes = 0;
  const h = harness(async r => { if (r.method === 'POST') { if (++writes === 1) throw Error('response lost'); return { instances: [] }; } return data; }, { compact: true });
  h.render(); await h.settle(); await h.click(h.labels.allParameters); await h.click(h.labels.assign);
  h.all(h.render()).find(n => n.props?.label?.startsWith('Дизайн')).props.onChange({ currentTarget: { checked: true } });
  h.field(h.labels.productionConfirm).props.onChange({ currentTarget: { checked: true } });
  h.field(h.labels.reason).props.onChange({ currentTarget: { value: 'Согласовано' } });
  await h.click(h.labels.saveAssignment); await h.click(h.labels.hideParameters);
  await h.click(h.labels.manage);
  h.all(h.render()).find(n => n.props?.title === h.labels.manage).props.onClose();
  h.setProps({ instances: [{ ...instance, updatedAt: 'new-version' }] });
  assert.equal(h.field(h.labels.reason).props.value, 'Согласовано');
  await h.click(h.labels.retryAssignment);
  const writesMade = h.requests.filter(r => r.method === 'POST');
  assert.equal(writesMade.length, 2);
  assert.deepEqual(writesMade[0].body, writesMade[1].body);
  assert.equal(writesMade[1].body.targets[0].expectedUpdatedAt, 'piece-v1');
});
