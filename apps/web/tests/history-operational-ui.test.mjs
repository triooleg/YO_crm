import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createServer} from 'node:http';

const require=createRequire(import.meta.url),ts=require('typescript');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),web=resolve(root,'apps/web');
const source=readFileSync(resolve(web,'lib/history-operational-api.ts'),'utf8');
const module={exports:{}};
vm.runInThisContext(`(function(module,exports){${ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText}\n})`)(module,module.exports);
const {createHistoryOperationalApi}=module.exports;
const digest='a'.repeat(64),sourceDigest='b'.repeat(64);
const preview=(changes={})=>({previewDigest:digest,sourceDigest,clientId:'synthetic-client',preview:{discovered:7,newCandidates:5,alreadyExists:2,review:0,conflicts:0,blockers:[],sourceCompleteness:'UNVERIFIED',...changes}});
const status=(changes={})=>({enabled:true,prepared:false,expiresAt:null,grantReady:false,previewDigest:null,run:null,...changes});
const ready=()=>status({prepared:true,expiresAt:new Date(Date.now()+60000).toISOString(),grantReady:true,previewDigest:digest});
const ok=value=>({ok:true,status:200,json:async()=>value});

test('preview is an explicit empty POST with cookie auth, no-store, redirect refusal and abort signal',async()=>{
  const calls=[],abort=new AbortController();
  const api=createHistoryOperationalApi(async(path,init)=>{calls.push({path,init});return ok(preview());});
  assert.deepEqual(await api.preview('job-a',abort.signal),preview());
  assert.equal(calls[0].path,'/api/admin/history-migration/jobs/job-a/operational/preview');
  assert.equal(calls[0].init.method,'POST');assert.deepEqual(JSON.parse(calls[0].init.body),{});
  assert.equal(calls[0].init.credentials,'include');assert.equal(calls[0].init.cache,'no-store');
  assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.signal,abort.signal);
});

test('reauthenticated operations send only their fixed contract and never grant, alias or database parameters',async()=>{
  const calls=[],abort=new AbortController();
  const api=createHistoryOperationalApi(async(path,init)=>{
    calls.push({path,init});return ok(path.endsWith('/prepare')?preview():path.endsWith('/rollback')?{rolledBack:true}:path.endsWith('/status')?status():{runId:'run-a',added:5,alreadyExists:2,replayed:false,productionImport:true});
  });
  await api.prepare('job-a','synthetic-one',abort.signal);
  await api.status('job-a',abort.signal);
  await api.apply('job-a',digest,'synthetic-two',abort.signal);
  await api.rollback('job-a','run-a','synthetic-three',abort.signal);
  assert.deepEqual(JSON.parse(calls[0].init.body),{currentPassword:'synthetic-one'});
  assert.equal(calls[1].init.method,'GET');assert.equal(calls[1].init.body,undefined);
  assert.deepEqual(JSON.parse(calls[2].init.body),{previewDigest:digest,currentPassword:'synthetic-two'});
  assert.equal(calls[3].path,'/api/admin/history-migration/jobs/job-a/operational/runs/run-a/rollback');
  assert.deepEqual(JSON.parse(calls[3].init.body),{currentPassword:'synthetic-three'});
  assert.ok(calls.every(({init})=>init.credentials==='include'&&init.cache==='no-store'&&init.redirect==='error'&&init.signal===abort.signal));
});

test('HTTP failures never consume secret-bearing error bodies, and malformed successful replies fail closed',async()=>{
  let reads=0;
  const failed=createHistoryOperationalApi(async()=>({ok:false,status:403,json:async()=>{reads++;return {message:'synthetic-password-echo'};}}));
  await assert.rejects(failed.prepare('job-a','synthetic-password',new AbortController().signal),error=>error.message==='HISTORY_OPERATIONAL_REQUEST_FAILED');
  assert.equal(reads,0);
  for(const invalid of [preview({newCandidates:-1}),preview({review:null}),preview({blockers:'bad'}),preview({sourceCompleteness:'COMPLETE'})]){
    const api=createHistoryOperationalApi(async()=>ok(invalid));
    await assert.rejects(api.preview('job-a',new AbortController().signal));
  }
  const api=createHistoryOperationalApi(async()=>ok({...status(),grantId:'not-client-state',databaseUrl:'not-client-state'}));
  assert.deepEqual(await api.status('job-a',new AbortController().signal),status());
});

test('bad routing or missing fresh password cannot reach fetch',()=>{
  let calls=0;const api=createHistoryOperationalApi(async()=>{calls++;return ok({});}),signal=new AbortController().signal;
  for(const jobId of ['../job','job/a','job?grant=secret',''])assert.throws(()=>api.preview(jobId,signal));
  assert.throws(()=>api.prepare('job-a','',signal));assert.throws(()=>api.apply('job-a','invalid-digest','password',signal));
  assert.throws(()=>api.rollback('job-a','../run','password',signal));assert.equal(calls,0);
});

test('mounted operational pilot uses real Mantine interactions and a synthetic owner-only integration fixture',{
  skip:process.env.YO_HISTORY_OPERATIONAL_BROWSER!=='1',timeout:180000,
},async t=>{
  const browserRequire=createRequire(resolve(web,'package.json')),{chromium,expect}=browserRequire('@playwright/test');
  const out=resolve(root,'.local/history-operational-ui-browser');await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'loader.cjs'),`const ts=require(${JSON.stringify(browserRequire.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
  await writeFile(resolve(out,'entry.tsx'),`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';import{HistoryOperationalPilot}from'${resolve(web,'components/history-operational-pilot').replaceAll('\\','/')}';function App(){const[job,setJob]=useState('job-a'),[enabled,setEnabled]=useState(true),[owner,setOwner]=useState(new URLSearchParams(location.search).get('role')!=='MANAGER');return <MantineProvider theme={yoleotardTheme}><button onClick={()=>setJob(x=>x==='job-a'?'job-b':'job-a')}>Fixture switch job</button><button onClick={()=>setEnabled(x=>!x)}>Fixture disable</button><button onClick={()=>setOwner(false)}>Fixture revoke owner</button>{owner&&<HistoryOperationalPilot jobId={job} enabled={enabled} onImported={()=>{window.imported=(window.imported||0)+1}}/>}</MantineProvider>}createRoot(document.getElementById('app')).render(<React.StrictMode><App/></React.StrictMode>);`);
  const webpack=browserRequire('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((ok,fail)=>{const compiler=webpack({mode:'development',devtool:false,entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[resolve(web,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,use:resolve(out,'loader.cjs')}]}},(err,stats)=>compiler.close(()=>err||stats.hasErrors()?fail(err??Error(stats.toString({all:false,errors:true}))):ok()));});
  const css=Buffer.concat([await readFile(browserRequire.resolve('@mantine/core/styles.css')),await readFile(resolve(web,'app/styles.css'))]);
  const calls=[],pageErrors=[],consoleErrors=[],external=[];
  let currentStatus=status(),currentPreview=preview(),rejectWrite=false,redirectWrite=false,delaySuffix='',release;
  function reset(){currentStatus=status();currentPreview=preview();rejectWrite=false;redirectWrite=false;delaySuffix='';release=undefined;calls.length=0;}
  const server=createServer(async(req,res)=>{
    const send=(body,code=200)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(body));};
    if(req.url.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
      calls.push({path:req.url,method:req.method,body});
      const oldStatus=structuredClone(currentStatus),oldPreview=structuredClone(currentPreview);
      if(delaySuffix&&req.url.endsWith(delaySuffix))await new Promise(ok=>{release=ok;});
      if(req.method==='POST'&&redirectWrite){res.writeHead(307,{location:'/api/redirect-capture'});res.end();return;}
      if(req.method==='POST'&&rejectWrite)return send({message:'fixture-private-echo '+body.currentPassword,grantId:'fixture-private-grant'},403);
      if(req.url.endsWith('/status'))return send(oldStatus);
      if(req.url.endsWith('/preview'))return send(oldPreview);
      if(req.url.endsWith('/prepare')){currentStatus=status({prepared:true,expiresAt:new Date(Date.now()+60000).toISOString(),previewDigest:digest});return send(currentPreview);}
      if(req.url.endsWith('/apply')){const replayed=currentPreview.preview.newCandidates===0;currentStatus=status({run:{runId:'run-a',status:'APPLIED',added:replayed?0:5}});return send({runId:'run-a',added:replayed?0:5,alreadyExists:2,replayed,productionImport:true});}
      if(req.url.endsWith('/rollback')){currentStatus=status({run:{runId:'run-a',status:'ROLLED_BACK',added:5}});return send({rolledBack:true});}
      return send({},501);
    }
    if(req.url==='/bundle.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await readFile(resolve(out,'bundle.js')));return;}
    if(req.url==='/styles.css'){res.writeHead(200,{'content-type':'text/css'});res.end(css);return;}
    if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
    res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="app" style="padding:16px;max-width:1100px;margin:auto"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{release?.();await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));await writeFile(resolve(out,'receipt.json'),JSON.stringify({scope:'Mounted real component/Mantine/theme, synthetic loopback only; no production evidence',pageErrors,consoleErrors,external,requests:calls.map(({path,method})=>({path,method}))},null,2));});
  const page=await browser.newPage();page.setDefaultTimeout(6000);
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(external.push(route.request().url()),route.abort()));
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('console',message=>{if(message.type()==='error'&&!/Failed to load resource|net::ERR_FAILED/.test(message.text()))consoleErrors.push(message.text());});
  await page.addInitScript(()=>{window.fetchMetadata=[];window.fetchSignals=[];const original=window.fetch;window.fetch=(url,init)=>{window.fetchSignals.push(init?.signal);window.fetchMetadata.push({path:url,method:init?.method,credentials:init?.credentials,cache:init?.cache,redirect:init?.redirect});return original(url,window.ignoreAbort?{...init,signal:undefined}:init);};});
  const button=name=>page.getByRole('button',{name,exact:true}),pw=()=>page.getByLabel('Текущий пароль владельца',{exact:false});
  const posts=suffix=>calls.filter(row=>row.method==='POST'&&(!suffix||row.path.endsWith(suffix)));
  async function start(){await page.goto(base);await expect(button('Проверить перед импортом')).toBeEnabled();}
  async function inspect(){await button('Проверить перед импортом').click();await expect(button('Подготовить импорт')).toBeEnabled();}

  await t.test('owner mounting gate and disabled prop have no hidden requests',async()=>{
    reset();await page.goto(base+'/?role=MANAGER');await expect(page.getByRole('heading',{name:'Импорт выбранной истории'})).toHaveCount(0);assert.equal(calls.length,0);
    await start();await button('Fixture disable').click();await expect(page.getByRole('heading',{name:'Импорт выбранной истории'})).toHaveCount(0);
    const total=calls.length;await page.waitForTimeout(150);assert.equal(calls.length,total);
  });
  await t.test('preview, keyboard focus/cancel, fresh prepare password, waiting without polling and apply confirmation',async()=>{
    reset();await page.setViewportSize({width:1440,height:1000});await start();await inspect();await page.screenshot({path:resolve(out,'desktop-preview.png'),fullPage:true});assert.equal(posts('/preview').length,1);assert.deepEqual(posts('/preview')[0].body,{});
    await expect(page.getByText('Полнота исходной истории не подтверждена.',{exact:false})).toBeVisible();await expect(button('Применить импорт')).toBeDisabled();
    await button('Подготовить импорт').focus();await page.keyboard.press('Enter');await expect(pw()).toBeFocused();await pw().fill('fixture-cancel-secret');await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(button('Подготовить импорт')).toBeFocused();
    await button('Подготовить импорт').click();await expect(pw()).toHaveValue('');await pw().fill('fixture-prepare');await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(button('Обновить статус')).toBeFocused();assert.deepEqual(posts('/prepare')[0].body,{currentPassword:'fixture-prepare'});
    await button('Обновить статус').click();await expect(page.getByText('Проверка готовности',{exact:true})).toBeVisible();await expect(button('Применить импорт')).toBeDisabled();
    const waitingCalls=calls.length;await page.waitForTimeout(5200);assert.equal(calls.length,waitingCalls);
    currentStatus=ready();await button('Обновить статус').click();await expect(button('Применить импорт')).toBeEnabled();await button('Применить импорт').click();await expect(pw()).toHaveValue('');
    await pw().fill('fixture-apply');await expect(button('Подтвердить действие')).toBeDisabled();await page.getByRole('checkbox').check();await pw().press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('status')).toContainText('Добавлено сообщений: 5');assert.equal(posts('/apply').length,1);
    assert.deepEqual(posts('/apply')[0].body,{previewDigest:digest,currentPassword:'fixture-apply'});assert.equal(await page.evaluate(()=>window.imported),1);
    assert.equal((await page.content()).includes('fixture-apply'),false);assert.equal((await page.content()).includes(sourceDigest),false);
  });
  await t.test('separate rollback confirmation keeps native/later messages explicit',async()=>{
    await button('Откатить исторический импорт').click();await expect(page.getByRole('dialog')).toContainText('Сообщения каналов и последующие поступления сохраняются.');
    await expect(pw()).toHaveValue('');await pw().fill('fixture-rollback');await expect(button('Подтвердить действие')).toBeDisabled();await page.getByRole('checkbox').check();await button('Подтвердить действие').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal(posts('/rollback').length,1);assert.deepEqual(posts('/rollback')[0].body,{currentPassword:'fixture-rollback'});
    await expect(button('Откатить исторический импорт')).toHaveCount(0);
  });
  await t.test('review, conflicts, private blockers and zero-add without an applied run disable writes',async()=>{
    for(const changes of [{review:1},{conflicts:1},{blockers:['fixture-private-alias']},{newCandidates:0}]){
      reset();currentPreview=preview(changes);currentStatus=ready();await start();await button('Проверить перед импортом').click();
      await expect(page.getByText('Ограничений:',{exact:false})).toBeVisible();await expect(button('Применить импорт')).toBeDisabled();await expect(button('Подготовить импорт')).toBeDisabled();
      assert.equal(posts('/apply').length,0);assert.equal((await page.content()).includes('fixture-private-alias'),false);
    }
  });
  await t.test('zero-add replay of an applied run needs fresh password/confirmation but no new prepare or grant',async()=>{
    reset();currentPreview=preview({newCandidates:0,alreadyExists:7});currentStatus=status({run:{runId:'run-a',status:'APPLIED',added:5}});await start();await button('Проверить перед импортом').click();
    await expect(button('Повторить проверку без добавлений')).toBeEnabled();await expect(button('Подготовить импорт')).toBeDisabled();await button('Повторить проверку без добавлений').click();
    await pw().fill('fixture-replay');await page.getByRole('checkbox').check();await button('Подтвердить действие').click();await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(posts('/prepare').length,0);assert.equal(posts('/apply').length,1);
    await expect(page.getByText('Добавлено этим импортом:',{exact:false})).toContainText('5');
  });
  await t.test('expired or mismatched readiness cannot apply',async()=>{
    for(const changes of [{expiresAt:'2020-01-01T00:00:00.000Z'},{previewDigest:'c'.repeat(64)}]){
      reset();currentStatus={...ready(),...changes};await start();await inspect();await expect(button('Применить импорт')).toBeDisabled();
    }
  });
  await t.test('server-disabled operational mode never offers a write',async()=>{
    reset();currentStatus=status({enabled:false});await page.goto(base);
    await expect(page.getByText('Операционный импорт недоступен для этого задания.',{exact:true})).toBeVisible();
    await expect(button('Проверить перед импортом')).toBeDisabled();await expect(button('Подготовить импорт')).toBeDisabled();await expect(button('Применить импорт')).toBeDisabled();assert.equal(posts().length,0);
  });
  await t.test('failed and redirected mutations clear password and cannot echo error bodies',async()=>{
    for(const redirect of [false,true]){
      reset();await start();await inspect();await button('Подготовить импорт').click();await pw().fill('fixture-failure-secret');rejectWrite=!redirect;redirectWrite=redirect;await button('Подтвердить действие').click();
      await expect(pw()).toHaveValue('');await expect(page.getByRole('dialog')).toContainText('Не удалось выполнить действие');
      assert.equal((await page.content()).includes('fixture-private'),false);assert.equal((await page.content()).includes('fixture-failure-secret'),false);
      assert.equal(calls.some(row=>row.path==='/api/redirect-capture'),false);await button('Отмена').last().click();
    }
  });
  await t.test('job changes discard late responses and clear a password dialog',async()=>{
    reset();await start();await inspect();await button('Подготовить импорт').click();await pw().fill('fixture-job-secret');
    await page.evaluate(()=>document.querySelectorAll('button')[0].click());await expect(page.getByRole('dialog')).toHaveCount(0);await expect(button('Проверить перед импортом')).toBeEnabled();
    await inspect();await button('Подготовить импорт').click();await expect(pw()).toHaveValue('');await button('Отмена').last().click();
    await page.evaluate(()=>{window.ignoreAbort=true;});delaySuffix='/preview';currentPreview=preview({discovered:999});await button('Проверить перед импортом').click();
    await expect.poll(()=>typeof release).toBe('function');await button('Fixture switch job').click();currentPreview=preview();release();delaySuffix='';
    await expect(button('Проверить перед импортом')).toBeEnabled();await expect(page.getByText('999',{exact:true})).toHaveCount(0);
    await page.evaluate(()=>{window.ignoreAbort=false;});
  });
  await t.test('double submit is locked and closing an in-flight operation discards its late result',async()=>{
    reset();currentStatus=ready();await start();await inspect();await button('Применить импорт').click();await pw().fill('fixture-inflight-secret');await page.getByRole('checkbox').check();
    await page.evaluate(()=>{window.ignoreAbort=true;});delaySuffix='/apply';
    await page.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
    await expect.poll(()=>typeof release).toBe('function');assert.equal(posts('/apply').length,1);
    await button('Отмена').last().click();await expect(page.getByRole('dialog')).toHaveCount(0);release();delaySuffix='';
    await expect(button('Обновить статус')).toBeEnabled();await expect(button('Применить импорт')).toBeDisabled();
    assert.equal((await page.content()).includes('fixture-inflight-secret'),false);assert.equal(await page.evaluate(()=>window.imported||0),0);
    await page.evaluate(()=>{window.ignoreAbort=false;});
  });
  await t.test('owner unmount erases an open password dialog',async()=>{
    reset();await start();await inspect();await button('Подготовить импорт').click();await pw().fill('fixture-role-secret');
    await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Fixture revoke owner').click());
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Импорт выбранной истории'})).toHaveCount(0);
    assert.equal((await page.content()).includes('fixture-role-secret'),false);assert.equal(posts('/prepare').length,0);
  });
  await t.test('owner unmount aborts the replacement controller created after closing a busy dialog',async()=>{
    reset();currentStatus=ready();await start();await inspect();await button('Применить импорт').click();await pw().fill('fixture-replacement');await page.getByRole('checkbox').check();
    await page.evaluate(()=>{window.ignoreAbort=true;});delaySuffix='/apply';await button('Подтвердить действие').click();await expect.poll(()=>typeof release).toBe('function');
    await button('Отмена').last().click();await expect(page.getByRole('dialog')).toHaveCount(0);release();delaySuffix='';await expect.poll(()=>currentStatus.run?.status).toBe('APPLIED');
    release=undefined;delaySuffix='/status';await button('Обновить статус').click();await expect.poll(()=>typeof release).toBe('function');
    await button('Fixture revoke owner').click();await expect(page.getByRole('heading',{name:'Импорт выбранной истории'})).toHaveCount(0);
    assert.equal(await page.evaluate(()=>window.fetchSignals.at(-1).aborted),true);release();delaySuffix='';
  });
  await t.test('1920 and 1366 desktop layouts retain visible counts, controls and no horizontal overflow',async()=>{
    for(const [width,height]of [[1920,1080],[1366,768]]){
      reset();currentStatus=ready();await page.setViewportSize({width,height});await start();await inspect();
      await expect(button('Применить импорт')).toBeEnabled();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:resolve(out,`desktop-${width}.png`),fullPage:true});
    }
  });
  await t.test('390px modal fits, retains keyboard controls and stores no credentials locally',async()=>{
    reset();currentStatus=ready();await page.setViewportSize({width:390,height:844});await start();await inspect();await button('Применить импорт').click();await expect(pw()).toBeFocused();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('dialog').waitFor({state:'visible'});await page.waitForTimeout(250);
    await page.screenshot({path:resolve(out,'mobile-confirmation.png'),fullPage:true});
    await pw().fill('fixture-mobile-secret');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.deepEqual(await page.evaluate(()=>[Object.keys(localStorage),Object.keys(sessionStorage)]),[[],[]]);
    assert.ok((await page.evaluate(()=>window.fetchMetadata)).every(row=>row.credentials==='include'&&row.cache==='no-store'&&row.redirect==='error'));
    assert.equal((await page.content()).includes('fixture-mobile-secret'),false);
  });
  assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(external,[]);
});
