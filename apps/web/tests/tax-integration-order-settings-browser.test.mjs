import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

test('order/settings integration through real React UI and browser navigation', { skip: process.env.YO_TAX_INTEGRATION_BROWSER !== '1', timeout: 180000 }, async t => {
  const require = createRequire(import.meta.url), { chromium, expect } = require('@playwright/test');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), web = resolve(root, 'apps/web');
  const out = resolve(root, '.local/tax-integration-order-settings/browser'); await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
  await writeFile(resolve(out, 'css-loader.cjs'), 'module.exports=function(){return ""}');
  const fixture = { id: 'synthetic-order', number: 'TEST-400', currency: 'EUR', priceMinor: 40000, deliveryMinor: 3000, taxMinor: 3800, giftWrapMinor: 500, discountMinor: 500, depositRequiredMinor: 20000, updatedAt: '2026-10-19T10:00:00Z', createdAt: '2026-05-01T10:00:00Z', type: 'CUSTOM', source: 'FACEBOOK', salesStatus: 'CONFIRMED', productionStatus: 'NOT_SCHEDULED', shippingStatus: 'NOT_READY', paymentStatus: 'PARTIAL', client: { id: 'synthetic-client', displayName: 'Тест Клиент', firstName: 'Тест', lastName: 'Клиент', athletes: [], files: [] }, items: [{ id: 'synthetic-item', name: 'Тестовый костюм', quantity: 1, priceMinor: 35000, instances: [] }], payments: [{ id: 'synthetic-payment', amountMinor: 20000, currency: 'EUR', method: 'BANK_TRANSFER', receivedAt: '2026-05-03T10:00:00Z', notes: 'Реальная тестовая оплата', canVoid: true }], invoices: [{ id: 'synthetic-invoice', number: 'INV-TEST', totalMinor: 40000, currency: 'EUR', issueDate: '2026-05-01', status: 'DRAFT' }], expenses: [{ id: 'synthetic-expense', amountMinor: 1500, currency: 'UAH', incurredAt: '2026-05-03', category: { id: 'delivery', name: 'Перевозчик' } }], notesStructured: [], activities: [], orderShipments: [], files: [] };
  await writeFile(resolve(out, 'entry.tsx'), `import React from 'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web, 'lib/mantine-theme').replaceAll('\\', '/')}';import{SettingsWorkspace}from'${resolve(web, 'components/settings-workspace').replaceAll('\\', '/')}';import{OrderExpandedTabs}from'${resolve(web, 'components/orders/order-expanded-tabs').replaceAll('\\', '/')}';const q=new URLSearchParams(location.search), role=q.get('role')||'OWNER',order=${JSON.stringify(fixture)};window.actions=[];const action=(name)=>(...args)=>{window.actions.push({name,args});return Promise.resolve()};const bridge={request:async(path,init)=>{window.actions.push({name:'request',path,method:init?.method});return[]},onSaved:action('saved')};const props=new Proxy({order,taxRole:role,financeActions:bridge,compositionActions:bridge,expenseActions:bridge,statusPending:false,...Object.fromEntries(['onPayment','onCurrency','onVoidPayment','onFinance','onAddDesign','onEditItem','onEdit','onMeasurements','onUpdateInstance','onUpdateClientPreferences','onCreateNote','onUpdateNote'].map(name=>[name,action(name)]))},{get:(target,key)=>key in target?target[key]:typeof key==='string'&&key.startsWith('on')?action(key):undefined});createRoot(document.getElementById('app')).render(<MantineProvider theme={yoleotardTheme}>{q.get('section')==='orders'?<div className="orders-table-scroll"><table className="orders-dashboard-table"><tbody><tr className="orders-expanded-row"><td><div className="orders-approved-expanded"><OrderExpandedTabs {...props}/></div></td></tr></tbody></table></div>:<SettingsWorkspace role={role}/>}</MantineProvider>);`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((accept, reject) => webpack({ mode: 'development', devtool: false, entry: resolve(out, 'entry.tsx'), output: { path: out, filename: 'bundle.js' }, resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js'], modules: [resolve(web, 'node_modules'), 'node_modules'] }, module: { rules: [{ test: /\.tsx?$/, use: resolve(out, 'loader.cjs') }, { test: /\.css$/, use: resolve(out, 'css-loader.cjs') }] } }, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString({ all: false, errors: true }))) : accept()));
  const layout = await readFile(resolve(web, 'app/layout.tsx'), 'utf8');
  const styles = [...layout.matchAll(/import ["'](\.\/[^"']+\.css)["'];/g)].map(match => resolve(web, 'app', match[1]));
  const extraCss = resolve(web, 'app/tax-integration-order-settings.css');
  try { await readFile(extraCss); if (!styles.includes(extraCss)) styles.push(extraCss); } catch {}
  const css = Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')), ...await Promise.all(styles.map(path => readFile(path)))]);
  const calls = [], errors = [], blocked = [];
  let estimate, orderResponseGate, failOrder = false, previewBlocked = false, previewRevision = 7, previewDelay = 0;
  const policy = { id: 'policy-version-1', effectiveFrom: '2026-05-01', group: 3, unifiedMode: 'PERCENT', unifiedRateBps: 500, fixedUnifiedMinor: null, militaryRateBps: 100, esvRateBps: 2200, state: 'ACTIVE', snapshot: { transitionEvidence: 'Официальное основание', author: { displayName: 'Тестовый владелец' } }, createdAt: '2026-05-01' };
  const settings = { enabled: true, revision: 7, accountingStartDate: '2026-05-01', timezone: 'Europe/Kyiv', policies: [policy], currentPolicy: policy, futurePolicies: [], wageCatalog: [{ version: 'wage-2026', minor: 864700, from: '2026-01-01', to: '2027-01-01', source: 'https://tax.gov.ua/', verifiedAt: '2026-10-19' }] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      calls.push({ path: url.pathname, method: req.method, body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined });
      if (url.pathname === '/api/finance/taxes/settings') return send(settings);
      if (url.pathname === '/api/finance/taxes/policies/preview') { if (previewDelay) await new Promise(resolve => setTimeout(resolve, previewDelay)); return send({ previewRevision, fieldSignature: 'synthetic-signature', affectedPeriods: [{ month: '2026-11', state: 'OPEN', used: false }, { month: '2026-12', state: 'CLOSED', used: true }], publicationBlocked: previewBlocked, reasons: previewBlocked ? [{ code: 'USED_POLICY_CONFLICT', month: '2026-12' }] : [] }); }
      if (url.pathname === '/api/finance/taxes/policies') return send(settings);
      if (url.pathname.startsWith('/api/finance/taxes/orders/')) { await orderResponseGate; return send({ orderId: fixture.id, incomplete: false, entries: [], estimate, completeness: { incomplete: false, missing: [], accruedUahMinor: 60000 } }, failOrder ? 503 : 200); }
      if (url.pathname === '/api/finance/settings') return send([]);
      if (url.pathname === '/api/ai-assistant/settings') return send({ enabled: false, allowClientContext: false, model: 'gpt-4.1-mini', defaultLanguage: 'ru', tone: 'Спокойный', systemPrompt: 'Синтетическая инструкция', connected: false, apiKeySource: 'none' });
      if (url.pathname === '/api/ai-control/status') return send({ serverPolicy: { aiEnabled: false, provider: 'disabled', analysisModel: 'none', replyModel: 'none', embeddingModel: 'none' }, effective: { masterEnabled: false, mode: 'OFF', autoReplies: false, serverBlocked: true }, settings: [], worker: { running: false }, outbox: { status: 'healthy', queued: 0 }, lastSuccessfulRun: null, statistics24h: { messagesQueued: 0, analysesCompleted: 0, failed: 0, retryCount: 0, averageLatencyMs: 0, inputTokens: 0, outputTokens: 0, estimatedCostMinor: 0, automaticRepliesSent: 0 } });
      if (url.pathname === '/api/finance/exchange-rates') return send({ provider: 'NBU', supportedPairs: ['EUR/UAH'], officialUrl: 'https://bank.gov.ua/', cache: null });
      blocked.push(url.pathname); return send({}, 501);
    }
    if (url.pathname === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(await readFile(resolve(out, 'bundle.js'))); }
    if (url.pathname === '/styles.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(css); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="app"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); await writeFile(resolve(out, 'evidence.json'), JSON.stringify({ provenance: 'Actual source components and central contracts copied verbatim from MAIN. Synthetic local HTTP API; no backend/database/production proof.', calls, errors, blocked }, null, 2)); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(5000);
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : (blocked.push(route.request().url()), route.abort()));
  page.on('pageerror', error => errors.push(error.message));
  async function openFinancialInformation() {
    const control = page.getByRole('button', { name: 'Финансовая информация заказа', exact: true });
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await control.click();
    await expect(control).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { name: 'Финансовая информация заказа', exact: true })).toBeVisible();
  }
  await t.test('canonical taxes destination, legacy finance, Back and Forward', async () => {
    await page.goto(`${base}/?section=settings&tab=taxes`);
    await expect(page.getByRole('heading', { name: 'Статус налогового учёта', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Финансы', exact: true }).click();
    await expect(page).toHaveURL(/tab=finance/);
    await expect(page.getByRole('heading', { name: 'Официальные курсы валют', exact: true })).toBeVisible();
    await page.goBack(); await expect(page.getByRole('heading', { name: 'Статус налогового учёта', exact: true })).toBeVisible();
    await page.goForward(); await expect(page).toHaveURL(/tab=finance/);
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
  });
  await t.test('Settings AI navigation and Back/Forward retain actual shared Mantine controls and consent guard', async () => {
    await page.goto(`${base}/?section=settings&tab=taxes`);
    await page.getByRole('tab', { name: 'AI-помощник', exact: true }).click();
    await expect(page).toHaveURL(/tab=ai/);
    const form = page.locator('form').filter({ has: page.locator('select[name=model]') });
    await expect(form.locator('select[name=model]')).toHaveClass(/mantine-NativeSelect-input/);
    await expect(form.locator('input[name=tone]')).toHaveClass(/mantine-TextInput-input/);
    await expect(form.locator('textarea[name=systemPrompt]')).toHaveClass(/mantine-Textarea-input/);
    await expect(form.locator('input[name=enabled]')).toHaveClass(/mantine-Checkbox-input/);
    await expect(form.locator('button[type=submit]')).toHaveClass(/mantine-Button-root/);
    await form.locator('input[name=enabled]').check(); await form.locator('button[type=submit]').click();
    await expect(form.getByRole('alert')).toBeVisible();
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
    await page.goBack(); await expect(page.getByRole('heading', { name: 'Статус налогового учёта', exact: true })).toBeVisible();
    await page.goForward(); await expect(page.getByRole('tab', { name: 'AI-помощник', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('select[name=model]')).toHaveValue('gpt-4.1-mini');
    await expect(page.getByRole('checkbox', { name: /Включить AI Intelligence/ })).toBeDisabled();
  });
  await t.test('fixed order summary and actual payment stay separate from tax journal', async () => {
    await page.goto(`${base}/?section=orders&orderId=synthetic-order&tab=finance`);
    await expect(page.locator('.orders-finance-summary')).toContainText(/400,00/);
    await expect(page.getByRole('heading', { name: 'Финансовая информация заказа', exact: true })).not.toBeVisible();
    for (const title of ['Расчёт стоимости заказа', 'Расходы на доставку для ателье']) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    await expect(page.getByText('INV-TEST', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Начисления по фактическим поступлениям', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await openFinancialInformation();
    await expect(page.getByText('Полная стоимость заказа', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Не рассчитано', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Реальная тестовая оплата', { exact: true })).toBeVisible();
    assert.equal(calls.filter(call => call.path.includes('/taxes/orders/')).length, 1);
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
  });
  await t.test('policy preview shows impact, never publishes, and edits invalidate it', async () => {
    await page.goto(`${base}/?section=settings&tab=taxes`);
    await page.getByRole('tab', { name: 'Управление', exact: true }).click();
    await page.getByRole('button', { name: 'Обновить налоги', exact: true }).last().click();
    await page.getByLabel(/^Действует с/).fill('2026-11-01');
    await page.getByRole('button', { name: 'Предпросмотр влияния политики', exact: true }).click();
    await expect(page.getByText('2026-12', { exact: true })).toBeVisible();
    assert.equal(calls.filter(call => call.path === '/api/finance/taxes/policies').length, 0);
    const preview = calls.find(call => call.path.endsWith('/policies/preview'));
    assert.equal(preview.body.expectedRevision, 7); assert.equal('operationKey' in preview.body, false);
    await page.getByLabel('Подтверждаю дату действия новой версии: 2026-11-01', { exact: true }).check();
    await expect(page.locator('button[type=submit]')).toBeEnabled();
    await page.getByLabel('Единый налог, %', { exact: true }).fill('6');
    await expect(page.locator('button[type=submit]')).toBeDisabled();
    await expect(page.getByText('2026-12', { exact: true })).toHaveCount(0);
  });
  await t.test('blocked or stale policy impact cannot publish; late preview is discarded', async () => {
    async function editor() { await page.goto(`${base}/?section=settings&tab=taxes`); await page.getByRole('tab', { name: 'Управление', exact: true }).click(); await page.getByRole('button', { name: 'Обновить налоги', exact: true }).last().click(); await page.getByLabel(/^Действует с/).fill('2026-11-01'); }
    previewBlocked = true; await editor();
    await page.getByRole('button', { name: 'Предпросмотр влияния политики', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Ограничения' })).toBeVisible();
    await expect(page.locator('button[type=submit]')).toBeDisabled();
    previewBlocked = false; previewRevision = 8; await editor();
    await page.getByRole('button', { name: 'Предпросмотр влияния политики', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Версия изменилась' })).toBeVisible();
    await expect(page.locator('button[type=submit]')).toBeDisabled();
    previewRevision = 7; previewDelay = 300; await editor();
    const requested = page.waitForRequest(request => request.url().endsWith('/policies/preview'));
    await page.getByRole('button', { name: 'Предпросмотр влияния политики', exact: true }).click(); await requested;
    await page.getByLabel(/^Действует с/).fill('2026-12-01');
    await page.waitForTimeout(350);
    await expect(page.getByText('Ревизия предпросмотра', { exact: false })).toHaveCount(0);
    await expect(page.locator('button[type=submit]')).toBeDisabled(); previewDelay = 0;
    assert.equal(calls.filter(call => call.path === '/api/finance/taxes/policies').length, 0);
  });
  await t.test('pending tax response leaves fixed totals, receipts and finance actions usable without a guessed estimate', async () => {
    const originalEstimate = estimate, beforeWrites = calls.filter(call => call.method !== 'GET').length;
    let releaseResponse;
    orderResponseGate = new Promise(resolve => { releaseResponse = resolve; });
    estimate = { amountMinor: 2400, currency: 'EUR', asOfDate: '2026-05-01', basis: 'ORDER_CREATED_AT', policyId: 'policy-version-1', effectiveFrom: '2026-05-01', incomplete: false, missing: [] };
    try {
      const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/finance/taxes/orders/synthetic-order');
      await page.goto(`${base}/?section=orders&orderId=synthetic-order&tab=finance`, { waitUntil: 'domcontentloaded' });
      await requested;
      await expect(page.locator('.orders-finance-summary')).toContainText(/400,00/);
      await expect(page.getByText('Реальная тестовая оплата', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '＋ Добавить оплату', exact: true })).toBeEnabled();
      await openFinancialInformation();
      const taxCard = page.locator('.tax-order-price-card').filter({ hasText: 'Налоговая составляющая (включена)' });
      await expect(taxCard).toContainText('Не рассчитано');
      releaseResponse();
      await expect(taxCard).toContainText(/24,00/);
      await expect(page.locator('.orders-finance-summary')).toContainText(/400,00/);
      assert.equal(calls.filter(call => call.method !== 'GET').length, beforeWrites);
    } finally { releaseResponse(); orderResponseGate = undefined; estimate = originalEstimate; }
  });
  await t.test('server price estimate and actual receipt accrual stay distinct; failures leave commercial UI usable', async () => {
    estimate = { amountMinor: 2400, currency: 'EUR', asOfDate: '2026-05-01', basis: 'ORDER_CREATED_AT', policyId: 'policy-version-1', effectiveFrom: '2026-05-01', incomplete: false, missing: [] };
    const before = calls.filter(call => call.path.includes('/taxes/orders/')).length;
    await page.goto(`${base}/?section=orders&orderId=synthetic-order&tab=finance`);
    await openFinancialInformation();
    const card = page.locator('.tax-order-price-card').filter({ hasText: 'Налоговая составляющая (включена)' });
    await expect(card).toContainText(/24,00/);
    await expect(page.locator('.tax-order-price-total')).toContainText(/400,00/);
    await page.getByRole('button', { name: 'Начисления по фактическим поступлениям', exact: true }).click();
    await expect(page.getByText(/600,00/)).toBeVisible();
    assert.equal(calls.filter(call => call.path.includes('/taxes/orders/')).length - before, 1);
    failOrder = true; await page.reload();
    await expect(page.locator('.orders-finance-summary')).toContainText(/400,00/);
    await openFinancialInformation();
    await expect(page.locator('.tax-order-price-total')).toContainText(/400,00/);
    await expect(page.locator('.tax-order-price-card').filter({ hasText: 'Налоговая составляющая (включена)' })).toContainText('Не рассчитано');
    await page.getByRole('button', { name: 'Начисления по фактическим поступлениям', exact: true }).click();
    await expect(page.getByRole('alert', { name: 'Налоги ФОП', exact: true })).toBeVisible();
    await expect(page.getByText('Реальная тестовая оплата', { exact: true })).toBeVisible(); failOrder = false;
  });
  await t.test('accountant reads policies without editor; manager order performs no tax request', async () => {
    await page.goto(`${base}/?section=settings&tab=taxes&role=ACCOUNTANT`);
    await expect(page.getByText('Просмотр налоговой политики без права изменения', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Управление', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Запланировать смену группы', exact: true })).toHaveCount(0);
    const before = calls.filter(call => call.path.includes('/taxes/')).length;
    await page.goto(`${base}/?section=orders&orderId=synthetic-order&tab=finance&role=MANAGER`);
    await expect(page.locator('.orders-finance-summary')).toContainText(/400,00/);
    await openFinancialInformation();
    await expect(page.getByRole('button', { name: 'Начисления по фактическим поступлениям', exact: true })).toHaveCount(0);
    assert.equal(calls.filter(call => call.path.includes('/taxes/')).length, before);
  });
  await t.test('editing a future policy starts with current version rates and retains author provenance', async () => {
    const originalSnapshot = policy.snapshot;
    policy.unifiedRateBps = 600;
    policy.snapshot = { actorId: 'staff-id-only', transitionEvidence: 'Подтверждённое основание' };
    try {
    await page.goto(`${base}/?section=settings&tab=taxes`);
    await expect(page.getByText('Автор: ID: staff-id-only', { exact: true }).filter({ visible: true })).toHaveCount(1);
    await page.getByRole('tab', { name: 'Управление', exact: true }).click();
    await page.getByRole('button', { name: 'Обновить налоги', exact: true }).last().click();
    await expect(page.getByLabel('Единый налог, %', { exact: true })).toHaveValue('6.00');
    } finally {
      policy.unifiedRateBps = 500;
      policy.snapshot = originalSnapshot;
    }
  });
  await t.test('existing payment, currency, void, discount and document actions remain reachable', async () => {
    await page.goto(`${base}/?section=orders&orderId=synthetic-order&tab=finance`);
    await page.getByRole('button', { name: '＋ Добавить оплату', exact: true }).click();
    await page.getByRole('button', { name: 'Изменить валюту: EUR', exact: true }).click();
    let actions = await page.evaluate(() => window.actions.map(action => action.name));
    assert.ok(actions.includes('onPayment')); assert.ok(actions.includes('onCurrency'));
    await page.getByRole('button', { name: 'Действия оплаты: synthetic-payment', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Отменить оплату', exact: true }).click();
    await page.getByLabel(/^Причина отмены/).fill('Тестовое исправление');
    await page.getByRole('button', { name: 'Отменить оплату', exact: true }).click();
    const voided = await page.evaluate(() => window.actions.find(action => action.name === 'onVoidPayment'));
    assert.deepEqual(voided.args, ['synthetic-payment', 'Тестовое исправление', '2026-10-19T10:00:00Z']);
    await expect(page.locator('.orders-finance-calculation').getByText('Подарочная упаковка', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Добавить позицию/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: '＋ Добавить расход', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '＋ Создать инвойс', exact: true })).toBeEnabled();
    await expect(page.locator('.orders-finance-bottom')).toHaveCount(0);
    for (const title of ['Финансовые заметки', 'Быстрые действия', 'Напоминания']) await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Финансовые заметки', exact: true })).toHaveCount(0);
  });
  await t.test('desktop tablet mobile layouts retain nine tabs and all existing finance actions', async () => {
    for (const width of [1920, 1366, 768, 390]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
      await page.goto(`${base}/?section=orders&orderId=synthetic-order&tab=finance`);
      await expect(page.locator('.orders-finance-summary')).toContainText(/400,00/);
      await expect(page.getByText('INV-TEST', { exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Финансовые заметки', exact: true })).toHaveCount(0);
      await page.screenshot({ path: resolve(out, `order-${width}-compact.png`), fullPage: true });
      await openFinancialInformation();
      await expect(page.locator('.tax-order-price-total')).toContainText(/400,00/);
      assert.equal(await page.getByRole('tab').count(), 9);
      await expect(page.getByRole('heading',{name:'Состав полной стоимости',exact:true})).toBeVisible();
      assert.ok(await page.locator('.tax-order-price-total .tax-order-price-value').evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 18), `readable amount ${width}`);
      await expect(page.getByText('INV-TEST', { exact: true })).toBeVisible();
      if(width===390){const fit=await page.locator('.tax-order-finance').evaluate(el=>({panel:el.getBoundingClientRect().width,frame:el.closest('.orders-approved-expanded').getBoundingClientRect().width}));assert.ok(fit.panel<=fit.frame+1,`expanded finance constrained to mobile frame: ${JSON.stringify(fit)}`);const clipped=await page.locator('.orders-order-tab-finance').evaluate(root=>[...root.querySelectorAll('p')].filter(el=>el.clientWidth>0&&el.scrollWidth>el.clientWidth+1&&!el.closest('.orders-finance-scroll')).map(el=>el.textContent));assert.deepEqual(clipped,[],'ordinary finance text wraps within the mobile panel');}
      await expect(page.locator('a[href="/api/finance/invoices/synthetic-invoice/document"]')).toBeVisible();
      await expect(page.locator('a[href="/api/finance/invoices/synthetic-invoice/document?download=1"]')).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `order overflow ${width}`);
      await page.screenshot({ path: resolve(out, `order-${width}.png`), fullPage: true });
      await page.goto(`${base}/?section=settings&tab=taxes`);
      await expect(page.getByRole('heading', { name: 'Статус налогового учёта', exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `settings overflow ${width}`);
      await page.screenshot({ path: resolve(out, `settings-${width}.png`), fullPage: true });
    }
  });
  await t.test('publication retains the exact legacy policy command, CAS and operation key after reviewed preview', async () => {
    await page.goto(`${base}/?section=settings&tab=taxes`);
    await page.getByRole('tab', { name: 'Управление', exact: true }).click();
    await page.getByRole('button', { name: 'Обновить налоги', exact: true }).last().click();
    await page.getByLabel(/^Действует с/).fill('2026-11-01');
    await page.getByRole('button', { name: 'Предпросмотр влияния политики', exact: true }).click();
    await page.getByLabel('Подтверждаю дату действия новой версии: 2026-11-01', { exact: true }).check();
    await page.getByRole('button', { name: 'Сохранить версию', exact: true }).click();
    await expect.poll(() => calls.filter(call => call.path === '/api/finance/taxes/policies').length).toBe(1);
    const command = calls.find(call => call.path === '/api/finance/taxes/policies').body;
    assert.equal(command.expectedRevision, 7); assert.equal(command.unifiedRateBps, 500); assert.equal(command.militaryRateBps, 100); assert.equal(command.esvRateBps, 2200);
    assert.equal(command.effectiveFrom, '2026-11-01'); assert.match(command.operationKey, /^[0-9a-f-]{36}$/);
  });
  await t.test('discoverable planned group transition drafts dated January wage percentage without guessing an official amount', async () => {
    const beforePolicies = JSON.stringify(settings.policies), beforeWrites = calls.filter(call => call.path === '/api/finance/taxes/policies').length;
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${base}/?section=settings&tab=taxes`);
    await expect(page.getByRole('tab', { name: 'История версий', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Запланировать смену группы', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Управление', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel(/^Действует с/)).toHaveValue('2027-01-01');
    await expect(page.getByRole('combobox', { name: 'Группа ФОП', exact: true })).toHaveValue('2 группа');
    await expect(page.getByLabel(/^Единый налог, % МЗП на 1 января/)).toHaveValue('20.00');
    await expect(page.getByLabel('Военный сбор, %', { exact: true })).toHaveValue('10.00');
    await expect(page.getByLabel('ЕСВ, %', { exact: true })).toHaveValue('22.00');
    await expect(page.getByText(/План владельца.*не подтверждает регистрацию/)).toBeVisible();
    await expect(page.getByText(/Ожидается официальная база на 1 января 2027/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить версию', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Предпросмотр влияния политики', exact: true }).click();
    const draft = calls.findLast(call => call.path.endsWith('/policies/preview')).body;
    assert.equal(draft.effectiveFrom, '2027-01-01'); assert.equal(draft.group, 2);
    assert.equal(draft.unifiedMode, 'FIXED'); assert.equal(draft.fixedUnifiedMinor, null);
    assert.equal(draft.fixedUnifiedWageRateBps, 2000); assert.equal(draft.unifiedRateBps, 0);
    assert.equal(draft.militaryRateBps, 1000); assert.equal(draft.esvRateBps, 2200);
    assert.match(draft.transitionEvidence, /План владельца/);
    assert.equal(calls.filter(call => call.path === '/api/finance/taxes/policies').length, beforeWrites);
    await page.getByLabel('Подтверждаю дату действия новой версии: 2027-01-01', { exact: true }).check();
    await page.getByLabel(/^Действует с/).fill('2027-04-01');
    await expect(page.getByRole('button', { name: 'Сохранить версию', exact: true })).toBeDisabled();
    assert.equal(JSON.stringify(settings.policies), beforePolicies);
    await page.screenshot({ path: resolve(out, 'planned-group2-1366.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 960 });
    await page.screenshot({ path: resolve(out, 'planned-group2-390.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  await t.test('planned wage policy preserves legacy monthly amount alternative and publishes only the reviewed formula', async () => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${base}/?section=settings&tab=taxes`);
    await page.getByRole('button', { name: 'Запланировать смену группы', exact: true }).click();
    await page.getByRole('combobox', { name: 'Основание месячного единого налога', exact: true }).click();
    await page.getByRole('option', { name: 'Фиксированная сумма UAH в месяц', exact: true }).click();
    await page.getByLabel(/^Фиксированный единый налог, UAH/).fill('1000');
    await page.getByRole('button', { name: 'Предпросмотр влияния политики', exact: true }).click();
    const legacy = calls.findLast(call => call.path.endsWith('/policies/preview')).body;
    assert.equal(legacy.fixedUnifiedMinor, 100000); assert.equal('fixedUnifiedWageRateBps' in legacy, false);
    await page.getByRole('combobox', { name: 'Основание месячного единого налога', exact: true }).click();
    await page.getByRole('option', { name: 'Процент МЗП на 1 января', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Сохранить версию', exact: true })).toBeDisabled();
    await page.getByLabel(/^Единый налог, % МЗП на 1 января/).fill('21');
    const previews = calls.filter(call => call.path.endsWith('/policies/preview')).length;
    await page.getByRole('button', { name: 'Предпросмотр влияния политики', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Проверьте даты' })).toBeVisible();
    assert.equal(calls.filter(call => call.path.endsWith('/policies/preview')).length, previews);
    await page.getByLabel(/^Единый налог, % МЗП на 1 января/).fill('20');
    await page.getByRole('button', { name: 'Предпросмотр влияния политики', exact: true }).click();
    const reviewed = calls.findLast(call => call.path.endsWith('/policies/preview')).body;
    const publications = calls.filter(call => call.path === '/api/finance/taxes/policies').length;
    await page.getByLabel('Подтверждаю дату действия новой версии: 2027-01-01', { exact: true }).check();
    await page.getByRole('button', { name: 'Сохранить версию', exact: true }).click();
    await expect.poll(() => calls.filter(call => call.path === '/api/finance/taxes/policies').length).toBe(publications + 1);
    const { operationKey, ...published } = calls.findLast(call => call.path === '/api/finance/taxes/policies').body;
    assert.deepEqual(published, reviewed); assert.equal(published.fixedUnifiedWageRateBps, 2000);
    assert.match(operationKey, /^[0-9a-f-]{36}$/);
    assert.equal(settings.currentPolicy.group, 3); assert.equal(settings.policies.length, 1);
  });
  await t.test('read-only future policy shows January wage formula rather than a guessed fixed UAH amount', async () => {
    settings.futurePolicies = [{ ...policy, id: 'planned-owner-2027', effectiveFrom: '2027-01-01', group: 2, unifiedMode: 'FIXED', unifiedRateBps: 0, fixedUnifiedMinor: null, fixedUnifiedWageRateBps: 2000, militaryRateBps: 1000, esvRateBps: 2200 }];
    try {
      await page.goto(`${base}/?section=settings&tab=taxes&role=ACCOUNTANT`);
      await page.getByRole('tab', { name: 'Будущие версии', exact: true }).click();
      await expect(page.getByText(/20% × официальная МЗП на 1 января 2027/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Запланировать смену группы', exact: true })).toHaveCount(0);
    } finally { settings.futurePolicies = []; }
  });
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
});
