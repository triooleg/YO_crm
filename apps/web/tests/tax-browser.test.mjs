import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

test('tax panels: real Mantine browser, isolated synthetic API, desktop/mobile and commands', { skip: process.env.YO_TAX_BROWSER !== '1', timeout: 180_000 }, async t => {
  const require = createRequire(import.meta.url), ts = require('typescript'), { chromium, expect } = require('@playwright/test');
  const web = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(web, '../..'), artifacts = resolve(root, '.local/tax-frontend-browser');
  await mkdir(artifacts, { recursive: true });
  const files = ['shared', 'tax-settings-panel', 'tax-finance-panel', 'tax-order-panel', 'tax-operations', 'entry-groups'];
  for (const name of files) {
    let compiled = ts.transpileModule(await readFile(resolve(web, 'components/taxes', name + (name === 'entry-groups' ? '.ts' : '.tsx')), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    compiled = compiled.replaceAll('../../lib/i18n', './i18n.mjs').replaceAll('../../lib/tax-accounting', './tax-accounting.mjs');
    for (const n of files) compiled = compiled.replaceAll(`'./${n}'`, `'./${n}.mjs'`);
    await writeFile(resolve(artifacts, name + '.mjs'), compiled);
  }
  for (const [name, source] of [['i18n', 'lib/i18n.ts'], ['tax-accounting', 'lib/tax-accounting.ts'], ['theme', 'lib/mantine-theme.ts']]) await writeFile(resolve(artifacts, name + '.mjs'), ts.transpileModule(await readFile(resolve(web, source), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll("'./i18n'", "'./i18n.mjs'"));
  await writeFile(resolve(artifacts, 'entry.mjs'), `import {createElement as h,useState} from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider} from '@mantine/core';import {yoleotardTheme} from './theme.mjs';import {TaxSettingsPanel} from './tax-settings-panel.mjs';import {TaxFinancePanel} from './tax-finance-panel.mjs';import {TaxOrderPanel} from './tax-order-panel.mjs';const q=new URLSearchParams(location.search),role=q.get('role')||'OWNER',view=q.get('view')||'finance';function App(){const[epoch,setEpoch]=useState(0),[orderId,setOrderId]=useState('synthetic-order'),[actor,setActor]=useState(role);window.taxTestRefresh=()=>setEpoch(x=>x+1);window.taxTestOrder=setOrderId;window.taxTestRole=setActor;return view==='settings'?h(TaxSettingsPanel,{role:actor}):view==='order'?h(TaxOrderPanel,{role:actor,orderId,refreshKey:epoch}):h(TaxFinancePanel,{role:actor,month:'2026-05',refreshKey:epoch,onSaved:()=>{window.cashRefreshes=(window.cashRefreshes||0)+1},onNavigate:(section,context)=>{window.navigation={section,context}}});}createRoot(document.getElementById('app')).render(h(MantineProvider,{theme:yoleotardTheme},h(App)));`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((accept, reject) => webpack({ mode: 'development', devtool: false, entry: resolve(artifacts, 'entry.mjs'), output: { path: artifacts, filename: 'bundle.js' }, resolve: { modules: [resolve(web, 'node_modules'), 'node_modules'] } }, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString({ all: false, errors: true }))) : accept()));
  const layout = await readFile(resolve(web, 'app/layout.tsx'), 'utf8');
  const styles = [...layout.matchAll(/import ["'](\.\/[^"']+\.css)["'];/g)].map(match => resolve(web, 'app', match[1]));
  const css = Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')), ...await Promise.all(styles.map(path => readFile(path)))]);
  const calls = [], errors = [], blocked = [];
  const totals = { accruedMinor: 60000, paidMinor: 50000, allocatedMinor: 40000, debtMinor: 20000, creditMinor: 10000 };
  const policy = { id: 'synthetic-policy', effectiveFrom: '2026-05-01', group: 3, unifiedMode: 'PERCENT', unifiedRateBps: 500, fixedUnifiedMinor: null, militaryRateBps: 100, esvRateBps: 2200, state: 'ACTIVE', snapshot: {}, createdAt: '2026-05-01' };
  const settings = { enabled: true, revision: 7, accountingStartDate: '2026-05-01', timezone: 'Europe/Kyiv', policies: [policy], currentPolicy: policy, futurePolicies: [], wageCatalog: [{ version: 'UA-MIN-WAGE-2026-v1', minor: 864700, from: '2026-01-01', to: '2027-01-01', source: 'https://tax.gov.ua/media-tsentr/novini/999526.html', verifiedAt: '2026-10-19' }] };
  const entry = { id: 'synthetic-root', rootId: null, periodId: 'synthetic-period', policyId: policy.id, originalPeriodId: null, paymentId: 'synthetic-payment', orderId: 'synthetic-order', component: 'UNIFIED', kind: 'FINALIZE', amountMinor: 60000, baseMinor: 1200000, snapshot: { grossMinor: 10000, originalPayment: { amountMinor: 10000, currency: 'EUR', receivedAt: '2026-05-01T12:00:00Z' }, incomeDate: '2026-05-01', rate: { numerator: '120', denominator: '1', incomeDate: '2026-05-01', effectiveDate: '2026-05-01', url: 'https://bank.gov.ua/', raw: 'PRIVATE_RAW_NBU_FIXTURE' } }, operationKey: 'fixture', sourceKey: 'fixture', createdAt: '2026-05-01' };
  const period = { id: 'synthetic-period', month: '2026-05', policyId: policy.id, state: 'OPEN', revision: 3, snapshot: {}, closedAt: null, closedSnapshot: null };
  const link = { id: 'synthetic-link', expenseId: 'synthetic-expense', linkId: null, rootId: null, reversesId: null, component: 'UNIFIED', kind: 'PAYMENT_LINK', amountMinor: 50000, incurredAt: '2026-05-01T12:00:00Z', snapshot: {}, operationKey: 'fixture', createdAt: '2026-05-01' };
  let incomplete = true, failReport = false, failSettings = false, failMutation = false, dropMutation = false, dropped = false, delayMay = false, groupedLifecycle = false, missingResultFx = false, initialSettings = false, orderComplete = false, slowOrder = false;
  const lifecycle = [
    { ...entry, id: 'lifecycle-root', kind: 'ROOT', amountMinor: null, baseMinor: null },
    { ...entry, id: 'lifecycle-source', rootId: 'lifecycle-root', kind: 'SOURCE', amountMinor: null, baseMinor: null },
    { ...entry, id: 'lifecycle-final', rootId: 'lifecycle-root', snapshot: { ...entry.snapshot, sourceId: 'lifecycle-source', receiptConfirmed: false } },
    { ...entry, id: 'lifecycle-confirm', rootId: 'lifecycle-root', kind: 'ADJUST', amountMinor: 0, snapshot: { ...entry.snapshot, sourceId: 'lifecycle-source', receiptConfirmed: true, evidence: 'Сверено с банковской выпиской' } },
    { ...entry, id: 'lifecycle-draft', rootId: 'lifecycle-root', kind: 'DRAFT', amountMinor: 99999, baseMinor: null, snapshot: { reason: 'Непроведённый черновик' } },
  ];
  let lifecycleRows = lifecycle;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
      calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: req.method, body });
      const send = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (url.pathname === '/api/finance/report') return send({ options: { categories: [{ id: 'synthetic-category', name: 'Налоги ФОП', active: true }] }, table: { rows: [{ id: 'synthetic-existing-expense', date: '2026-05-02', categoryName: 'Налоги ФОП', notes: 'Синтетическая уплата', originalAmountMinor: 50000, originalCurrency: 'UAH', orderId: null, shipmentId: null }, { id: 'synthetic-retry', date: '2026-05-03', categoryName: 'Налоги ФОП', notes: 'Синтетический повтор', originalAmountMinor: 50000, originalCurrency: 'UAH', orderId: null, shipmentId: null }] } });
      if (url.pathname === '/api/finance/taxes/settings' && req.method === 'GET') return send(initialSettings ? { ...settings, policies: [], currentPolicy: null } : settings, failSettings ? 500 : 200);
      if (url.pathname === '/api/finance/taxes/report') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if (delayMay && from === '2026-05') await new Promise(resolve => setTimeout(resolve, 350));
        return send({ currency: 'UAH', accountingStartDate: '2026-05-01', from, to, incomplete, pendingCount: incomplete ? 1 : 0, totals, results: { currency: 'UAH', timezone: 'Europe/Kyiv', receivedMinor: missingResultFx ? null : 100000, nonTaxExpensesMinor: missingResultFx ? null : 150000, taxCashExpensesMinor: 50000, cashResultMinor: missingResultFx ? null : -100000, resultAfterAccrualMinor: missingResultFx || incomplete ? null : -110000, incomplete: missingResultFx || incomplete, missingRates: missingResultFx ? [{ currency: 'EUR', incomeDate: '2026-05-01' }] : [], fxEvidence: [] }, settlementOptions: [link, { ...link, id: 'historical-link', expenseId: 'historical-expense', amountMinor: 25000, incurredAt: '2026-02-01T12:00:00Z' }], components: { UNIFIED: totals, MILITARY: { accruedMinor: 0, paidMinor: 0, allocatedMinor: 0, debtMinor: 0, creditMinor: 0 }, ESV: { accruedMinor: 0, paidMinor: 0, allocatedMinor: 0, debtMinor: 0, creditMinor: 0 } }, periods: [period, { ...period, id: 'closed-period', month: '2026-04', state: 'CLOSED', closedAt: '2026-05-01', closedSnapshot: { totals } }], entries: [entry, { ...entry, id: 'pending', kind: 'ROOT', amountMinor: null, baseMinor: null }, { ...lifecycle[0], id: 'closed-root', periodId: 'closed-period', snapshot: { ...entry.snapshot, incomeDate: '2026-04-01' } }], settlements: [link, { ...link, id: 'synthetic-allocation', kind: 'ALLOCATE', rootId: entry.id, linkId: link.id, amountMinor: 40000 }], subsequentCorrections: [{ ...entry, id: 'subsequent', kind: 'ADJUST', amountMinor: -100 }] }, failReport ? 500 : 200);
      }
      if (url.pathname.startsWith('/api/finance/taxes/orders/') && req.method === 'GET') { if (slowOrder) await new Promise(resolve => setTimeout(resolve, 350)); return send({ orderId: url.pathname.split('/').at(-1), incomplete: groupedLifecycle ? false : !orderComplete, entries: (groupedLifecycle ? lifecycleRows : orderComplete ? lifecycle.slice(0, 4) : [entry]).map(e => ({ ...e, orderId: url.pathname.split('/').at(-1) })) }); }
      if (url.pathname === '/api/finance/taxes/policies/preview') return send({previewRevision:settings.revision,fieldSignature:JSON.stringify(body),affectedPeriods:[],publicationBlocked:false,reasons:[]});
      if (url.pathname === '/api/finance/taxes/backfill/preview') return send({ token: 'synthetic-preview-token', count: 1, unreconciledCount: 1, payments: [{ id: entry.paymentId, orderId: entry.orderId, amountMinor: 10000, currency: 'EUR', receivedAt: '2026-05-01', missingRate: true }], currencyTotals: { EUR: 10000 }, pendingRates: ['2026-05-01:EUR'] });
      if (req.method === 'POST' && url.pathname.startsWith('/api/finance/taxes/')) {
        if (failMutation) return send({ message: 'raw backend details never displayed' }, 409);
        return send({ ...settings, id: 'synthetic-result' });
      }
      blocked.push(url.pathname); return send({}, 501);
    }
    if (url.pathname === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(await readFile(resolve(artifacts, 'bundle.js'))); }
    if (url.pathname === '/styles.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(css); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Синтетическая проверка налогов</title><body style="margin:0;padding:12px"><main id="app"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); await writeFile(resolve(artifacts, 'evidence.json'), JSON.stringify({ provenance: 'Actual React/Mantine components bundled from worktree; synthetic loopback API only. Not backend/database/production proof.', calls, errors, blocked }, null, 2)); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : (blocked.push(route.request().url()), route.abort()));
  await context.route('**/api/finance/taxes/settlements', route => {
    if (dropMutation && !dropped) { dropped = true; calls.push({ path: '/api/finance/taxes/settlements', method: 'POST', body: route.request().postDataJSON(), syntheticTransportFailure: true }); return route.abort('failed'); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
  const go = async (view = 'finance', role = 'OWNER') => { await page.goto(`${base}/?view=${view}&role=${role}`); if(role!=='MANAGER'&&view==='order')await openAccordion('Начисления по фактическим поступлениям');if(role==='OWNER'&&view==='settings'){await page.getByRole('tab',{name:'Управление',exact:true}).click();await openAccordion('Обновить налоги');} };
  const fieldset = title => page.getByRole('group', { name: title, exact: true });
  const select = async (scope, label, value) => { const input = scope.getByRole('textbox', { name: label, exact: true }).or(scope.getByRole('combobox', { name: label, exact: true })).first(); const current = await input.inputValue(); if (typeof value === 'string' ? current === value : value.test(current)) return; await input.click(); await page.getByRole('option', { name: value, exact: true }).click(); };
  const confirm = async scope => scope.getByRole('checkbox', { name: 'Подтверждаю изменение', exact: true }).check();
  const openAccordion = async name => { const control = page.getByRole('button', { name, exact: true }).and(page.locator('[data-accordion-control]')); if (await control.getAttribute('aria-expanded') !== 'true') await control.click(); };
  await t.test('forbidden roles never fetch any tax information', async () => { for (const view of ['finance', 'order', 'settings']) { const before = calls.length; await go(view, 'MANAGER'); await page.waitForTimeout(80); assert.equal(calls.length, before); assert.equal(await page.getByRole('heading').count(), 0); } });
  await t.test('R1 parent refresh and visible-only pending poll preserve same-scope data; new scope clears it', async () => {
    const refreshContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await refreshContext.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : (blocked.push(route.request().url()), route.abort()));
    const refreshPage = await refreshContext.newPage();
    refreshPage.on('pageerror', error => errors.push(error.message));
    refreshPage.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
    await refreshPage.clock.install({ time: new Date('2026-10-19T10:00:00Z') });
    await refreshPage.addInitScript(() => { window.taxTestHidden = false; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.taxTestHidden ? 'hidden' : 'visible' }); });
    const orders = () => calls.filter(c => c.path.includes('/taxes/orders/')).length, reports = () => calls.filter(c => c.path === '/api/finance/taxes/report').length;
    try {
      await refreshPage.goto(base + '/?view=order'); await refreshPage.getByRole('button',{name:'Начисления по фактическим поступлениям',exact:true}).click(); await expect(refreshPage.locator('[data-tax-root-summary]')).toHaveCount(1);
      let before = orders(); slowOrder = true; await refreshPage.evaluate(() => window.taxTestRefresh()); await expect.poll(orders).toBe(before + 1); await expect(refreshPage.locator('[data-tax-root-summary]')).toHaveCount(1); await expect(refreshPage.getByRole('status').filter({ hasText: 'Загрузка налогов' })).toBeVisible(); slowOrder = false;
      await expect(refreshPage.getByRole('status').filter({ hasText: 'Загрузка налогов' })).toHaveCount(0);
      before = orders(); await refreshPage.clock.runFor(60_000); await expect.poll(orders).toBe(before + 1);
      await refreshPage.evaluate(() => { window.taxTestHidden = true; document.dispatchEvent(new Event('visibilitychange')); }); before = orders(); await refreshPage.clock.runFor(180_000); assert.equal(orders(), before);
      await refreshPage.evaluate(() => { window.taxTestHidden = false; document.dispatchEvent(new Event('visibilitychange')); }); orderComplete = true; await refreshPage.clock.runFor(60_000); await expect.poll(orders).toBe(before + 1); await expect(refreshPage.getByRole('alert').filter({ hasText: 'Неполный отчёт' })).toHaveCount(0); await expect(refreshPage.locator('[data-tax-root-summary]')).toContainText('Подтверждено'); before = orders(); await refreshPage.clock.runFor(180_000); assert.equal(orders(), before);
      slowOrder = true; await refreshPage.evaluate(() => window.taxTestOrder('different-order')); await refreshPage.getByRole('button',{name:'Начисления по фактическим поступлениям',exact:true}).click(); await expect(refreshPage.locator('[data-tax-root-summary]')).toHaveCount(0); slowOrder = false; await expect(refreshPage.getByRole('link', { name: 'different-order', exact: true })).toBeVisible();
      before = orders(); await refreshPage.evaluate(() => window.taxTestRole('MANAGER')); await expect(refreshPage.getByRole('heading')).toHaveCount(0); await refreshPage.clock.runFor(120_000); assert.equal(orders(), before);
      await refreshPage.goto(base + '/?view=finance'); await expect(refreshPage.getByText('Кредит / переплата', { exact: true }).first()).toBeVisible(); before = reports(); await refreshPage.evaluate(() => window.taxTestRefresh()); await expect.poll(reports).toBe(before + 1); await expect(refreshPage.getByText('Кредит / переплата', { exact: true }).first()).toBeVisible(); await expect(refreshPage.getByRole('status').filter({ hasText: 'Загрузка налогов' })).toHaveCount(0);
      before = reports(); incomplete = false; await refreshPage.clock.runFor(60_000); await expect.poll(reports).toBe(before + 1); await expect(refreshPage.getByRole('status').filter({ hasText: 'Неполный отчёт' })).toHaveCount(0); before = reports(); await refreshPage.clock.runFor(180_000); assert.equal(reports(), before);
    } finally { await refreshContext.close(); orderComplete = false; slowOrder = false; incomplete = true; }
  });
  await t.test('final API: signed cash versus accrual result, missing FX, historical settlement options, closed-source posting', async () => {
    incomplete = false;
    const loadFinance = async (role = 'OWNER') => {
      const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/finance/taxes/report' && response.request().method() === 'GET');
      await go('finance', role);
      const body = await (await response).json();
      await expect(page.locator('[data-tax-result="cashResultMinor"]')).toBeVisible();
      return body;
    };
    try {
      await loadFinance();
      await expect(page.locator('[data-tax-result="cashResultMinor"]')).toContainText(/-1\s000,00/);
      await expect(page.locator('[data-tax-result="resultAfterAccrualMinor"]')).toContainText(/-1\s100,00/);
      assert.equal(await page.getByText('2026-02-01', { exact: true }).count(), 0);
      await openAccordion('Уплаты и распределения');
      const allocation = fieldset('Распределить уплату'); await select(allocation, 'Связанная уплата', /250,00.*2026-02-01/); await allocation.getByLabel('Начисление').click(); await page.getByRole('option').first().click(); await allocation.getByLabel('Сумма, UAH').fill('1'); await confirm(allocation); await allocation.getByRole('button', { name: 'Распределить', exact: true }).click(); await expect.poll(() => calls.findLast(c => c.path.endsWith('/allocations'))?.body.linkId).toBe('historical-link');
      await openAccordion('Подтвердить сумму до комиссии и дату');
      const form = fieldset('Подтвердить сумму до комиссии и дату'); await select(form, 'Начисление', /2026-04-01/); await form.getByLabel('Полная сумма поступления, исходная валюта').fill('100'); await form.getByLabel('Дата дохода').fill('2026-04-01'); await form.getByLabel('Основание / документ').fill('Синтетическая банковская сверка'); await form.getByLabel('Открытый месяц отражения').fill('2026-05'); await confirm(form); await form.getByRole('button', { name: 'Подтвердить сумму до комиссии и дату', exact: true }).click(); await expect.poll(() => calls.findLast(c => c.path.includes('/sources/'))?.body.postingPeriod).toBe('2026-05');
      missingResultFx = true; const missing = await loadFinance(); assert.equal(missing.results.cashResultMinor, null); assert.equal(missing.results.resultAfterAccrualMinor, null); await expect(page.locator('[data-tax-result="cashResultMinor"]')).toContainText('—'); await expect(page.locator('[data-tax-result="resultAfterAccrualMinor"]')).toContainText('—'); await expect(page.getByText('EUR · 2026-05-01', { exact: true })).toBeVisible();
      missingResultFx = false; incomplete = true; const pending = await loadFinance(); assert.equal(pending.results.cashResultMinor, -100000); assert.equal(pending.results.resultAfterAccrualMinor, null); await expect(page.locator('[data-tax-result="cashResultMinor"]')).toContainText(/-1\s000,00/); await expect(page.locator('[data-tax-result="resultAfterAccrualMinor"]')).toContainText('—');
      await loadFinance('ACCOUNTANT'); await openAccordion('Подтвердить сумму до комиссии и дату');
      const sourceForm = fieldset('Подтвердить сумму до комиссии и дату');
      await expect(sourceForm.getByLabel('Открытый месяц отражения')).toHaveCount(0);
      await sourceForm.getByLabel('Начисление').click();
      await expect(page.getByRole('option').filter({ hasText: '2026-04-01' })).toHaveCount(0);
    } finally { incomplete = true; missingResultFx = false; }
  });
  await t.test('initial policy stays exact while future rate changes require official evidence', async () => {
    initialSettings = true;
    try {
      await go('settings'); await expect(page.getByLabel('Действует с')).toHaveValue('2026-05-01'); await expect(page.getByRole('combobox', { name: 'Группа ФОП', exact: true })).toBeDisabled(); await expect(page.getByRole('combobox', { name: 'Единый налог', exact: true })).toBeDisabled(); await expect(page.getByLabel('Единый налог, %')).toHaveJSProperty('readOnly', true); await expect(page.getByLabel('ЕСВ, %')).toHaveJSProperty('readOnly', true);
      await page.getByRole('button',{name:'Предпросмотр влияния политики',exact:true}).click(); await page.getByRole('checkbox', { name: 'Подтверждаю дату действия новой версии: 2026-05-01' }).check(); await page.getByRole('button', { name: 'Сохранить версию', exact: true }).click(); await expect.poll(() => calls.findLast(c => c.path.endsWith('/policies'))?.body.effectiveFrom).toBe('2026-05-01'); const first = calls.findLast(c => c.path.endsWith('/policies')).body; assert.equal(first.group, 3); assert.equal(first.unifiedMode, 'PERCENT'); assert.equal(first.unifiedRateBps, 500); assert.equal(first.militaryRateBps, 100); assert.equal(first.esvRateBps, 2200); assert.equal(first.fixedUnifiedMinor, null);
      initialSettings = false; await go('settings'); await page.getByLabel('Действует с').fill('2027-01-01'); await page.getByLabel('Единый налог, %').fill('5,5'); await page.getByLabel('Военный сбор, %').fill('2'); await page.getByLabel('ЕСВ, %').fill('23'); const writes = calls.filter(c => c.path.endsWith('/policies')).length; await page.getByRole('button',{name:'Предпросмотр влияния политики',exact:true}).click(); await expect(page.getByRole('alert')).toContainText('Проверьте даты'); assert.equal(calls.filter(c => c.path.endsWith('/policies')).length, writes);
      await page.getByLabel('Основание перехода / изменения ставок').fill('Синтетическое официальное основание будущей версии'); await page.getByRole('button',{name:'Предпросмотр влияния политики',exact:true}).click(); await page.getByRole('checkbox', { name: 'Подтверждаю дату действия новой версии: 2027-01-01' }).check(); await page.getByRole('button', { name: 'Сохранить версию', exact: true }).click(); await expect.poll(() => calls.findLast(c => c.path.endsWith('/policies'))?.body.unifiedRateBps).toBe(550); const future = calls.findLast(c => c.path.endsWith('/policies')).body; assert.equal(future.militaryRateBps, 200); assert.equal(future.esvRateBps, 2300); assert.ok(future.transitionEvidence); assert.equal(future.unifiedMode, 'PERCENT'); assert.equal(future.fixedUnifiedMinor, null);
    } finally { initialSettings = false; }
  });
  await t.test('one confirmed net liability per root, zero confirmation and draft do not duplicate or zero the tax', async () => {
    groupedLifecycle = true;
    try {
      await go('order');
      await expect(page.getByRole('heading', { name: 'Налоги с поступлений' })).toBeVisible();
      await expect(page.locator('[data-tax-root-summary]')).toHaveCount(1);
      const summary = page.locator('[data-tax-root-summary]');
      await expect(summary).toContainText(/600,00/); await expect(summary).toContainText('Подтверждено');
      await expect(summary).not.toContainText('999,99'); await expect(summary).not.toContainText('Ожидает расчёта');
      await summary.getByText('История событий', { exact: false }).click();
      await expect(page.locator('[data-tax-history-event]')).toHaveCount(5);
      await expect(page.locator('[data-tax-history-event]').filter({ hasText: 'Черновик' })).toContainText(/999,99/);
      await expect(page.locator('[data-tax-history-event]').filter({ hasText: 'Корректировка' })).toContainText(/0,00/);
      await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: resolve(artifacts, 'grouped-history-390.png'), fullPage: true });
      lifecycleRows = [...lifecycle, { ...lifecycle[1], id: 'new-void-source', snapshot: { state: { voidedAt: '2026-05-02' } } }];
      await go('order'); await expect(page.locator('[data-tax-root-summary]')).toHaveCount(1); await expect(page.locator('[data-tax-root-summary]')).toContainText(/600,00/); await expect(page.locator('[data-tax-root-summary]')).toContainText('Ожидает расчёта / сверки');
      lifecycleRows = Array.from({ length: 12 }, (_, index) => lifecycle.map(event => ({ ...event, id: `${index}-${event.id}`, rootId: event.kind === 'ROOT' ? null : `${index}-lifecycle-root`, snapshot: { ...event.snapshot, ...(event.snapshot.sourceId ? { sourceId: `${index}-lifecycle-source` } : {}) } }))).flat();
      await go('order'); await expect(page.locator('[data-tax-root-summary]')).toHaveCount(10); await page.locator('[aria-label="Страницы источников"] button').filter({ hasText: /^2$/ }).click(); await expect(page.locator('[data-tax-root-summary]')).toHaveCount(2); await page.locator('[data-tax-root-summary]').first().getByRole('button', { name: 'История событий (5)', exact: true }).click(); await expect(page.locator('[data-tax-history-event]')).toHaveCount(5);
      const beforeRefresh = calls.filter(c => c.path.includes('/taxes/orders/')).length; await page.evaluate(() => window.taxTestRefresh()); await expect.poll(() => calls.filter(c => c.path.includes('/taxes/orders/')).length).toBe(beforeRefresh + 1); await expect(page.getByRole('status').filter({ hasText: 'Загрузка налогов' })).toHaveCount(0); await expect(page.locator('[data-tax-root-summary]')).toHaveCount(2); await expect(page.locator('[data-tax-history-event]')).toHaveCount(5);
      await select(page, 'Источников на странице', '25'); await expect(page.locator('[data-tax-root-summary]')).toHaveCount(12);
      lifecycleRows = [...lifecycle, ...Array.from({ length: 24 }, (_, index) => ({ ...lifecycle[4], id: 'extra-draft-' + index }))];
      await go('order'); await expect(page.locator('[data-tax-root-summary]')).toHaveCount(1); await page.getByRole('button', { name: 'История событий (29)', exact: true }).click(); await expect(page.locator('[data-tax-history-event]')).toHaveCount(10); await page.locator('[aria-label="Страницы истории событий"] button').filter({ hasText: /^3$/ }).click(); await expect(page.locator('[data-tax-history-event]')).toHaveCount(9);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    } finally { groupedLifecycle = false; lifecycleRows = lifecycle; }
  });
  await t.test('UAH metrics, source currency, incompleteness, CSV, navigation, closed snapshot and responsive overflow', async () => {
    await go(); await expect(page.getByText('Кредит / переплата', { exact: true }).first()).toBeVisible(); await expect(page.getByRole('status').filter({ hasText: 'Неполный отчёт' })).toBeVisible();
    await expect(page.getByRole('cell').filter({ hasText: /100,00\s*€/ }).first()).toBeVisible();
    const closedSnapshot = page.getByText('Снимок на закрытие: 2026-05-01', { exact: true }).locator('..'); await closedSnapshot.getByText('Основания', { exact: true }).click(); await expect(closedSnapshot).toContainText(/Начислено: 600,00/); await expect(closedSnapshot).toContainText(/Уплачено: 500,00/); await closedSnapshot.getByText('Основания', { exact: true }).click();
    await page.getByText('Основания', { exact: true }).first().click(); await expect(page.getByText('Курс: числитель: 120').first()).toBeVisible(); assert.equal(await page.getByText('PRIVATE_RAW_NBU_FIXTURE').count(), 0); await page.getByText('Основания', { exact: true }).first().click();
    const expenseHref = await page.getByRole('link', { name: 'Расход', exact: true }).first().getAttribute('href'); const expenseUrl = new URL(expenseHref, base); assert.equal(expenseUrl.searchParams.get('search'), 'synthetic-expense'); assert.equal(expenseUrl.searchParams.get('period'), '2026-05'); assert.equal(expenseUrl.searchParams.get('currency'), 'UAH');
    await page.getByRole('link', { name: 'synthetic-order', exact: true }).first().click(); assert.deepEqual(await page.evaluate(() => window.navigation), { section: 'orders', context: { orderId: 'synthetic-order' } });
    for (const width of [1920, 1366, 768, 390]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No document horizontal overflow at ' + width); await page.screenshot({ path: resolve(artifacts, `finance-${width}.png`), fullPage: true }); }
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать CSV', exact: true }).click(); const csv = await download; assert.match(csv.suggestedFilename(), /tax-UAH-2026-05/); const stream = await csv.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk); const content = Buffer.concat(chunks).toString('utf8'); assert.ok(content.includes('Неполный')); assert.ok(content.includes('2026-05-01')); assert.ok(content.includes('EUR'));
    const csvCells = [...content.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"'));
    for (const label of ['Единый налог', 'Военный сбор', 'ЕСВ', 'Начисление', 'Источник поступления', 'Корректировка']) assert.ok(csvCells.includes(label), label);
    for (const code of ['UNIFIED', 'MILITARY', 'ESV', 'FINALIZE', 'ROOT', 'ADJUST']) assert.ok(!csvCells.includes(code), code);
    await select(page, 'Период отчёта', 'Квартал'); await expect.poll(() => calls.filter(c => c.path === '/api/finance/taxes/report').at(-1)?.query).toEqual({ from: '2026-04', to: '2026-06' }); await expect(page.getByText('Начало учёта внутри выбранного периода: покрытие неполное.')).toBeVisible();
    await select(page, 'Период отчёта', 'Год'); await expect.poll(() => calls.filter(c => c.path === '/api/finance/taxes/report').at(-1)?.query).toEqual({ from: '2026-01', to: '2026-12' });
    await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement !== document.body));
  });
  await t.test('independent settings/report failures and stale month responses', async () => {
    failSettings = true; await go(); await expect(page.getByText('Кредит / переплата', { exact: true }).first()).toBeVisible(); await expect(page.getByRole('alert').filter({ hasText: 'Не удалось выполнить операцию' })).toBeVisible(); failSettings = false;
    failReport = true; await go(); await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('alert')).toContainText('Налоги временно недоступны. Остальные финансовые данные продолжают работать.'); await expect(page.getByRole('button', { name: 'Скачать CSV' })).toBeDisabled(); failReport = false;
    delayMay = true; await go(); await page.getByLabel('Месяц', { exact: true }).fill('2026-06'); await expect(page.getByText('2026-06 — 2026-06', { exact: false })).toBeVisible(); await page.waitForTimeout(450); await expect(page.getByText('2026-06 — 2026-06', { exact: false })).toBeVisible(); delayMay = false;
  });
  await t.test('settings show May 1, official wage, current/future policy and async date-confirmed publication', async () => {
    await go('settings'); await expect(page.getByText('Начало учёта включительно: 2026-05-01')).toBeVisible(); await page.getByRole('tab',{name:'Официальные источники',exact:true}).click(); await expect(page.getByText(/8\s647,00/).first()).toBeVisible(); await page.getByRole('tab',{name:'Управление',exact:true}).click(); await openAccordion('Обновить налоги');
    await select(page, 'Группа ФОП', '2 группа'); await page.getByLabel('Действует с').fill('2027-01-01'); await page.getByLabel('Фиксированный единый налог, UAH / месяц').fill('100'); await page.getByLabel('Основание перехода / изменения ставок').fill('Синтетическое подтверждение перехода'); await page.getByRole('button',{name:'Предпросмотр влияния политики',exact:true}).click(); await page.getByRole('checkbox', { name: 'Подтверждаю дату действия новой версии: 2027-01-01' }).check();
    await page.getByRole('button', { name: 'Сохранить версию', exact: true }).click(); await expect.poll(() => calls.findLast(c => c.path.endsWith('/policies'))?.body.group).toBe(2); const body = calls.findLast(c => c.path.endsWith('/policies')).body; assert.equal(body.expectedRevision, 7); assert.equal(body.unifiedRateBps, 0); assert.equal(body.esvRateBps, 2200); assert.equal(body.unifiedMode, 'FIXED'); assert.equal(body.militaryRateBps, 1000); assert.equal(body.fixedUnifiedMinor, 10000); assert.equal(body.effectiveFrom, '2027-01-01'); assert.ok(body.operationKey);
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: resolve(artifacts, 'settings-390.png'), fullPage: true });
  });
  await t.test('settlement linking, integer allocation, CAS conflict and unknown-result stable retry; external cash refresh', async () => {
    await go(); await openAccordion('Уплаты и распределения');
    let form = fieldset('Связать расход'); await select(form, 'Компонент', 'Единый налог'); await select(form, 'Существующий расход', /2026-05-02.*Синтетическая уплата/); await confirm(form); await form.getByRole('button', { name: 'Связать расход' }).click(); await expect.poll(() => page.evaluate(() => window.cashRefreshes)).toBe(1); assert.equal(calls.findLast(c => c.path.endsWith('/settlements')).body.expenseId, 'synthetic-existing-expense');
    await openAccordion('Уплаты и распределения'); form = fieldset('Распределить уплату'); await select(form, 'Связанная уплата', /Единый налог · 500,00.*2026-05-01/); await form.getByLabel('Начисление').click(); await page.getByRole('option').first().click(); await form.getByLabel('Сумма, UAH').fill('12,34'); await confirm(form); await form.getByRole('button', { name: 'Распределить', exact: true }).click(); await expect.poll(() => calls.findLast(c => c.path.endsWith('/allocations'))?.body.amountMinor).toBe(1234);
    await openAccordion('Уплаты и распределения'); form = fieldset('Связать расход'); await select(form, 'Компонент', 'Единый налог'); await select(form, 'Существующий расход', /2026-05-03.*Синтетический повтор/); await confirm(form); failMutation = true; await form.getByRole('button', { name: 'Связать расход' }).click(); await expect(form.getByRole('alert')).toContainText('Версия изменилась'); assert.equal(await page.getByText('raw backend details never displayed').count(), 0); failMutation = false;
    dropMutation = true; await form.getByRole('button', { name: 'Связать расход' }).click(); await expect(form.getByRole('alert')).toContainText('Результат операции пока неизвестен'); const first = calls.findLast(c => c.path.endsWith('/settlements')).body; await form.getByRole('button', { name: 'Связать расход' }).click(); await expect.poll(() => page.evaluate(() => window.cashRefreshes)).toBe(2); assert.deepEqual(calls.findLast(c => c.path.endsWith('/settlements')).body, first); dropMutation = false;
  });
  await t.test('backfill preview explicit apply; accountant restrictions; period revision on close', async () => {
    incomplete = false; await go(); await openAccordion('Историческое заполнение'); await page.getByLabel('По дату включительно').fill('2026-05-31'); const writesBefore = calls.filter(c => c.path.endsWith('/backfill/apply')).length; await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click(); await expect(page.getByText('Поступлений: 1')).toBeVisible(); assert.equal(calls.filter(c => c.path.endsWith('/backfill/apply')).length, writesBefore); await page.getByRole('checkbox', { name: 'Проверены даты, поступления и отсутствующие курсы' }).check(); await page.getByRole('button', { name: 'Применить подтверждённый предпросмотр' }).click(); await expect.poll(() => calls.findLast(c => c.path.endsWith('/backfill/apply'))?.body.token).toBe('synthetic-preview-token');
    await openAccordion('Закрытие месяцев'); const form = fieldset('Закрыть месяц: 2026-05'); await form.getByLabel('Подтверждение полноты месяца').fill('Синтетическая сверка'); await confirm(form); await form.getByRole('button', { name: 'Закрыть месяц', exact: true }).click(); await expect.poll(() => calls.findLast(c => c.path.endsWith('/close'))?.body.expectedRevision).toBe(3);
    await go('finance', 'ACCOUNTANT'); await expect(page.getByText('Кредит / переплата', { exact: true }).first()).toBeVisible(); assert.equal(await page.getByRole('button', { name: 'Историческое заполнение', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: 'Закрытие месяцев', exact: true }).count(), 0); await go('settings', 'ACCOUNTANT'); await expect(page.getByRole('heading',{name:'Действующие правила',exact:true})).toBeVisible(); assert.equal(await page.getByRole('button', { name: 'Сохранить версию' }).count(), 0);
    await go('order'); await expect(page.getByText('Налоги с поступлений')).toBeVisible(); await expect(page.getByRole('alert').filter({ hasText: 'Неполный отчёт' })).toBeVisible();
  });
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
});
