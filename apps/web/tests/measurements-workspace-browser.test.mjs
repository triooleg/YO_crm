import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

test('approved staff measurements workspace: real Mantine layout, keyboard, provenance and existing staff operations', { skip: process.env.YO_PM_STAFF_BROWSER !== '1', timeout: 120_000 }, async t => {
  const require = createRequire(import.meta.url), ts = require('typescript');
  const { chromium, expect } = require('@playwright/test');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const artifacts = resolve(root, '.local/pm-staff-workspace-browser');
  await mkdir(artifacts, { recursive: true });
  const sources = {
    'panel.mjs': ['components/orders/parent-measurements-panel.tsx', { '../../lib/i18n': './i18n.mjs', '../measurement-definition': './definition.mjs', '../../lib/parent-measurements-qr': './qr.mjs' }],
    'workspace.mjs': ['components/orders/measurements-workspace.tsx', { '../../lib/i18n': './i18n.mjs', '../measurement-definition': './definition.mjs', '../../lib/measurement-semantics': './semantics.mjs' }],
    'comment.mjs': ['components/orders/measurements-admin-comment.tsx', { '../../lib/i18n': './i18n.mjs' }],
    'i18n.mjs': ['lib/i18n.ts', {}], 'definition.mjs': ['components/measurement-definition.ts', { '../lib/i18n': './i18n.mjs' }],
    'semantics.mjs': ['lib/measurement-semantics.ts', { './i18n': './i18n.mjs' }], 'qr.mjs': ['lib/parent-measurements-qr.ts', {}], 'theme.mjs': ['lib/mantine-theme.ts', {}],
  };
  for (const [target, [source, replacements]] of Object.entries(sources)) {
    let compiled = ts.transpileModule(await readFile(resolve(root, 'apps/web', source), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    for (const [from, to] of Object.entries(replacements)) compiled = compiled.replaceAll(from, to);
    await writeFile(resolve(artifacts, target), compiled);
  }
  await writeFile(resolve(artifacts, 'entry.mjs'), `
    import {createElement as h,useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {MantineProvider,Button} from '@mantine/core';import {yoleotardTheme} from './theme.mjs';
    import {ParentMeasurementsPanel} from './panel.mjs';import {MeasurementsWorkspace} from './workspace.mjs';import {MeasurementsAdminComment} from './comment.mjs';
    const athletes=[{id:'a1',firstName:'Анна',discipline:'RHYTHMIC_GYMNASTICS'},{id:'a2',firstName:'София',discipline:'ACROBATIC_GYMNASTICS'},{id:'a3',firstName:'Мария'}];
    function App(){const[notes,setNotes]=useState([]);async function save(input,id){const r=await fetch('/api/order-tabs/synthetic-order/notes'+(id?'/'+id:''),{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(!r.ok)throw Error('write rejected');const saved=await r.json();setNotes(previous=>[saved,...previous.filter(n=>n.id!==saved.id)]);}
      return h(ParentMeasurementsPanel,{compact:true,orderId:'synthetic-order',instances:[{id:'piece1',updatedAt:'piece-v1',ordinal:1,designName:'Тестовый дизайн',productionStatus:'SEWING'}],onDraftMessage:text=>{window.draftText=text},
        renderWorkspace:staff=>h(MeasurementsWorkspace,{orderId:'synthetic-order',athletes,assignedAthleteIds:['a1'],staff,
          onAddAthlete:()=>{window.addAthlete=true},onAddManually:a=>{window.manualAthlete=a?.id},onEdit:selection=>{window.editorSnapshot=selection.measurement?.id},
          renderUsage:id=>h('p',null,id==='a1'?'Дизайн №1 · Экземпляр №1':'Нет назначенных изделий'),
          renderComment:athleteId=>h(MeasurementsAdminComment,{orderId:'synthetic-order',athleteId,notes,onCreateNote:input=>save(input),onUpdateNote:(id,input)=>save(input,id),onRefresh:async()=>{}}),
        })});
    }
    createRoot(document.getElementById('app')).render(h(MantineProvider,{theme:yoleotardTheme},h(App)));
  `);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((accept, reject) => webpack({ mode: 'development', devtool: false, entry: resolve(artifacts, 'entry.mjs'), output: { path: artifacts, filename: 'bundle.js' }, resolve: { modules: [resolve(root, 'apps/web/node_modules'), 'node_modules'] } }, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString({ all: false, errors: true }))) : accept()));
  const layoutSource=await readFile(resolve(root,'apps/web/app/layout.tsx'),'utf8');
 const stylePaths=[...layoutSource.matchAll(/import ["'](\.\/[^"']+\.css)["'];/g)].map(match=>resolve(root,'apps/web/app',match[1]));
 const css=Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')),...await Promise.all(stylePaths.map(path=>readFile(path)))]);
  const calls = [], errors = [], externalRequests = [];
  let reviewStatus = 'RECEIVED', assigned = false, invitation = false, revoked = false;
  const notes = [];
  const baseSubmission = { id: 's1', childName: 'Анна', athleteId: 'a1', measurementId: 'snapshot1', measuredAt: '2026-10-19', reviewStatus, assignmentStatus: 'UNASSIGNED', definitionVersion: 'PARENT_BODY_V1', values: { m1: 60, m2: 50, m3: 65, m15: 110 }, discipline: 'RHYTHMIC_GYMNASTICS', notes: 'Комментарий родителя', warnings: [], updatedAt: 'submission-v1', provenance: { submittedAt: '2026-10-19T12:34:00Z', invitationMode: 'SHARED', locale: 'fr', units: 'in', ageYears: 14, source: 'PARENT' } };
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
      calls.push({ path: req.url, method: req.method, body });
      let result;
      if (req.url.includes('/order-tabs/')) {
        const id = req.method === 'PATCH' ? req.url.split('/').at(-1) : 'note'+(notes.length+1);
        const note = { ...body, id, createdAt: '2026-10-19T13:00:00Z', updatedAt: '2026-10-19T13:01:00Z', author: { displayName: 'Тестовый менеджер' } };
        notes.push(note); result = note;
      } else if (req.method === 'GET') result = { invitations: invitation ? [{ id: 'invite1', mode: 'SHARED', expiresAt: '2099-11-02', revokedAt: revoked ? '2026-10-19' : null, admittedCount: 0 }] : [], expectedPieces: 1, manualAthleteIds: ['a3'],
        drafts: [{ id: 'child1', revision: 2, firstName: 'Тестовая анкета', athleteId: null }], athletes: [{id:'a1',firstName:'Анна'},{id:'a2',firstName:'София'},{id:'a3',firstName:'Мария'}],
        submissions: [{ ...baseSubmission, reviewStatus, assignmentStatus: assigned ? 'ASSIGNED' : 'UNASSIGNED' }, { ...baseSubmission, id: 's2', athleteId: 'a2', childName: 'София', measurementId: 'snapshot2', hasPhoto: false, provenance: undefined, discipline: 'ACROBATIC_GYMNASTICS', values: Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['m'+(i+1), i+30])) }, { ...baseSubmission, id: 's0', measurementId: 'old-snapshot', measuredAt: '2026-09-19', definitionVersion: null, values: { m1: 59, m2: 49, m3: 64, m6: 42, m15: 109 } }] };
      else if (req.url.endsWith('/invitations')) { invitation = true; result = { id: 'invite1', url: 'http://127.0.0.1:'+server.address().port+'/parent-measurements#synthetic-token', expiresAt: '2099-11-02' }; }
      else if (req.url.endsWith('/review')) { reviewStatus = body.status; result = { ok: true }; }
      else if (req.url.endsWith('/assign')) { assigned = true; result = { instances: [] }; }
      else if (req.url.endsWith('/revoke')) { revoked = true; result = { ok: true }; }
      else if (req.url.endsWith('/bind')) result = { ok: true };
      else { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result)); return;
    }
    if (req.url === '/styles.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(css); return; }
    if (req.url === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(await readFile(resolve(artifacts, 'bundle.js'))); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });res.end('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="app" style="padding:10px"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(accept => server.listen(0, '127.0.0.1', accept));
  t.after(() => new Promise(accept => { server.closeAllConnections(); server.close(accept); }));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();page.on('pageerror', error => errors.push(error.message));page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:'+server.address().port+'/') && !request.url().startsWith('data:')) externalRequests.push(request.url()); });
  await page.goto('http://127.0.0.1:'+server.address().port);
  const workspace = page.locator('.orders-measurements-athlete-workspace');
  await expect(workspace.getByRole('heading', {name:'Анна',exact:true})).toBeVisible();
  await expect(page.locator('[data-athlete-id]')).toHaveCount(3);
  await expect(page.locator('.orders-measurements-required-grid [data-measurement-number]')).toHaveCount(4);
  await expect(page.locator('.orders-measurements-additional-grid')).toHaveCount(0);
  await expect(page.getByText('Обязательные 4/4 · Дополнительные 0/13',{exact:true}).first()).toBeVisible();
  await expect(page.locator('.orders-measurements-information').getByText('Дюймы (in)',{exact:true})).toBeVisible();
  await expect(page.locator('.orders-measurements-information').getByText('Французский',{exact:true})).toBeVisible();
  await page.getByRole('button', {name:/^Показать все/}).focus();await page.keyboard.press('Enter');
  await expect(page.locator('.orders-measurements-additional-grid [data-measurement-number]')).toHaveCount(13);
  await expect(page.locator('.orders-measurements-additional-grid [data-measurement-number="6"]')).toContainText('Не указано');
  const widths=[1920,1703,1366,1024,900,768,760,390,320];
  for (const width of widths) {
    await page.setViewportSize({width,height:width===1703?895:width===1366?768:width>=1920?1080:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no document overflow at '+width);
    if(width>=1366) assert.equal(await page.locator('.orders-measurements-columns').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),3);
    await page.screenshot({path:resolve(artifacts,'workspace-'+width+'.png'),fullPage:true});
  }
  await page.getByRole('button',{name:'Открыть отправленную форму ↗',exact:true}).click();
  const readonly=page.getByRole('dialog',{name:'Открыть отправленную форму',exact:true});
  await expect(readonly.locator('[data-measurement-number]')).toHaveCount(17);
  assert.equal(await readonly.locator('input,textarea').count(),0);await page.keyboard.press('Escape');
  await page.locator('[data-athlete-id="a2"]').click();await expect(page.locator('.orders-measurements-additional-grid [data-measurement-number]')).toHaveCount(13);
  await expect(page.locator('.orders-measurements-required-grid [data-measurement-number="1"]')).toContainText('30 см');
  for(const width of [1920,1366,768,390]){await page.setViewportSize({width,height:width===1366?768:900});await page.screenshot({path:resolve(artifacts,'workspace-full17-'+width+'.png'),fullPage:true});}
  await expect(page.locator('.orders-measurements-information').getByText('Не указано',{exact:true}).first()).toBeVisible();
  await page.locator('[data-athlete-id="a1"]').click();
  const comment=page.getByRole('textbox',{name:'Комментарий администратора',exact:true});await comment.fill('Черновик Анны');
  await page.locator('[data-athlete-id="a2"]').click();await expect(comment).toHaveValue('');await comment.fill('Комментарий Софии');
  await page.locator('.orders-measurements-comment button[type="submit"]').focus();await page.keyboard.press('Enter');await expect(comment).toHaveValue('Комментарий Софии');
  await page.locator('[data-athlete-id="a1"]').click();await expect(comment).toHaveValue('Черновик Анны');
  const commentWrite=calls.find(c=>c.path.includes('/notes'));assert.equal(commentWrite.body.athleteId,'a2');assert.equal(commentWrite.body.category,'MEASUREMENTS');assert.equal(commentWrite.body.visibility,'INTERNAL');
  await page.getByRole('button',{name:'Добавить вручную',exact:true}).click();assert.equal(await page.evaluate(()=>window.manualAthlete),'a1');
  await page.getByRole('button',{name:'Изменить замеры',exact:true}).click();assert.equal(await page.evaluate(()=>window.editorSnapshot),'snapshot1');
  await page.getByRole('button',{name:'Запросить измерения',exact:true}).click();await page.getByRole('button',{name:'Создать ссылку',exact:true}).click();
  await expect(page.getByLabel('Новая ссылка',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Показать QR-код',exact:true}).click();
  await expect(page.getByRole('img',{name:'QR-код ссылки для заполнения измерений',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Вставить в черновик переписки',exact:true}).click();assert.match(await page.evaluate(()=>window.draftText),/#synthetic-token/);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Запросить измерения',exact:true}).click();await expect(page.getByLabel('Новая ссылка',{exact:true})).toHaveValue(/#synthetic-token$/);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Запросить уточнение',exact:true}).click();await page.getByLabel('Причина / уточнение',{exact:true}).fill('Проверьте число');await page.getByRole('button',{name:'Сохранить проверку',exact:true}).click();
  await expect(workspace.getByText('Нужно уточнение',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Назначить изделиям',exact:true}).click();await page.getByLabel('Тестовый дизайн · №1 · Пошив',{exact:true}).check();
  await page.getByLabel('Подтверждаю изменение мерок для выбранных изделий в производстве',{exact:true}).check();await page.getByLabel('Причина / уточнение',{exact:true}).fill('Подтверждено представителем');
  await page.getByRole('button',{name:'Сохранить назначение',exact:true}).click();
  const assignedCall=calls.find(c=>c.path.endsWith('/assign'));assert.equal(assignedCall.body.confirmProduction,true);assert.deepEqual(assignedCall.body.targets,[{id:'piece1',expectedUpdatedAt:'piece-v1'}]);
  await expect(workspace.getByText('Назначено',{exact:true}).first()).toBeVisible();
  assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/invitations')).length,1);assert.ok(calls.every(c=>!c.path.includes('messages')));assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
  await writeFile(resolve(artifacts,'receipt.json'),JSON.stringify({provenance:'Actual isolated ParentMeasurementsPanel + MeasurementsWorkspace + MeasurementsAdminComment + Mantine; synthetic loopback API, no production writes',widths,calls,errors,externalRequests},null,2));
});
