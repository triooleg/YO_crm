import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

// Builds only the assigned component in a disposable local harness. No CRM server or database.
test('staff measurements panel: real Mantine browser interactions and responsive layout', {
  skip: process.env.YO_PM_STAFF_BROWSER !== '1', timeout: 120_000,
}, async t => {
  const compact = process.env.YO_PM_STAFF_COMPACT === '1';
  const require = createRequire(import.meta.url), ts = require('typescript');
  const { chromium, expect } = require('@playwright/test');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const artifacts = resolve(root, '.local/pm-staff-browser');
  await mkdir(artifacts, { recursive: true });
  const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  await writeFile(resolve(artifacts, 'panel.mjs'), compile(await readFile(resolve(root, 'apps/web/components/orders/parent-measurements-panel.tsx'), 'utf8')).replace('../../lib/i18n', './i18n.mjs').replace('../measurement-definition', './definition.mjs').replace('../../lib/parent-measurements-qr', './qr.mjs'));
  await writeFile(resolve(artifacts, 'definition.mjs'), compile(await readFile(resolve(root, 'apps/web/components/measurement-definition.ts'), 'utf8')).replace('../lib/i18n', './i18n.mjs'));
  await writeFile(resolve(artifacts, 'qr.mjs'), compile(await readFile(resolve(root, 'apps/web/lib/parent-measurements-qr.ts'), 'utf8')));
  await writeFile(resolve(artifacts, 'i18n.mjs'), compile(await readFile(resolve(root, 'apps/web/lib/i18n.ts'), 'utf8')));
  await writeFile(resolve(artifacts, 'theme.mjs'), compile(await readFile(resolve(root, 'apps/web/lib/mantine-theme.ts'), 'utf8')));
  await writeFile(resolve(artifacts, 'entry.mjs'), `
    import {createElement} from 'react'; import {createRoot} from 'react-dom/client';
    import {MantineProvider} from '@mantine/core'; import {yoleotardTheme} from './theme.mjs';
    import {ParentMeasurementsPanel} from './panel.mjs';
    const props={compact:${compact},orderId:'synthetic-order',instances:[{id:'piece1',updatedAt:'piece-v1',ordinal:1,designName:'Тестовый дизайн',productionStatus:'SEWING'}],
      onDraftMessage:text=>{window.draftText=text},onUpdated:()=>{window.updates=(window.updates||0)+1}};
    createRoot(document.getElementById('app')).render(createElement(MantineProvider,{theme:yoleotardTheme},createElement(ParentMeasurementsPanel,props)));
  `);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((accept, reject) => webpack({ mode: 'development', devtool: false, entry: resolve(artifacts, 'entry.mjs'),
    output: { path: artifacts, filename: 'bundle.js' }, resolve: { modules: [resolve(root, 'apps/web/node_modules'), 'node_modules'] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString({ all: false, errors: true }))) : accept()));
  const css = Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')), await readFile(resolve(root, 'apps/web/app/orders-dashboard.css'))]);
  const calls = [], errors = [];
  let reviewStatus = 'RECEIVED', assigned = false, revoked = false, invitation = false;
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
      calls.push({ path: req.url, method: req.method, body });
      let result;
      if (req.method === 'GET') result = { invitations: invitation ? [{ id: 'invite1', mode: 'SHARED', expiresAt: '2099-11-02', revokedAt: revoked ? '2026-10-19' : null, admittedCount: 0 }] : [], expectedPieces: 1,
        drafts: [{ id: 'child1', revision: 2, firstName: 'Тестовая анкета', athleteId: null }], athletes: [{ id: 'athlete1', firstName: 'Тестовая', lastName: 'спортсменка' }],
        submissions: [{ id: 's1', childName: 'Тестовая спортсменка', measuredAt: '2026-10-18', measurementId: 'snapshot1', athleteId: 'athlete1', reviewStatus, assignmentStatus: assigned ? 'ASSIGNED' : 'UNASSIGNED', definitionVersion: 'PARENT_BODY_V1', values: { m1: 60, m2: 50, m3: 65, m6: 40, m15: 110 }, notes: 'Тестовый комментарий', warnings: [], updatedAt: 'submission-v1' }] };
      else if (req.url.endsWith('/invitations')) { invitation = true; result = { id: 'invite1', url: `http://127.0.0.1:${server.address().port}/parent-measurements#synthetic-token`, expiresAt: '2099-11-02' }; }
      else if (req.url.endsWith('/review')) { reviewStatus = body.status; result = { ok: true }; }
      else if (req.url.endsWith('/assign')) { assigned = true; result = { instances: [] }; }
      else if (req.url.endsWith('/revoke')) { revoked = true; result = { ok: true }; }
      else if (req.url.endsWith('/bind')) result = { ok: true };
      else { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result)); return;
    }
    if (req.url === '/styles.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(css); return; }
    if (req.url === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(await readFile(resolve(artifacts, 'bundle.js'))); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="app" style="padding:16px;max-width:${compact ? 260 : 1000}px;margin:auto"></main><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(accept => server.listen(0, '127.0.0.1', accept));
  t.after(() => new Promise(accept => { server.closeAllConnections(); server.close(accept); }));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const externalRequests = [];
  page.on('request', request => { if (!request.url().startsWith(`http://127.0.0.1:${server.address().port}/`) && !request.url().startsWith('data:')) externalRequests.push(request.url()); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  if (compact) {
    await expect(page.getByRole('button', {name:'Все 17 параметров',exact:true})).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await expect(page.getByRole('button', {name:'Создать ссылку',exact:true})).not.toBeVisible();
    await page.screenshot({path:resolve(artifacts,'panel-compact-collapsed.png'),fullPage:true});
    await page.getByRole('button', {name:'Все 17 параметров',exact:true}).focus();
    await page.keyboard.press('Enter');
  }
  await expect(page.getByText('№6: без припуска; прибавку учитывать отдельно', { exact: true })).toBeVisible();
  for (const [width, height] of [[1920, 1080], [1366, 768], [768, 1024], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no document overflow at ${width}`);
    if (!compact) assert.ok(await page.getByRole('button', { name: 'Создать ссылку', exact: true }).locator('.mantine-Button-label').evaluate(node => node.scrollWidth <= node.clientWidth), `create label fully visible at ${width}`);
    await expect(page.locator('tbody tr')).toHaveCount(17);
    if (compact) {
      assert.ok(await page.locator('.orders-parent-measurements-compact').evaluate(node => node.getBoundingClientRect().width <= 260), 'actual sidebar width');
      assert.ok(await page.locator('.orders-parent-measurements-parameters').evaluate(node => node.clientHeight <= 320 && node.scrollHeight > node.clientHeight), '17 parameters have bounded scroll');
    }
    await page.screenshot({ path: resolve(artifacts, `panel-${compact ? 'compact-' : ''}${width}.png`), fullPage: true });
  }
  if (compact) await page.getByRole('button', {name:'Ссылки и анкеты',exact:true}).click();
  await page.getByRole('button', { name: 'Создать ссылку', exact: true }).click();
  await expect(page.getByLabel('Новая ссылка', { exact: true })).toBeVisible();
  const beforeQr = calls.length;
  await page.getByRole('button', { name: 'Показать QR-код', exact: true }).click();
  const qrImage = page.getByRole('img', { name: 'QR-код ссылки для заполнения измерений', exact: true });
  await expect(qrImage).toBeVisible();
  await expect(qrImage).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.getByRole('dialog', { name: 'Показать QR-код', exact: true })).toHaveCSS('opacity', '1');
  assert.equal(await qrImage.evaluate(image => image.naturalWidth), 320);
  assert.equal(calls.length, beforeQr);
  await page.screenshot({ path: resolve(artifacts, 'qr-390.png'), fullPage: true });
  await page.keyboard.press('Escape'); await expect(qrImage).not.toBeVisible();
  assert.equal(await page.evaluate(() => window.draftText), undefined);
  await page.getByRole('button', { name: 'Вставить в черновик переписки', exact: true }).click();
  assert.match(await page.evaluate(() => window.draftText), /#synthetic-token/);
  if (compact) {
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Новая ссылка', {exact:true})).not.toBeVisible();
    await page.getByRole('button', {name:'Ссылки и анкеты',exact:true}).click();
    await expect(page.getByLabel('Новая ссылка', {exact:true})).toHaveValue(/#synthetic-token$/);
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/invitations')).length, 1);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Запросить уточнение', exact: true }).click();
  await page.getByLabel('Причина / уточнение', { exact: true }).fill('Тест: перепроверьте №15');
  await page.getByRole('button', { name: 'Сохранить проверку', exact: true }).click();
  await expect(page.getByText('Нужно уточнение', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Назначить изделиям', exact: true }).click();
  await page.getByLabel('Тестовый дизайн · №1 · Пошив', { exact: true }).check();
  await page.getByLabel('Подтверждаю изменение мерок для выбранных изделий в производстве', { exact: true }).check();
  await page.getByLabel('Причина / уточнение', { exact: true }).fill('Тест: подтверждено представителем');
  await page.screenshot({ path: resolve(artifacts, 'assignment-390.png'), fullPage: true });
  await page.getByRole('button', { name: 'Сохранить назначение', exact: true }).click();
  await expect(page.getByText('Назначено', { exact: true })).toBeVisible();
  const assignment = calls.find(call => call.path.endsWith('/assign'));
  assert.deepEqual(assignment.body.targets, [{ id: 'piece1', expectedUpdatedAt: 'piece-v1' }]);
  assert.equal(assignment.body.confirmProduction, true);
  if (compact) await page.getByRole('button', {name:'Ссылки и анкеты',exact:true}).click();
  await page.getByRole('button', { name: 'Связать со спортсменкой', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Связать анкету с существующей спортсменкой', exact: true });
  await dialog.getByLabel('Ребёнок в неотправленной анкете', { exact: true }).click();
  await page.getByRole('option', { name: 'Тестовая анкета', exact: true }).click();
  await dialog.getByLabel('Спортсменка текущего клиента', { exact: true }).click();
  await page.getByRole('option', { name: 'Тестовая спортсменка', exact: true }).click();
  await dialog.getByLabel('Причина привязки', { exact: true }).fill('Тест: представитель подтвердил профиль');
  await dialog.getByLabel('Представитель подтвердил, что это тот же ребёнок', { exact: true }).check();
  await page.screenshot({ path: resolve(artifacts, 'binding-390.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Подтвердить привязку', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  assert.deepEqual(calls.find(call => call.path.endsWith('/bind')).body, { athleteId: 'athlete1', reason: 'Тест: представитель подтвердил профиль', expectedRevision: 2, representativeVerified: true });
  await page.getByRole('button', { name: 'Отозвать', exact: true }).click();
  await page.getByRole('button', { name: 'Отозвать', exact: true }).last().click();
  await expect(page.getByText(/Участников: 0 · Отозвана/)).toBeVisible();
  await expect(page.getByLabel('Новая ссылка', { exact: true })).not.toBeVisible();
  assert.ok(calls.every(call => !call.path.includes('messages'))); assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await writeFile(resolve(artifacts, compact ? 'receipt-compact.json' : 'receipt.json'), JSON.stringify({ provenance: 'Local real Chromium, actual component/Mantine/theme/local QR, synthetic HTTP only; no CRM data writes', calls, errors, externalRequests, compact, widths: [1920, 1366, 768, 390, 320] }, null, 2));
});
