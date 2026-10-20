import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

// Destination: apps/web/tests/finance-information-notices-browser.test.mjs.
// Relative paths intentionally target that destination, not this private draft.
test('finance information notices: native dismissal, durable preferences and out-of-flow geometry', {
  skip: process.env.YO_FINANCE_INFORMATION_BROWSER !== '1',
  timeout: 180_000,
}, async t => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const web = resolve(root, 'apps/web');
  const require = createRequire(resolve(web, 'package.json'));
  const { chromium, expect } = require('@playwright/test');
  const artifacts = resolve(root, '.local/finance-kpi-compact/browser-runs');
  await mkdir(artifacts, { recursive: true });
  const out = await mkdtemp(resolve(artifacts, 'notices-'));
  const key = 'finance-information-dismissed-v1';
  const closeValuation = 'Закрыть подсказку о курсах';
  const closeScope = 'Закрыть подсказку о расчёте показателей';
  const pageErrors = [], consoleErrors = [], requests = [], blocked = [], results = [];
  const sourceHashes = {};
  let browser, server, base;
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const save = (name, value) => writeFile(resolve(out, name), value, { flag: 'wx' });

  t.after(async () => {
    if (browser) await browser.close();
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
    }
    await save('evidence.json', JSON.stringify({
      status: results.length === 5 && results.every(result => result.pass) &&
        pageErrors.length === 0 && consoleErrors.length === 0 && blocked.length === 0 ? 'PASS' : 'FAIL',
      provenance: 'Real FinanceInformationNotices + Mantine/theme/CSS; synthetic loopback fixture; no auth/API/provider/database',
      sourceHashes, results, requests, blocked, pageErrors, consoleErrors,
    }, null, 2));
  });

  const layout = await readFile(resolve(web, 'app/layout.tsx'), 'utf8');
  const cssPaths = [...layout.matchAll(/import ["'](\.\/[^"']+\.css)["'];/g)]
    .map(match => resolve(web, 'app', match[1]));
  const sourcePaths = [
    resolve(web, 'components/finance-information-notices.tsx'),
    resolve(web, 'lib/i18n.ts'), resolve(web, 'lib/mantine-theme.ts'), ...cssPaths,
  ];
  for (const file of sourcePaths) sourceHashes[file.slice(root.length + 1).replaceAll('\\', '/')] = sha(await readFile(file));
  sourceHashes.test = sha(await readFile(fileURLToPath(import.meta.url)));
  await save('styles.css', Buffer.concat([
    await readFile(require.resolve('@mantine/core/styles.css')),
    ...await Promise.all(cssPaths.map(file => readFile(file))),
  ]));
  await save('loader.cjs', `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  await save('css-loader.cjs', 'module.exports=function(){return ""};');
  const modulePath = file => resolve(web, file).replaceAll('\\', '/');
  await save('entry.tsx', `
    import React, {useState,useEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import {MantineProvider} from '@mantine/core';
    import {yoleotardTheme} from ${JSON.stringify(modulePath('lib/mantine-theme'))};
    import {FinanceInformationNotices} from ${JSON.stringify(modulePath('components/finance-information-notices'))};
    function App(){
      const [presentation,setPresentation]=useState('Synthetic FX date: 2026-10-19');
      const [ready,setReady]=useState(false);
      useEffect(()=>setReady(true),[]);
      return <MantineProvider theme={yoleotardTheme} forceColorScheme="light">
        <main data-testid="fixture-root" data-ready={ready ? 'true' : 'false'} style={{padding:24}}>
          <div data-testid="flow-before" style={{height:56}}>Before notice component</div>
          <FinanceInformationNotices presentation={presentation}/>
          <section data-testid="report-frame" style={{height:180,border:'1px solid #aaa',padding:12}}>
            Report content outside the component
          </section>
          <div data-testid="flow-after" style={{height:56}}>After notice component</div>
          <button type="button" onClick={()=>setPresentation('Synthetic FX date: 2026-10-20')}>Change fixture valuation date</button>
          <output data-testid="presentation-prop">{presentation}</output>
        </main>
      </MantineProvider>;
    }
    createRoot(document.getElementById('app')).render(<App/>);
  `);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((accept, reject) => {
    const compiler = webpack({
      mode: 'development', devtool: false, entry: resolve(out, 'entry.tsx'),
      output: { path: out, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js'], modules: [resolve(web, 'node_modules'), 'node_modules'] },
      module: { rules: [
        { test: /\.tsx?$/, use: resolve(out, 'loader.cjs') },
        { test: /\.css$/, use: resolve(out, 'css-loader.cjs') },
      ] },
    }, (error, stats) => {
      const failure = error || (stats?.hasErrors() ? new Error(stats.toString({ all: false, errors: true })) : null);
      compiler.close(closeError => failure || closeError ? reject(failure || closeError) : accept());
    });
  });
  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="app"></div><script src="/bundle.js"></script></body></html>';
  server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      requests.push({ method: request.method, pathname });
      if (!['GET', 'HEAD'].includes(request.method) || pathname.startsWith('/api/')) {
        blocked.push({ method: request.method, pathname }); response.writeHead(405); response.end(); return;
      }
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const contents = pathname === '/' ? html :
        pathname === '/bundle.js' ? await readFile(resolve(out, 'bundle.js')) :
        pathname === '/styles.css' ? await readFile(resolve(out, 'styles.css')) : null;
      response.writeHead(contents === null ? 404 : 200, {
        'content-type': pathname === '/bundle.js' ? 'text/javascript' :
          pathname === '/styles.css' ? 'text/css' : 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(request.method === 'HEAD' ? undefined : contents ?? '');
    })().catch(() => { response.writeHead(500); response.end(); });
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });

  async function usingPage({ width = 1366, raw, storageBlocked = false } = {}, action) {
    const context = await browser.newContext({
      viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block',
    });
    try {
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === base && ['GET','HEAD'].includes(request.method()) &&
            ['/','/bundle.js','/styles.css','/favicon.ico'].includes(url.pathname)) return route.continue();
        blocked.push({ method: request.method(), pathname: url.pathname, external: url.origin !== base });
        return route.abort('blockedbyclient');
      });
      if (typeof context.routeWebSocket === 'function') await context.routeWebSocket('**/*', socket => {
        blocked.push({ method: 'WS' }); socket.close();
      });
      if (storageBlocked) await context.addInitScript(() => {
        for (const method of ['getItem','setItem','removeItem']) Object.defineProperty(Storage.prototype, method, {
          configurable: true, value() { throw new DOMException('Synthetic blocked storage', 'SecurityError'); },
        });
      });
      else if (raw !== undefined) await context.addInitScript(({ key, raw }) => {
        localStorage.setItem(key, raw);
      }, { key, raw });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      await page.goto(base, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await ready(page);
      await action(page);
    } finally { await context.close(); }
  }
  const valuationButton = page => page.getByRole('button', { name: closeValuation, exact: true });
  const scopeButton = page => page.getByRole('button', { name: closeScope, exact: true });
  async function ready(page) {
    await expect(page.getByTestId('fixture-root')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => new Promise(accept => requestAnimationFrame(() => requestAnimationFrame(accept))));
    await expect(page.getByTestId('report-frame')).toBeVisible();
  }
  async function bothVisible(page) {
    await expect(valuationButton(page)).toBeVisible(); await expect(scopeButton(page)).toBeVisible();
    await expect(page.locator('.mantine-Affix-root')).toHaveCount(1);
  }
  async function keyboardClose(button, keyName) {
    assert.equal(await button.evaluate(element => element.tagName), 'BUTTON', 'Mantine close is a native button');
    await button.focus(); await expect(button).toBeFocused(); await button.press(keyName);
  }
  async function geometry(page) {
    return page.evaluate(() => Object.fromEntries(['flow-before','report-frame','flow-after'].map(id => {
      const {x,y,width,height} = document.querySelector('[data-testid="'+id+'"]').getBoundingClientRect();
      return [id,{x,y,width,height}];
    })));
  }
  async function unchangedGeometry(page, before) {
    const after = await geometry(page);
    for (const id of Object.keys(before)) for (const dimension of ['x','y','width','height'])
      assert.ok(Math.abs(before[id][dimension] - after[id][dimension]) <= 0.5,
        `notifications must not move ${id}.${dimension}`);
  }
  async function scenario(name, action) {
    await t.test(name, async () => {
      try { await action(); results.push({ name, pass: true }); }
      catch (error) { results.push({ name, pass: false }); throw error; }
    });
  }

  await scenario('native keyboard closes each notice independently; preferences survive reload and date changes', async () => {
    await usingPage({}, async page => {
      await bothVisible(page); const before = await geometry(page);
      await keyboardClose(valuationButton(page), 'Enter');
      await expect(valuationButton(page)).toHaveCount(0); await expect(scopeButton(page)).toBeVisible();
      await unchangedGeometry(page, before);
      await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(['valuation']);
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      await expect(scopeButton(page)).toBeVisible(); await expect(valuationButton(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Change fixture valuation date', exact: true }).press('Enter');
      await expect(page.getByTestId('presentation-prop')).toHaveText('Synthetic FX date: 2026-10-20');
      await expect(valuationButton(page)).toHaveCount(0);
      await keyboardClose(scopeButton(page), ' ');
      await expect(page.locator('.mantine-Affix-root')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Подсказки по финансовым показателям' })).toHaveCount(0);
      await unchangedGeometry(page, before);
      await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(['valuation','scope']);
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      await expect(page.locator('.mantine-Affix-root')).toHaveCount(0);
    });
    // Reverse closure order independently: scope must not dismiss valuation.
    await usingPage({ width: 390 }, async page => {
      await bothVisible(page);
      await keyboardClose(scopeButton(page), 'Enter');
      await expect(scopeButton(page)).toHaveCount(0); await expect(valuationButton(page)).toBeVisible();
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      await expect(valuationButton(page)).toBeVisible(); await expect(scopeButton(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Change fixture valuation date', exact: true }).press('Enter');
      await expect(page.getByRole('region', { name: 'Подсказки по финансовым показателям' }).getByRole('status').filter({ hasText: 'Synthetic FX date: 2026-10-20' })).toBeVisible();
    });
  });
  await scenario('closing floating notices leaves external report geometry unchanged at desktop/tablet/mobile', async () => {
    for (const width of [1366,768,390]) await usingPage({ width }, async page => {
      await bothVisible(page); const before = await geometry(page);
      await keyboardClose(scopeButton(page), 'Enter');
      await unchangedGeometry(page, before);
      await keyboardClose(valuationButton(page), 'Enter');
      await expect(page.locator('.mantine-Affix-root')).toHaveCount(0);
      await unchangedGeometry(page, before);
    });
  });
  await scenario('malformed or wrong-shaped localStorage safely reopens both notices', async () => {
    for (const raw of ['{broken', '{"valuation":true}', 'null', 'false', '["unknown",12,null]'])
      await usingPage({ raw }, async page => { await bothVisible(page); });
  });
  await scenario('only recognized valuation/scope dismissal IDs are honored', async () => {
    await usingPage({ raw: '["valuation","unknown",12,null]' }, async page => {
      await expect(scopeButton(page)).toBeVisible(); await expect(valuationButton(page)).toHaveCount(0);
    });
    await usingPage({ raw: '["scope","unknown"]' }, async page => {
      await expect(valuationButton(page)).toBeVisible(); await expect(scopeButton(page)).toHaveCount(0);
    });
  });
  await scenario('blocked storage still permits keyboard dismissal during this mount without page errors', async () => {
    await usingPage({ storageBlocked: true }, async page => {
      await bothVisible(page); const before = await geometry(page);
      await keyboardClose(valuationButton(page), 'Enter');
      await expect(valuationButton(page)).toHaveCount(0); await expect(scopeButton(page)).toBeVisible();
      await keyboardClose(scopeButton(page), ' ');
      await expect(page.locator('.mantine-Affix-root')).toHaveCount(0);
      await page.getByRole('button', { name: 'Change fixture valuation date', exact: true }).press('Enter');
      await expect(page.locator('.mantine-Affix-root')).toHaveCount(0);
      await unchangedGeometry(page, before);
      // Storage denial prevents persistence; a new mount safely shows notices again.
      await page.reload({ waitUntil: 'load' }); await ready(page); await bothVisible(page);
    });
  });
  assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []);
  assert.deepEqual(blocked, []);
  assert.equal(requests.filter(request => request.pathname.startsWith('/api/')).length, 0);
});
