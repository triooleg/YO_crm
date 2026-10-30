import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

// Mount the shipped shared component, theme and complete production CSS cascade.
test('search clear: one painted centered icon, native cancel suppressed, keyboard and clear preserved', {
  skip: process.env.YO_SEARCH_FIELD_BROWSER !== '1', timeout: 120000,
}, async t => {
  const require = createRequire(import.meta.url);
  const { chromium, expect } = require('@playwright/test');
  const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const out = resolve(web, '../../.local/search-clear-browser');
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
  await writeFile(resolve(out, 'entry.tsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';import{CrmSearchField}from'${resolve(web,'components/crm/search-field').replaceAll('\\','/')}';
    function Harness(){const[value,setValue]=useState('');const kind=new URLSearchParams(location.search).get('kind')||'orders-search';return <MantineProvider theme={yoleotardTheme} forceColorScheme="light"><div className="orders-dashboard"><form onSubmit={event=>{event.preventDefault();document.body.dataset.submitted=value}}><CrmSearchField className={kind} value={value} onValueChange={setValue} placeholder="Поиск" ariaLabel="Поиск" clearLabel="Очистить поиск" showSearchIcon/><output>{value}</output></form></div></MantineProvider>}createRoot(document.getElementById('app')).render(<Harness/>);`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false, entry: resolve(out, 'entry.tsx'), output: { path: out, filename: 'bundle.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [resolve(web, 'node_modules'), 'node_modules'] }, module: { rules: [{ test: /\.tsx?$/, use: resolve(out, 'loader.cjs') }] } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : ok()));
  const layout = await readFile(resolve(web, 'app/layout.tsx'), 'utf8');
  const localCss = [...layout.matchAll(/import "(\.\/[^"\n]+\.css)"/g)].map(match => resolve(web, 'app', match[1]));
  const css = Buffer.concat(await Promise.all([readFile(require.resolve('@mantine/core/styles.css')), readFile(require.resolve('@mantine/dates/styles.css')), readFile(require.resolve('@mantine/notifications/styles.css')), ...localCss.map(path => readFile(path))]));
  const server = createServer(async (req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); return res.end(await readFile(resolve(out, 'bundle.js'))); }
    if (req.url === '/styles.css') { res.setHeader('content-type', 'text/css'); return res.end(css); }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="app"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const kind of ['orders-search', 'orders-client-search', 'crm-topbar-search', 'communications-search-field']) {
    for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`http://127.0.0.1:${server.address().port}/?kind=${kind}`);
      const input = page.getByRole('searchbox', { name: 'Поиск', exact: true });
      const clear = page.getByRole('button', { name: 'Очистить поиск', exact: true });
      if (kind === 'crm-topbar-search' && width === 390) {
        await expect(page.locator('.crm-topbar-search')).toBeHidden();
        continue;
      }
      await expect(clear).toHaveCount(0);
      await input.fill('YO-123 Марія');
      await input.press('Enter');
      assert.equal(await page.locator('body').getAttribute('data-submitted'), 'YO-123 Марія');
      await expect(clear).toHaveCount(1);
      const geometry = await clear.evaluate(button => {
        const svg = button.querySelector('svg'), path = svg.querySelector('path');
        const b = button.getBoundingClientRect(), s = svg.getBoundingClientRect();
        const stroke = getComputedStyle(path).stroke, fill = getComputedStyle(path).fill;
        return { dx: Math.abs(b.x + b.width / 2 - s.x - s.width / 2), dy: Math.abs(b.y + b.height / 2 - s.y - s.height / 2), width: s.width, height: s.height, stroke, fill };
      });
      await page.locator('.orders-dashboard').screenshot({ path: resolve(out, `${kind}-${width}.png`) });
      assert.notEqual(geometry.stroke, 'none', `${kind}/${width}: custom X must be painted: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.fill, 'none');
      assert.ok(geometry.width >= 14 && geometry.height >= 14);
      assert.ok(geometry.dx <= 1 && geometry.dy <= 1, `${kind}/${width}: X must be centered: ${JSON.stringify(geometry)}`);
      // Chromium does not expose UA search-cancel computed styles. Hit its real
      // former location instead: only the separate accessible button may clear.
      const inputBox = await input.boundingBox();
      await page.mouse.click(inputBox.x + inputBox.width - 8, inputBox.y + inputBox.height / 2);
      await expect(input).toHaveValue('YO-123 Марія');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await input.press('Tab');
      await expect(clear).toBeFocused();
      await clear.press('Enter');
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await expect(clear).toHaveCount(0);
      await input.fill('Київ');
      await clear.click();
      await expect(input).toHaveValue('');
      await expect(page.locator('output')).toHaveText('');
      await expect(input).toBeFocused();
      assert.equal(await page.locator('body').getAttribute('data-submitted'), 'YO-123 Марія', 'clear must not submit the form');
    }
  }
  assert.deepEqual(errors, []);
});
