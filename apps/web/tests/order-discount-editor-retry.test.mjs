import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseDiscountValue } from '../lib/order-discount-input.mjs';
const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('../components/orders/order-discount-editor.tsx', import.meta.url), 'utf8');
const labels = { preview: 'Preview', save: 'Save', cancel: 'Cancel', value: 'Value' };
function harness(refreshFailure) {
  const hooks = []; let cursor = 0, closed = 0, refreshes = 0; const requests = [];
  const react = { ...require('react'), useState(initial) { const n = cursor++; if (!(n in hooks)) hooks[n] = initial; return [hooks[n], value => { hooks[n] = typeof value === 'function' ? value(hooks[n]) : value; }]; }, useRef(initial) { const n = cursor++; return hooks[n] ??= { current: initial }; } };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'crypto', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => name === 'react' ? react : name === '../../lib/i18n' ? { orderDiscountUi: labels } : name === '../../lib/finance-report' ? { moneyLabel: String } : name === '../../lib/order-discount-input.mjs' ? { parseDiscountValue } : require(name), mod, mod.exports, { randomUUID: () => 'same-discount-operation-key' });
  const bridge = { request: async (path, init) => {
    requests.push({ path, body: JSON.parse(init.body) });
    if (path.endsWith('/preview')) return { token: 'frozen', currency: 'EUR', baseMinor: 10000, discountMinor: 1000, before: { totalMinor: 10000 }, after: { totalMinor: 9000, balanceMinor: 9000 }, blockers: [], warnings: [] };
    if (!refreshFailure && requests.filter(x => x.path.endsWith('/apply')).length === 1) throw Error('acknowledgement lost');
    return { operationId: 'op' };
  }, onSaved: async () => { refreshes++; if (refreshFailure && refreshes === 1) throw Error('read failed'); } };
  function render() { cursor = 0; return mod.exports.OrderDiscountEditor({ orderId: 'o', discountMinor: 1000, currency: 'EUR', bridge, onClose: () => closed++ }); }
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
  const button = text => all(render()).find(node => node.props?.children === text && typeof node.props?.onClick === 'function');
  async function click(text) { await button(text).props.onClick(); await new Promise(setImmediate); }
  return { click, requests, render, all, get closed() { return closed; }, get refreshes() { return refreshes; } };
}
test('acknowledged discount with failed refresh retries reads without another write', async () => {
  const h = harness(true); await h.click('Preview'); await h.click('Save');
  assert.equal(h.closed, 0); await h.click('Save');
  assert.equal(h.requests.filter(x => x.path.endsWith('/apply')).length, 1);
  assert.equal(h.refreshes, 2); assert.equal(h.closed, 1);
});
test('unknown discount result freezes inputs and reuses original command/token/key', async () => {
  const h = harness(false); await h.click('Preview'); await h.click('Save');
  assert.equal(h.all(h.render()).find(node => node.props?.label === 'Value').props.disabled, true);
  await h.click('Save');
  const writes = h.requests.filter(x => x.path.endsWith('/apply'));
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(h.requests.filter(x => x.path.endsWith('/preview')).length, 1);
  assert.equal(h.closed, 1);
});
