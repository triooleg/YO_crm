import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

// Mounted public seam; all HTTP is synthetic loopback. Opt in to browser work.
test('owner history migration: role, secrets, targeting, stale responses and safe preview', {
  skip: process.env.YO_HISTORY_MIGRATION_BROWSER !== '1', timeout: 180000,
}, async t => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const web = resolve(root, 'apps/web'), out = resolve(root, '.local/history-migration-settings-browser');
  const require = createRequire(resolve(web, 'package.json'));
  const { chromium, expect } = require('@playwright/test');
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
  await writeFile(resolve(out, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';import{HistoryMigrationSettings}from'${resolve(web,'components/history-migration-settings').replaceAll('\\','/')}';function App(){const[role,setRole]=useState(new URLSearchParams(location.search).get('role')||'OWNER');return <MantineProvider theme={yoleotardTheme}><button onClick={()=>setRole('MANAGER')}>Fixture revoke role</button><HistoryMigrationSettings role={role}/></MantineProvider>}createRoot(document.getElementById('app')).render(<React.StrictMode><App/></React.StrictMode>);`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((ok, fail) => {
    const compiler = webpack({mode:'development',devtool:false,entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[resolve(web,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,use:resolve(out,'loader.cjs')}]}},(err,stats)=>compiler.close(()=>err||stats.hasErrors()?fail(err??Error(stats.toString({all:false,errors:true}))):ok()));
  });
  const css = Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')), await readFile(resolve(web,'app/styles.css'))]);
  const calls = [], errors = [], external = [];

  let missing = false, rejectWrite = false, redirectWrite = false, delayPath = '', release;
  let tokenSequence = 0, previewOverride = null;
  const job = id => ({jobId:id,status:'STAGING',source:'KEYCRM',account:'Synthetic atelier',channel:'INSTAGRAM',batchCount:2,messageCount:7,payloadBytes:1234,agentRevision:1,agentExpiresAt:null,importEnabled:false,createdAt:'2026-10-29T00:00:00Z'});
  const details = Object.fromEntries(['job-a','job-b','job-old'].map(id=>[id,{...job(id),planningEnabled:true,agentPaired:true,dialogs:[{dialogueId:'dialogue-'+id,channel:'INSTAGRAM',messageCount:7}],targets:[]}]));
  const operationalStates = {};
  const operationalPreview = {previewDigest:'a'.repeat(64),sourceDigest:'b'.repeat(64),clientId:'cfixture00000000000000001',preview:{discovered:7,newCandidates:5,alreadyExists:2,review:0,conflicts:0,blockers:[],sourceCompleteness:'UNVERIFIED'}};
  const server = createServer(async (req,res) => {
    const url=new URL(req.url,'http://127.0.0.1');
    const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if (url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
      calls.push({path:req.url,method:req.method,body});
      if(missing)return send({message:'Fixture not installed'},404);
      if(req.url===delayPath)await new Promise(ok=>{release=ok;});
      if(req.method==='POST'&&redirectWrite&&url.pathname.includes('/jobs/')){res.writeHead(307,{location:'/api/redirect-capture'});res.end();return;}
      if(req.method==='POST'&&rejectWrite)return send({message:'source_key=fixture-private-key currentPassword='+body.currentPassword},403);
      if(url.pathname==='/api/admin/history-migration/jobs'&&req.method==='GET')return send({jobs:[job(url.searchParams.has('cursor')?'job-b':'job-a')],nextCursor:url.searchParams.has('cursor')?null:'opaque +/cursor'});
      if(url.pathname==='/api/admin/history-migration/jobs'&&req.method==='POST'){details['job-created']={...job('job-created'),channel:body.channel,planningEnabled:true,agentPaired:false,dialogs:[],targets:[]};const {createdAt,...created}=details['job-created'];return send(created);}
      if(url.pathname==='/api/clients')return send(Array.from({length:61},(_,i)=>({id:'cfixture0000000000000000'+i,displayName:'Synthetic candidate '+i,archivedAt:i===0?'2026-10-01':null})));
      const match=url.pathname.match(/^\/api\/admin\/history-migration\/jobs\/([^/]+)(.*)$/);
      if(match){
        const [,id,suffix]=match;
        if(!suffix)return send(details[id]??{...job(id),planningEnabled:true,agentPaired:false,dialogs:[],targets:[]});
        if(suffix==='/operational/status')return send(operationalStates[id]??{enabled:true,prepared:false,expiresAt:null,grantReady:false,previewDigest:null,run:null});
        if(suffix==='/operational/preview')return send(operationalPreview);
        if(suffix==='/operational/prepare'){
          operationalStates[id]={enabled:true,prepared:true,expiresAt:new Date(Date.now()+600000).toISOString(),grantReady:true,previewDigest:'a'.repeat(64),run:null};return send(operationalPreview);
        }
        if(suffix==='/operational/apply'){
          details[id].intakeLocked=true;details[id].operationalApplied=true;
          operationalStates[id]={enabled:true,prepared:false,expiresAt:null,grantReady:false,previewDigest:null,run:{runId:'run-fixture',status:'APPLIED',added:5}};
          return send({runId:'run-fixture',added:5,alreadyExists:2,replayed:false,productionImport:true});
        }
        if(suffix==='/operational/runs/run-fixture/rollback'){
          details[id].operationalApplied=false;operationalStates[id].run.status='ROLLED_BACK';return send({rolledBack:true});
        }
        if(suffix==='/pair')return send({jobId:id,token:'fixture-pair-secret-'+(++tokenSequence),expiresAt:'2026-10-30T00:00:00Z',importEnabled:false});
        if(suffix==='/targets/resolve')return send({status:'MATCH',clientId:'cfixture00000000000000001',candidates:[{clientId:'cfixture00000000000000001',displayName:'Synthetic contact match',archived:false}],persisted:false});
        if(suffix==='/targets'){details[id].targets=[{targetId:'target-1',dialogueId:body.dialogueId,mode:body.mode,clientId:body.clientId??null,revision:1}];return send({});}
        if(suffix==='/dry-run' && previewOverride)return send(previewOverride);
        if(suffix==='/dry-run')return send({previewDigest:'fixture-digest',crmCompared:id!=='job-b',sourceCompleteness:'UNVERIFIED',discovered:7,newCandidates:5,alreadyExists:1,review:1,conflicts:0,blockers:['fixture-private-key'],productionBlockers:['IMPORT_DISABLED'],importEnabled:false,addedToCrm:0,targets:[],actions:[]});
        if(suffix==='/revoke'){details[id].agentPaired=false;return send({});}
        if(suffix==='/close'){details[id].status='CLOSED';return send({});}
      }
      return send({},501);
    }
    if(req.url==='/bundle.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await readFile(resolve(out,'bundle.js')));return;}
    if(req.url==='/styles.css'){res.writeHead(200,{'content-type':'text/css'});res.end(css);return;}
    if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
    res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="app" style="padding:16px;max-width:1200px;margin:auto"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+server.address().port;
  const browser = await chromium.launch({headless:true});
  t.after(async()=>{release?.();await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));await writeFile(resolve(out,'evidence.json'),JSON.stringify({provenance:'Mounted component, real Mantine/theme/CSS; synthetic loopback API only. No real customer content, source service, production or backend validation.',calls:calls.map(({path,method})=>({path,method})),errors,external},null,2));});
  const page = await browser.newPage();page.setDefaultTimeout(6000);
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(external.push(route.request().url()),route.abort()));
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.fetchMetadata=[];window.clipboardCopies=[];
    const originalFetch=window.fetch;
    window.fetch=(url,init)=>{window.fetchMetadata.push({url,credentials:init?.credentials,method:init?.method,redirect:init?.redirect});return originalFetch(url,window.ignoreAbort?{...init,signal:undefined}:init);};
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.clipboardCopies.push(value);}}});
  });
  const button = name => page.getByRole('button',{name,exact:true});
  const password = () => page.getByLabel('Текущий пароль владельца', {exact:false});
  const posts = () => calls.filter(c=>c.method==='POST');
  async function selectJob(id) {
    await page.getByRole('combobox',{name:'Задание переноса',exact:true}).click();
    await page.getByRole('option').filter({hasText:id}).click();
    await expect(button('Сопрячь агента')).toBeVisible();
  }
  async function selectDialogue(id) {
    await page.getByRole('combobox',{name:'Исходный диалог',exact:true}).click();
    await page.getByRole('option').filter({hasText:'dialogue-'+id}).click();
  }
  await t.test('non-owner never mounts or fetches', async()=>{
    for(const role of ['ADMIN','MANAGER','PRODUCTION','']){
      await page.goto(base+'/?role='+encodeURIComponent(role||'PRODUCTION'));
      await expect(page.getByRole('heading',{name:'Перенос истории переписки'})).toHaveCount(0);
    }
    assert.equal(calls.length,0);
  });
  await t.test('bounded pages are manual and deep links load jobs outside the page',async()=>{
    await page.goto(base+'/?jobId=job-old');
    await expect(page.getByRole('combobox',{name:'Задание переноса',exact:true})).toHaveValue(/job-old/);
    assert.ok(calls.some(c=>c.path.endsWith('/jobs/job-old')));
    assert.equal(calls.filter(c=>c.path.includes('?cursor=')).length,0);
    await button('Загрузить ещё задания').click();
    await expect(button('Загрузить ещё задания')).toHaveCount(0);
    assert.equal(calls.filter(c=>c.path.includes('?cursor=')).length,1);
    assert.ok(calls.some(c=>c.path.endsWith('?cursor=opaque%20%2B%2Fcursor')));
    assert.equal(posts().length,0);
    await selectJob('job-a');
  });
  await t.test('OWNER detail mounts the operational panel while preparation copy makes no global disabled claim',async()=>{
    await expect(page.getByRole('heading',{name:'Импорт выбранной истории',exact:true})).toBeVisible();
    await expect(page.getByText('Подготовка и предварительная проверка не добавляют сообщения в CRM. Применение истории выполняется отдельно после проверки готовности и подтверждения владельцем.',{exact:true})).toBeVisible();
    assert.equal((await page.locator('body').innerText()).includes('Импорт отключён'),false);
    await expect(button('Применить импорт')).toBeDisabled();
    assert.equal(posts().some(c=>/\/operational\/(prepare|apply)$|\/rollback$/.test(c.path)),false);
  });
  await t.test('unsupported EMAIL makes no operational requests while legacy planning remains available',async()=>{
    details['job-email']={...details['job-a'],jobId:'job-email',channel:'EMAIL'};
    const before=calls.filter(c=>c.path.includes('/operational/')).length;
    await page.getByLabel('ID задания',{exact:true}).fill('job-email');await button('Открыть задание по ID').click();
    await expect(button('Сопрячь агента')).toBeVisible();
    await expect(page.getByRole('heading',{name:'Импорт выбранной истории',exact:true})).toHaveCount(0);
    await expect(button('Проверить без импорта')).toBeEnabled();
    assert.equal(calls.filter(c=>c.path.includes('/operational/')).length,before);
    await selectJob('job-a');
  });
  await t.test('pairing password is cleared on failure; no echoed private source keys/errors',async()=>{
    await button('Сопрячь агента').click();await password().fill('fixture-owner-password');
    rejectWrite=true;await button('Подтвердить действие').click();
    await expect(password()).toHaveValue('');
    await expect(page.getByRole('dialog')).toContainText('Не удалось выполнить действие');
    assert.equal((await page.locator('body').innerText()).includes('fixture-private-key'),false);
    assert.equal((await page.content()).includes('fixture-owner-password'),false);
    await expect(button('Подтвердить действие')).toBeDisabled();rejectWrite=false;
    await password().fill('fixture-fresh-password');await button('Подтвердить действие').click();
    await expect(page.getByLabel('Токен сопряжения',{exact:true})).toHaveValue('fixture-pair-secret-1');
    assert.equal(await page.getByLabel('Токен сопряжения',{exact:true}).getAttribute('type'),'password');
    await page.setViewportSize({width:390,height:844});
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.screenshot({path:resolve(out,'pairing-390.png'),fullPage:false,animations:'disabled'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.setViewportSize({width:1366,height:768});
    await button('Копировать токен').click();
    assert.deepEqual(await page.evaluate(()=>window.clipboardCopies),['fixture-pair-secret-1']);
    assert.deepEqual(await page.evaluate(()=>[Object.keys(localStorage),Object.keys(sessionStorage)]),[[],[]]);
    assert.ok(!page.url().includes('secret'));
    await button('Закрыть и очистить токен').last().click();
    await expect(page.getByLabel('Токен сопряжения',{exact:true})).toHaveCount(0);
    assert.equal((await page.content()).includes('fixture-pair-secret-1'),false);
    await button('Сопрячь агента').click();await expect(password()).toHaveValue('');
    await button('Отмена').last().click();
  });
  await t.test('password-bearing requests never follow redirects',async()=>{
    await button('Сопрячь агента').click();await password().fill('fixture-redirect-password');
    redirectWrite=true;await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toContainText('Не удалось выполнить действие');
    await expect(password()).toHaveValue('');
    assert.equal(calls.some(c=>c.path==='/api/redirect-capture'),false);
    redirectWrite=false;await button('Отмена').last().click();
  });
  await t.test('contact resolution never binds until explicit choice and fresh password',async()=>{
    await selectDialogue('job-a');
    await page.getByLabel('Email для проверки',{exact:true}).fill('fixture@example.invalid');
    const before=posts().length;await button('Проверить контакты').click();
    await expect(page.getByText('Выберите клиента явно.',{exact:false})).toBeVisible();
    assert.equal(posts().length,before+1);
    await expect(button('Сохранить назначение')).toBeDisabled();
    await page.getByRole('radio',{name:/Synthetic contact match/}).check();
    await button('Сохранить назначение').click();await expect(password()).toHaveValue('');
    await password().fill('fixture-target-password');await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const target=calls.findLast(c=>c.path.endsWith('/targets'));
    assert.deepEqual(target.body,{dialogueId:'dialogue-job-a',mode:'EXISTING',clientId:'cfixture00000000000000001',currentPassword:'fixture-target-password'});
  });
  await t.test('manual name search requires two chars, bounds 50 and does not select a match',async()=>{
    const searches=()=>calls.filter(c=>c.path.startsWith('/api/clients')).length;
    const before=searches();
    await page.getByLabel('Имя для ручного поиска',{exact:true}).fill('S');
    await expect(button('Найти по имени')).toBeDisabled();assert.equal(searches(),before);
    await page.getByLabel('Имя для ручного поиска',{exact:true}).fill('Synthetic');
    assert.equal(searches(),before);await button('Найти по имени').click();
    await expect(page.getByRole('radio')).toHaveCount(50);
    await expect(page.getByRole('radio').first()).toBeDisabled();
    await expect(button('Сохранить назначение')).toBeDisabled();
    await page.getByRole('radio').nth(1).check();
    await button('Сохранить назначение').click();await expect(password()).toHaveValue('');await button('Отмена').last().click();
  });
  await t.test('proposal requires owner attestation and creates no client',async()=>{
    await page.getByLabel('Подготовить предложение нового клиента',{exact:true}).check();
    await page.getByLabel('Идентификатор субъекта',{exact:true}).fill('fixture-subject');
    await page.getByLabel('Имя для предложения',{exact:true}).fill('Synthetic proposed person');
    await expect(button('Сохранить назначение')).toBeDisabled();
    await page.getByRole('checkbox',{name:/Подтверждаю проверку личности/}).check();
    await button('Сохранить назначение').click();await password().fill('fixture-proposal-password');await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const saved=calls.findLast(c=>c.path.endsWith('/targets')).body;
    assert.equal(saved.mode,'CREATE_PROPOSAL');assert.equal(saved.ownerAttested,true);assert.equal(saved.subjectId,'fixture-subject');
    assert.equal(calls.some(c=>c.path==='/api/clients'&&c.method==='POST'),false);
  });
  await t.test('legacy preview stays read-only beside the operational panel; responsive screenshots',async()=>{
    await expect(page.getByText('Подготовительное действие подтверждено сервером. Оно не добавляет сообщения в CRM.',{exact:true})).toBeVisible();
    await button('Проверить без импорта').click();
    await expect(page.getByText('Добавлено этой предварительной проверкой: 0.',{exact:true})).toBeVisible();
    await expect(page.getByText('Эта предварительная проверка содержит ограничения или неподтверждённые данные.',{exact:true})).toBeVisible();
    await expect(page.getByText('Ограничения этой проверки: 1',{exact:true})).toBeVisible();
    await expect(page.getByText('Обнаружено: 7',{exact:true})).toBeVisible();
    assert.equal((await page.locator('body').innerText()).includes('fixture-private-key'),false);
    await expect(button('Применить импорт')).toBeDisabled();await expect(button('Подготовить импорт')).toBeDisabled();
    await button('Проверить перед импортом').click();await expect(button('Подготовить импорт')).toBeEnabled();await expect(button('Применить импорт')).toBeDisabled();
    assert.equal((await page.locator('body').innerText()).includes('Импорт отключён'),false);
    assert.deepEqual(calls.findLast(c=>c.path.endsWith('/operational/preview')).body,{});
    assert.equal(posts().some(c=>/\/operational\/(prepare|apply)$|\/rollback$/.test(c.path)),false);
    for(const [width,height] of [[1920,1080],[1366,768],[390,844]]){
      await page.setViewportSize({width,height});
      await page.screenshot({path:resolve(out,'preview-'+width+'.png'),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    await page.setViewportSize({width:1366,height:768});
    await selectJob('job-b');await expect(page.getByRole('heading',{name:'Предварительная проверка',exact:true})).toHaveCount(0);
    await button('Проверить без импорта').click();
    await expect(page.getByText('Обнаружено: Неизвестно',{exact:true})).toBeVisible();
  });
  await t.test('successful dry-run copy does not imply operational apply or deny the separate capability',async()=>{
    previewOverride={previewDigest:'fixture-digest',crmCompared:true,sourceCompleteness:'UNVERIFIED',discovered:7,newCandidates:5,alreadyExists:2,review:0,conflicts:0,blockers:[],productionBlockers:[],importEnabled:false,addedToCrm:0};
    await button('Проверить без импорта').click();
    await expect(page.getByText('Предварительная проверка получена. Для применения истории требуется отдельное подтверждение владельца.',{exact:true})).toBeVisible();
    await expect(page.getByText('Добавлено этой предварительной проверкой: 0.',{exact:true})).toBeVisible();
    await expect(button('Применить импорт')).toBeDisabled();previewOverride=null;
  });
  await t.test('malformed preview cannot claim known zero additions',async()=>{
    previewOverride={crmCompared:true,sourceCompleteness:'UNVERIFIED',discovered:-1,blockers:[],productionBlockers:[],importEnabled:true,addedToCrm:9};
    await button('Проверить без импорта').click();
    await expect(page.getByText('Добавлено этой предварительной проверкой: 0.',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Результат этой предварительной проверки не подтверждён.',{exact:true})).toBeVisible();
    await expect(page.getByText('Обнаружено: Неизвестно',{exact:true})).toBeVisible();
    previewOverride=null;
  });
  await t.test('late detail and dry-run cannot cross job context, even if transport ignores abort',async()=>{
    await page.evaluate(()=>{window.ignoreAbort=true;});
    delayPath='/api/admin/history-migration/jobs/job-a';
    // Use the ID field because selection remains available while a read is pending.
    await page.getByLabel('ID задания',{exact:true}).fill('job-a');await button('Открыть задание по ID').click();
    await expect.poll(()=>typeof release).toBe('function');
    await page.getByRole('combobox',{name:'Задание переноса',exact:true}).click();await page.getByRole('option').filter({hasText:'job-b'}).click();
    await expect(button('Сопрячь агента')).toBeVisible();delayPath='';release();release=undefined;
    await expect(page.getByRole('combobox',{name:'Задание переноса',exact:true})).toHaveValue(/job-b/);
    delayPath='/api/admin/history-migration/jobs/job-b/dry-run';
    await button('Проверить без импорта').click();await expect.poll(()=>typeof release).toBe('function');
    await page.getByRole('combobox',{name:'Задание переноса',exact:true}).click();await page.getByRole('option').filter({hasText:'job-a'}).click();
    await expect(button('Сопрячь агента')).toBeVisible();delayPath='';release();release=undefined;
    await expect(page.getByRole('heading',{name:'Предварительная проверка',exact:true})).toHaveCount(0);
  });
  await t.test('double submit locks, closing pairing discards late secret, role revocation unmounts',async()=>{
    delayPath='/api/admin/history-migration/jobs/job-a/pair';
    await button('Сопрячь агента').click();await password().fill('fixture-double-password');
    const before=posts().filter(c=>c.path.endsWith('/pair')).length;
    await button('Подтвердить действие').evaluate(el=>{el.click();el.click();});
    await expect.poll(()=>typeof release).toBe('function');await expect(password()).toHaveValue('');
    assert.equal(posts().filter(c=>c.path.endsWith('/pair')).length,before+1);
    await button('Отмена').last().click();delayPath='';release();release=undefined;
    await expect(page.getByLabel('Токен сопряжения',{exact:true})).toHaveCount(0);
    await button('Сопрячь агента').click();await password().fill('fixture-revoked-password');
    await page.keyboard.press('Escape');await button('Fixture revoke role').click();
    await expect(page.getByRole('heading',{name:'Перенос истории переписки'})).toHaveCount(0);
    assert.equal((await page.content()).includes('fixture-revoked-password'),false);
  });
  await t.test('APPLIED refreshes owner lifecycle without navigation; rollback retains intake lock but allows close',async()=>{
    details['job-lifecycle']={...details['job-a'],jobId:'job-lifecycle',dialogs:[{dialogueId:'dialogue-job-lifecycle',channel:'INSTAGRAM',messageCount:7}],targets:[]};
    await page.goto(base+'/?jobId=job-lifecycle');
    await expect(button('Сопрячь агента')).toBeEnabled(); // Optional flags absent: legacy contract.
    await expect(button('Закрыть задание')).toBeEnabled();
    await button('Проверить перед импортом').click();await expect(button('Подготовить импорт')).toBeEnabled();
    await button('Подготовить импорт').click();await password().fill('fixture-prepare-lifecycle');await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await button('Обновить статус').click();await expect(button('Применить импорт')).toBeEnabled();
    const beforeDetail=calls.filter(c=>c.path.endsWith('/jobs/job-lifecycle')&&c.method==='GET').length;
    await page.evaluate(()=>{window.lifecycleDocument='same-document';});
    await button('Применить импорт').click();await password().fill('fixture-apply-lifecycle');
    await page.getByLabel('Подтверждаю импорт для одного выбранного клиента по указанным счётчикам.',{exact:true}).check();
    await button('Подтвердить действие').click();
    await expect(button('Откатить исторический импорт')).toBeVisible();
    await expect(button('Сопрячь агента')).toBeDisabled();
    await expect(button('Закрыть задание')).toBeDisabled();
    await expect(button('Отозвать сопряжение')).toBeEnabled();
    await expect(button('Проверить без импорта')).toBeEnabled();
    assert.ok(calls.filter(c=>c.path.endsWith('/jobs/job-lifecycle')&&c.method==='GET').length>beforeDetail);
    assert.equal(await page.evaluate(()=>window.lifecycleDocument),'same-document');
    assert.equal((await page.content()).includes('fixture-apply-lifecycle'),false);
    await selectDialogue('job-lifecycle');
    await page.getByLabel('Email для проверки',{exact:true}).fill('fixture@example.invalid');await button('Проверить контакты').click();
    await page.getByRole('radio',{name:/Synthetic contact match/}).check();
    await expect(button('Сохранить назначение')).toBeDisabled();
    const mutationCount=posts().filter(c=>/\/(pair|targets|close)$/.test(c.path)).length;
    // Disabled DOM controls cannot dispatch the forbidden intake mutations.
    await button('Сопрячь агента').evaluate(el=>el.click());await button('Сохранить назначение').evaluate(el=>el.click());await button('Закрыть задание').evaluate(el=>el.click());
    assert.equal(posts().filter(c=>/\/(pair|targets|close)$/.test(c.path)).length,mutationCount);
    await button('Проверить без импорта').click();await expect(page.getByRole('heading',{name:'Предварительная проверка',exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:resolve(out,'lifecycle-applied-390.png'),fullPage:true,animations:'disabled'});
    await button('Откатить исторический импорт').click();await expect(password()).toHaveValue('');
    await password().fill('fixture-rollback-lifecycle');
    await page.getByLabel('Подтверждаю откат только этого исторического импорта.',{exact:true}).check();
    const beforeRollbackDetail=calls.filter(c=>c.path.endsWith('/jobs/job-lifecycle')&&c.method==='GET').length;
    await button('Подтвердить действие').click();
    await expect(button('Закрыть задание')).toBeEnabled();await expect(button('Сопрячь агента')).toBeDisabled();
    await expect(button('Отозвать сопряжение')).toBeEnabled();await expect(button('Проверить без импорта')).toBeEnabled();
    await expect(page.getByRole('heading',{name:'Импорт выбранной истории',exact:true})).toBeVisible();
    await expect(button('Откатить исторический импорт')).toHaveCount(0);
    assert.ok(calls.filter(c=>c.path.endsWith('/jobs/job-lifecycle')&&c.method==='GET').length>beforeRollbackDetail);
    assert.equal(await page.evaluate(()=>window.lifecycleDocument),'same-document');
    assert.equal((await page.content()).includes('fixture-rollback-lifecycle'),false);
    await button('Отозвать сопряжение').click();await expect(password()).toHaveValue('');
    await password().fill('fixture-revoke-locked');await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(button('Отозвать сопряжение')).toBeDisabled();
    await expect(button('Сопрячь агента')).toBeDisabled();await expect(button('Закрыть задание')).toBeEnabled();
    await button('Закрыть задание').click();await expect(password()).toHaveValue('');
    await password().fill('fixture-close-rolledback');await button('Подтвердить действие').click();
    await expect(button('Сопрячь агента')).toHaveCount(0);
    assert.equal(details['job-lifecycle'].status,'CLOSED');assert.equal(details['job-lifecycle'].intakeLocked,true);
    await page.setViewportSize({width:1366,height:768});
  });
  await t.test('creation, revoke and close all require fresh passwords; 404 disables writes',async()=>{
    await page.goto(base);await selectJob('job-a');
    await button('Создать задание').click();
    await page.getByLabel('Аккаунт KeyCRM',{exact:false}).fill('Synthetic new');await page.getByRole('combobox',{name:'Канал источника',exact:true}).click();await page.getByRole('option',{name:'Электронная почта',exact:true}).click();
    await password().fill('fixture-create-password');await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const create=calls.findLast(c=>c.path.endsWith('/jobs')&&c.method==='POST');assert.equal(create.body.source,'KEYCRM');assert.equal(create.body.account,'Synthetic new');
    assert.ok(calls.some(c=>c.path.endsWith('/jobs/job-created')&&c.method==='GET'));
    await expect(page.getByRole('combobox',{name:'Задание переноса',exact:true})).toHaveValue(/job-created/);
    await selectJob('job-a');await button('Отозвать сопряжение').click();await expect(password()).toHaveValue('');await password().fill('fixture-revoke-password');await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(button('Отозвать сопряжение')).toBeDisabled();
    await button('Закрыть задание').click();await expect(password()).toHaveValue('');await password().fill('fixture-close-password');await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(button('Сопрячь агента')).toHaveCount(0);await expect(button('Проверить без импорта')).toBeDisabled();
    await expect(page.getByRole('heading',{name:'Импорт выбранной истории',exact:true})).toHaveCount(0);
    missing=true;await button('Обновить вручную').click();await expect(page.getByText(/Сервер переноса истории недоступен/)).toBeVisible();
    await expect(button('Создать задание')).toHaveCount(0);await expect(button('Сохранить назначение')).toHaveCount(0);
    await page.screenshot({path:resolve(out,'unavailable-1366.png'),fullPage:true});
    assert.ok((await page.evaluate(()=>window.fetchMetadata)).every(row=>row.credentials==='include'&&row.redirect==='error'));
    assert.deepEqual(await page.evaluate(()=>[Object.keys(localStorage),Object.keys(sessionStorage)]),[[],[]]);
  });
  assert.ok(posts().every(({body})=>!Object.hasOwn(body??{},'intakeLocked')&&!Object.hasOwn(body??{},'operationalApplied')));
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
