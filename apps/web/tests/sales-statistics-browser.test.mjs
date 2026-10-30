import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Opt in explicitly: ordinary pnpm test needs neither Chromium nor a dev server.
const enabled = process.env.YO_SALES_BROWSER === '1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const artifacts = resolve(root, '.local/sales-statistics/browser');
const statsPath = '/api/overview/sales-statistics';
const startQuery = '?section=overview&view=statistics&from=2026-01-01&to=2026-10-31&currency=EUR';

test('sales statistics independent synthetic browser regression', { skip: !enabled, timeout: 300_000 }, async t => {
  const base = new URL(process.env.YO_SALES_BASE_URL || 'http://127.0.0.1:3596');
  assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only local HTTP is permitted');
  const { chromium, expect } = await import('@playwright/test');
  const { fixtureModel } = await import(new URL('./fixtures/sales-statistics-browser-fixture.mjs', import.meta.url));
  await mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const receipts = [];
  t.after(async () => {
    await browser.close();
    await writeFile(resolve(artifacts, 'receipts.json'), JSON.stringify({ provenance: 'Real local Chromium/UI; synthetic HTTP responses from actual query/model/CSV functions. No real DB, provider or production proof.', base: base.origin, receipts }, null, 2));
  });
  async function session(role = 'OWNER', options = {}) {
    const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage(), model = fixtureModel(role, options);
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(120_000);
    const calls = [], errors = [], violations = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base.origin) { violations.push(`External ${url.origin}`); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname, input = Object.fromEntries(url.searchParams);
      calls.push({ path, method: request.method(), query: input });
      if (request.method() !== 'GET') { violations.push(`Write ${request.method()} ${path}`); return route.abort(); }
      const json = value => route.fulfill({ json: value });
      if (path === '/api/auth/me') return json({ user: { id: 'browser-staff', role, displayName: 'Browser QA', email: 'qa@example.test' } });
      if (path === '/api/branding') return json({});
      if (path === '/api/communications/unread-count') return json({ unreadCount: 0 });
      if (path === '/api/orders/website-notifications') return json({ items: [], unreadCount: 0 });
      try {
        if (path === statsPath) return json(model.report(input));
        if (path === statsPath + '/export') return route.fulfill({ contentType: 'text/csv; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="sales-statistics.csv"' }, body: model.csv(input) });
      } catch (error) { violations.push(`Fixture ${path}: ${error.message}`); return route.fulfill({ status: 400, json: { message: error.message } }); }
      if (path === '/api/overview/orders') return json({ ...(options.overviewSources ? { sourceAnalytics: { total: 24, websiteCount: 12, breakdown: [{source:'WEBSITE',count:12},{source:'INSTAGRAM',count:12}], trend: [] } } : {}), month: input.month, currency: input.currency, today: '2026-10-18', counts: { total: 24, previousTotal: 18, work: 8, ready: 5, overdue: 2, requiresVerification: 1, awaitingPayment: 3 }, ring: { total: 24, excluded: 0, segments: [{ key: 'work', count: 24 }] }, trend: [{ month: input.month, orders: 24, clients: 12 }], recent: [], valuationError: null });
      if (path === '/api/overview/tasks') return json({ userId: 'browser-staff', doneColumnId: 'done', rows: [] });
      if (path === '/api/overview/messages') return json({ unreadCount: 0, rows: [] });
      if (path === '/api/overview/shipments') return json({ today: '2026-10-18', count7: 0, requiresVerification: 0, rows: [] });
      if (path === '/api/finance/report') return json({ month: input.month, currency: input.currency, valuationVersion: 'overview-fixture', valuation: { provider: null, effectiveDate: null, fetchedAt: null, officialUrl: null }, current: { receivedMinor: 312368, expensesMinor: 62435, resultMinor: 249933 }, previous: { receivedMinor: 745872, expensesMinor: 48800, resultMinor: 697072 }, monthlyTrend: [{ month: input.month, receivedMinor: 312368, expensesMinor: 62435, resultMinor: 249933 }] });
      violations.push(`Unexpected GET ${path}`); return route.fulfill({ status: 501, json: { message: 'Unexpected synthetic API boundary' } });
    });
    async function finish(name) {
      receipts.push({ name, role, requests: calls, errors, violations });
      await writeFile(resolve(artifacts, 'receipts-progress.json'), JSON.stringify(receipts, null, 2));
      await page.screenshot({ path: resolve(artifacts, `${name}-last-state.png`) }).catch(() => {});
      await context.close();
      assert.deepEqual(violations, [], 'Strict local/read-only fixture boundary');
      assert.deepEqual(errors, [], 'Browser console/page errors');
    }
    return { page, context, calls, errors, violations, finish, latest: () => calls.filter(call => call.path === statsPath).at(-1)?.query };
  }

  const ready = page => expect(page.locator('.sales-statistics-page')).toHaveAttribute('data-statistics-ready', 'true');
  const wantedCases = new Set((process.env.YO_SALES_CASES || '').split('|').filter(Boolean));
  const scenario = (name, run) => t.test(name, { skip: (process.env.YO_SALES_ONLY_VISUAL === '1' && !name.startsWith('responsive statistics')) || (wantedCases.size > 0 && !wantedCases.has(name)) }, run);
  const select = async (page, name, option) => {
    await page.getByRole('textbox', { name, exact: true }).or(page.getByRole('combobox', { name, exact: true })).first().click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await ready(page);
  };
  await scenario('previous KPI numbers and neutral comparisons stay aligned with the selected report', async () => {
    const s = await session();
    try {
      await s.page.goto(base.origin + startQuery); await ready(s.page);
      await s.page.screenshot({path:resolve(artifacts,'comparison-desktop.png'),fullPage:true});
      const cards=s.page.locator('.sales-statistics-kpi');
      await expect(cards).toHaveCount(6);
      for(let i=0;i<6;i++) await expect(cards.nth(i).locator('.sales-statistics-kpi-previous')).toHaveText(i===5?'0,00 €':'0');
      for(let i=0;i<6;i++) await expect(cards.nth(i).locator('.sales-statistics-comparison')).toHaveText('—');
    } finally {await s.finish('comparison-zero-base')}
  });
  await scenario('previous KPI values follow filters and currencies without overlap', async () => {
    const s=await session();
    try {
      const {salesCount}=await import('../lib/sales-statistics.ts');
      // Chromium and Node ship different ICU currency symbols for UAH.
      const money=(value,currency)=>s.page.evaluate(({value,currency})=>value==null?'—':new Intl.NumberFormat('ru-RU',{style:'currency',currency,maximumFractionDigits:2}).format(value/100),{value,currency});
      const verify=async()=>{
        const report=fixtureModel().report(s.latest());
        const cards=s.page.locator('.sales-statistics-kpi');
        for(const [i,key] of ['orders','pieces','countries','clients','repeatOrders','amountMinor'].entries()){
          await expect(cards.nth(i).locator('.sales-statistics-kpi-previous')).toHaveText(i===5?await money(report.previous[key],report.query.currency):salesCount(report.previous[key]));
          await expect(cards.nth(i).locator('strong')).toHaveText(i===5?await money(report.current[key],report.query.currency):salesCount(report.current[key]));
        }
      };
      await s.page.goto(base.origin+'?section=overview&view=statistics&from=2026-10-01&to=2026-10-31&currency=EUR');await ready(s.page);await verify();
      await expect(s.page.locator('.sales-statistics-kpi-previous').first()).toHaveText('7');
      await expect(s.page.locator('.sales-statistics-kpi-previous').nth(1)).toHaveText('42');
      await expect(s.page.locator('.sales-statistics-kpi-previous').nth(5)).toHaveText('5 973,41 €');
      await expect(s.page.locator('.sales-statistics-kpi .sales-statistics-comparison')).toHaveCount(6);
      await expect(s.page.locator('.sales-statistics-kpi .sales-statistics-comparison').first()).toHaveText('0%');
      for(const currency of ['USD','UAH','EUR']) {await select(s.page,'Валюта отчёта',currency);await verify()}
      for(const [width,height] of [[1920,1080],[1366,768],[820,1180],[390,844],[320,800]]){
        await s.page.setViewportSize({width,height});await verify();
        const geometry=await s.page.locator('.sales-statistics-kpi').evaluateAll(cards=>cards.map(card=>{
          const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
          return {card:rect(card),badge:rect(card.querySelector('.sales-statistics-kpi-previous')),title:rect(card.querySelector('h2')),value:rect(card.querySelector('strong'))};
        }));
        const overlap=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
        for(const {card,badge,title,value} of geometry){assert.ok(badge.left>=card.left&&badge.right<=card.right);assert.ok(!overlap(badge,title)&&!overlap(badge,value));assert.ok(Math.abs(badge.right-card.right+13)<=2,'Badge stays at the right edge');assert.ok(Math.abs(badge.top-card.top-13)<=2,'Badge stays at the top edge');}
        assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
        await s.page.screenshot({path:resolve(artifacts,`comparison-${width}.png`),fullPage:width>=1366});
      }
      await s.page.setViewportSize({width:390,height:844});await select(s.page,'Валюта отчёта','UAH');await verify();
      const moneyBounds=await s.page.locator('.sales-statistics-kpi').nth(5).evaluate(card=>{
        const badge=card.querySelector('.sales-statistics-kpi-previous'),value=card.querySelector('strong'),a=badge.getBoundingClientRect(),b=value.getBoundingClientRect(),c=card.getBoundingClientRect();
        return {top:a.top-c.top,right:c.right-a.right,badgeBottom:a.bottom,valueTop:b.top,scroll:badge.scrollWidth,width:badge.clientWidth};
      });
      assert.ok(Math.abs(moneyBounds.top-13)<=2&&Math.abs(moneyBounds.right-13)<=2);assert.ok(moneyBounds.badgeBottom<=moneyBounds.valueTop);assert.ok(moneyBounds.scroll<=moneyBounds.width+1);
      await s.page.mouse.move(0,0);await expect(s.page.getByRole('tooltip')).toBeHidden();
      await s.page.locator('.sales-statistics-kpis').screenshot({path:resolve(artifacts,'comparison-390-UAH.png')});
      await s.page.setViewportSize({width:1536,height:1024});
      await select(s.page,'Источник','С сайта');await s.page.getByRole('button',{name:'Применить',exact:true}).click();await ready(s.page);await verify();
      await select(s.page,'Статус','Заказ подтверждён');await s.page.getByRole('button',{name:'Применить',exact:true}).click();await ready(s.page);await verify();
      await select(s.page,'Клиент','Синтетический клиент 1');await s.page.getByRole('button',{name:'Применить',exact:true}).click();await ready(s.page);await verify();
    } finally {await s.finish('comparison-filters-currencies-layout')}
  });
  await scenario('previous KPI badges show growth and decline with consistent numbers', async () => {
    const s=await session();
    try {
      await s.page.goto(base.origin+'?section=overview&view=statistics&from=2026-10-01&to=2026-10-20&currency=EUR');await ready(s.page);
      const first=s.page.locator('.sales-statistics-kpi').first();
      await expect(first.locator('strong')).toHaveText('7');
      await expect(first.locator('.sales-statistics-kpi-previous')).toHaveText('6');
      await expect(first.locator('.sales-statistics-positive')).toHaveText('↑ +17%');
      await expect(s.page.locator('.sales-statistics-kpi-previous').nth(5)).toHaveText('4 773,41 €');
      await s.page.screenshot({path:resolve(artifacts,'comparison-growth-desktop.png'),fullPage:true});
      await s.page.goto(base.origin+'?section=overview&view=statistics&from=2026-10-15&to=2026-10-31&currency=EUR');await ready(s.page);
      await expect(first.locator('strong')).toHaveText('2');
      await expect(first.locator('.sales-statistics-kpi-previous')).toHaveText('5');
      await expect(first.locator('.sales-statistics-negative')).toHaveText('↓ -60%');
    } finally {await s.finish('comparison-growth-decline')}
  });
  await scenario('fixture uses the real aggregate and changes with filters', async () => {
    const m = fixtureModel(), report = m.report({ from: '2026-01-01', to: '2026-10-31' });
    assert.equal(report.current.orders, 70); assert.equal(report.current.pieces, 420);
    assert.equal(m.report({ from: '2026-01-01', to: '2026-10-31', country: 'FR' }).current.orders, 10);
    assert.equal(m.report({ from: '2026-10-01', to: '2026-10-31', drill: 'payments' }).drilldown.rows.length, 16);
    assert.equal(fixtureModel('MANAGER').report({}).current.amountMinor, null);
  });
  await scenario('expense notices explain overhead without concealing missing rates', async () => {
    const s=await session('OWNER',{unallocated:true});
    try {
      await s.page.goto(base.origin+startQuery);await ready(s.page);
      const notice=s.page.locator('[data-statistics-notice="blue"]');
      await expect(notice).toContainText('Расходы без привязки к заказу');
      await expect(notice).toContainText('не распределяются по странам');
      await expect(notice).not.toContainText('требующие проверки');
      await s.page.screenshot({path:resolve(artifacts,'overhead-notice.png')});
    } finally {await s.finish('overhead-notice')}
    const missing=await session('OWNER',{unallocated:true,missingFx:true});
    try {
      await missing.page.goto(base.origin+startQuery);await ready(missing.page);
      await expect(missing.page.locator('[data-statistics-notice="orange"]')).toContainText('Не найден исторический курс');
      await expect(missing.page.locator('[data-statistics-notice="blue"]')).toBeVisible();
    } finally {await missing.finish('overhead-and-missing-fx')}
  });

  await scenario('matching overview headers and white active controls', async () => {
    for (const [width,height] of [[1920,1080],[1536,1024],[1366,768],[820,1180],[390,844]]) {
      const s = await session('OWNER',{overviewSources:true,longCountries:true});
      try {
        await s.page.setViewportSize({width,height});
        const measure = async (header,mode) => s.page.locator(header).evaluate((node,modeSelector)=>{
          const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
          const control=node.querySelector(modeSelector);
          return {header:rect(node),mode:rect(control),activeColor:getComputedStyle(control.querySelector('label[data-active]')).color};
        },mode);
        await s.page.goto(base.origin+startQuery);await ready(s.page);
        const statistics=await measure('.sales-statistics-header','.sales-statistics-mode');
        const countries=await s.page.locator('.sales-statistics-client-country').evaluateAll(nodes=>nodes.map(node=>({align:getComputedStyle(node.closest('td')).textAlign,flagX:node.querySelector('.fi')?.getBoundingClientRect().x,gap:node.querySelector('.fi')?getComputedStyle(node.querySelector('.fi')).marginRight:null})));
        assert.ok(countries.length>0);assert.ok(countries.every(country=>country.align==='left'),'Client countries align left like country ranking');
        const fullNames=await s.page.locator('.sales-statistics-client-country').evaluateAll(nodes=>nodes.map(node=>{
          const style=getComputedStyle(node),range=document.createRange();range.selectNodeContents(node);
          return {text:node.textContent,textOverflow:style.textOverflow,overflow:style.overflow,whiteSpace:style.whiteSpace,scroll:node.scrollWidth,client:node.clientWidth,textRight:range.getBoundingClientRect().right,nextLeft:node.closest('td').nextElementSibling.getBoundingClientRect().left};
        }));
        for(const country of fullNames){
          assert.notEqual(country.textOverflow,'ellipsis',`Full country name: ${JSON.stringify(country)}`);
          assert.notEqual(country.overflow,'hidden');assert.equal(country.whiteSpace,'nowrap');
          assert.ok(country.scroll<=country.client+1);assert.ok(country.textRight<=country.nextLeft+1,'Country text does not overlap count');
        }
        await writeFile(resolve(artifacts,`full-client-countries-${width}.json`),JSON.stringify(fullNames,null,2));
        const countryRanking=await s.page.locator('.sales-statistics-country-ranking .sales-statistics-name').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,overflow:getComputedStyle(node).textOverflow,nowrap:getComputedStyle(node).whiteSpace,scroll:node.scrollWidth,width:node.clientWidth})));
        for(const country of countryRanking){assert.notEqual(country.overflow,'ellipsis');assert.equal(country.nowrap,'nowrap');assert.ok(country.scroll<=country.width+1)}
        if(width>=1366){
          const amounts=await s.page.locator('.sales-statistics-top-clients tbody td:last-child').evaluateAll(nodes=>nodes.map(node=>{const r=document.createRange();r.selectNodeContents(node);const view=node.closest('.mantine-ScrollArea-viewport');return {right:r.getBoundingClientRect().right,viewRight:view.getBoundingClientRect().left+view.clientWidth}}));
          for(const amount of amounts)assert.ok(amount.right<=amount.viewRight+1,`Full countries retain visible money at ${width}: ${JSON.stringify(amount)}`);
        }


        const flags=countries.filter(country=>country.flagX!==undefined);assert.ok(flags.length>=2);
        assert.ok(flags.every(flag=>Math.abs(flag.flagX-flags[0].flagX)<=1 && flag.gap==='8px'),'Client flags share one left edge and country-table spacing');
        await expect(s.page.locator('.sales-statistics-toolbar label[data-active]')).toHaveCSS('color','rgb(255, 255, 255)');
        await expect(s.page.getByRole('button',{name:'Применить',exact:true})).toHaveCSS('color','rgb(255, 255, 255)');
        await s.page.screenshot({path:resolve(artifacts,`matching-statistics-${width}.png`)});
        await s.page.locator('.sales-statistics-mode label').filter({hasText:/^Обзор$/}).click();
        await expect(s.page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');
        await expect(s.page.locator('.overview-kpi')).toHaveCount(8);
        const overview=await measure('.overview-header','.overview-mode-control');
        await writeFile(resolve(artifacts,`matching-header-geometry-${width}.json`),JSON.stringify({statistics,overview},null,2));
        for(const part of ['header','mode'])for(const key of ['x','y','width','height'])assert.ok(Math.abs(overview[part][key]-statistics[part][key])<=1,`${width} ${part}.${key}: overview=${overview[part][key]} statistics=${statistics[part][key]}`);
        assert.equal(overview.activeColor,'rgb(255, 255, 255)');assert.equal(statistics.activeColor,'rgb(255, 255, 255)');
        assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No document overflow');
        await s.page.screenshot({path:resolve(artifacts,`matching-overview-${width}.png`)});
        await s.page.locator('.overview-mode-control label').filter({hasText:/^Статистика$/}).click();await ready(s.page);
      } finally {await s.finish(`matching-headers-${width}`)}
    }
  });
  for (const [width, height] of [[1536,1024],[1920,1080],[1366,768],[820,1180],[390,844]]) {
    await scenario(`responsive statistics ${width}x${height}`, async () => {
      const s = await session();
      try {
        await s.page.setViewportSize({ width, height }); await s.page.goto(base.origin + startQuery); await ready(s.page);
        await expect(s.page.locator('.sales-statistics-kpi')).toHaveCount(6);
        await expect(s.page.locator('.sales-statistics-grid > article')).toHaveCount(9);
        await expect(s.page.locator('.sales-statistics-kpi').nth(0).locator('strong')).toHaveText('70');
        await expect(s.page.locator('.sales-statistics-kpi').nth(1).locator('strong')).toHaveText('420');
        assert.equal(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No document horizontal overflow');
        if (width >= 1366) assert.equal(new Set(await s.page.locator('.sales-statistics-kpi').evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().top)))).size, 1, 'Six KPI share one desktop row');
        if (width === 1366) {
          const panel = s.page.locator('.sales-statistics-panel').filter({ has: s.page.getByRole('heading', { name: 'ТОП-10 клиентов', exact: true }) });
          const amounts = await panel.locator('tbody tr td:last-child').evaluateAll(cells => cells.map(cell => {
            const range = document.createRange(); range.selectNodeContents(cell);
            const bounds = range.getBoundingClientRect(), panelBounds = cell.closest('article').getBoundingClientRect();
            const viewport = cell.closest('.mantine-ScrollArea-viewport');
            if (!viewport) throw new Error('Table scroll viewport not found');
            const viewportBounds = viewport.getBoundingClientRect();
            return { text: cell.textContent.trim(), left: bounds.left, right: bounds.right, panelLeft: panelBounds.left, panelRight: panelBounds.right, viewportLeft: viewportBounds.left, viewportRight: viewportBounds.left + viewport.clientWidth };
          }));
          assert.equal(amounts.length, 10);
          for (const amount of amounts) {
            assert.match(amount.text, /€$/);
            assert.ok(amount.left >= amount.panelLeft && amount.right <= amount.panelRight, `Client amount including currency stays in panel: ${JSON.stringify(amount)}`);
            assert.ok(amount.left >= amount.viewportLeft && amount.right <= amount.viewportRight + 0.5, `Client amount including currency stays in table viewport: ${JSON.stringify(amount)}`);
          }
          await writeFile(resolve(artifacts, 'top-clients-1366-amount-bounds.json'), JSON.stringify(amounts, null, 2));
          const countryStyle = await panel.locator('.sales-statistics-client-country').first().evaluate(node => ({ maxWidth: getComputedStyle(node).maxWidth, display: getComputedStyle(node).display }));
          assert.equal(countryStyle.maxWidth, 'none');
          const stylesheets = [];
          for (const href of await s.page.locator('link[rel="stylesheet"]').evaluateAll(nodes => nodes.map(node => node.href))) {
            assert.equal(new URL(href).origin, base.origin);
            const response = await s.page.request.get(href); assert.equal(response.status(), 200);
            stylesheets.push({ url: href, sha256: createHash('sha256').update(await response.body()).digest('hex') });
          }
          const sourceHash = createHash('sha256').update(await readFile(resolve(root, 'apps/web/app/sales-statistics.css'))).digest('hex');
          // Optional frozen runtime comparison; normal local dev runs directly
          // from this checkout and have no historical copied-runtime directory.
          const runtimeRoot=process.env.YO_SALES_RUNTIME_ROOT;
          const runtimeHash=runtimeRoot?createHash('sha256').update(await readFile(resolve(runtimeRoot,'apps/web/app/sales-statistics.css'))).digest('hex'):null;
          if(runtimeRoot)assert.equal(sourceHash,runtimeHash);
          await writeFile(resolve(artifacts, 'css-http-1366.json'), JSON.stringify({ sourceHash, runtimeRoot:runtimeRoot||null, runtimeHash, countryStyle, stylesheets }, null, 2));
        }
        await s.page.screenshot({ path: resolve(artifacts, `statistics-${width}-viewport.png`) });
        await s.page.screenshot({ path: resolve(artifacts, `statistics-${width}-full.png`), fullPage: true });
        await s.page.locator('.sales-statistics-panel').last().scrollIntoViewIfNeeded();
        await s.page.screenshot({ path: resolve(artifacts, `statistics-${width}-lower.png`) });
        const summary = s.page.locator('.sales-statistics-financial-summary');
        await expect(summary.locator('strong')).toHaveCount(4);
        await summary.scrollIntoViewIfNeeded();
        await s.page.screenshot({ path: resolve(artifacts, `statistics-${width}-summary.png`) });
        await s.page.getByRole('button', { name: 'Фильтры статистики', exact: true }).click();
        await expect(s.page.getByRole('dialog', { name: 'Фильтры статистики' })).toBeVisible();
        await s.page.screenshot({ path: resolve(artifacts, `statistics-${width}-filters.png`) });
      } finally { await s.finish(`responsive-${width}`); }
    });
  }
  await scenario('draft/apply filters, Back/forward/reload, currency and pinned CSV', async () => {
    const s = await session();
    try {
      await s.page.goto(base.origin + startQuery); await ready(s.page);
      await s.page.getByRole('button', { name: 'Предыдущий период', exact: true }).click();
      await expect.poll(() => s.latest()?.from).toBe('2025-03-01'); await ready(s.page);
      await s.page.getByRole('button', { name: 'Следующий период', exact: true }).click();
      await expect.poll(() => s.latest()?.from).toBe('2026-01-01'); await ready(s.page);
      const count = s.calls.filter(c => c.path === statsPath).length;
      await select(s.page, 'Источник', 'С сайта');
      assert.equal(s.calls.filter(c => c.path === statsPath).length, count, 'Draft does not fetch');
      await s.page.getByRole('button', { name: 'Применить', exact: true }).click();
      await expect.poll(() => s.latest()?.source).toBe('WEBSITE'); await ready(s.page);
      await expect(s.page.locator('.sales-statistics-kpi').first().locator('strong')).toHaveText('20');
      await s.page.reload(); await ready(s.page); assert.equal(s.latest().source, 'WEBSITE');
      await s.page.getByRole('button', { name: 'Фильтры статистики', exact: true }).click();
      await select(s.page, 'Страна', 'Франция');
      await s.page.getByRole('dialog').getByRole('button', { name: 'Применить', exact: true }).click();
      await expect.poll(() => s.latest()?.country).toBe('FR'); await ready(s.page);
      await expect(s.page.locator('.sales-statistics-kpi').first().locator('strong')).toHaveText('10');
      await s.page.goBack(); await expect.poll(() => s.latest()?.country || '').toBe(''); await ready(s.page);
      await s.page.goForward(); await expect.poll(() => s.latest()?.country).toBe('FR'); await ready(s.page);
      await select(s.page, 'Валюта отчёта', 'UAH'); await expect.poll(() => s.latest()?.currency).toBe('UAH'); await ready(s.page);
      const expected = fixtureModel().report(s.latest());
      const formatted = await s.page.evaluate(amount => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'UAH', maximumFractionDigits: 2 }).format(amount / 100), expected.current.amountMinor);
      await expect(s.page.locator('.sales-statistics-kpi').nth(5).locator('strong')).toHaveText(formatted);
      const download = s.page.waitForEvent('download'); await s.page.getByRole('button', { name: 'Экспорт', exact: true }).click();
      const file = await download; await file.saveAs(resolve(artifacts, 'owner-filtered.csv'));
      const csv = await readFile(resolve(artifacts, 'owner-filtered.csv'), 'utf8');
      assert.ok(csv.includes('"FR";"10";"60"'));
      assert.ok(csv.includes(`"${expected.current.amountMinor}"`), 'CSV equals the model-projected monetary total');
      const exported = s.calls.filter(c => c.path.endsWith('/export')).at(-1)?.query;
      assert.match(exported.valuationVersion, /^[a-f0-9]{64}$/);
      assert.equal(exported.country, 'FR'); assert.equal(exported.source, 'WEBSITE'); assert.equal(exported.currency, 'UAH');
      await s.page.getByRole('button', { name: 'Сбросить', exact: true }).click(); await ready(s.page);
      await expect.poll(() => s.latest()?.source || '').toBe('');
    } finally { await s.finish('filters-history-export'); }
  });
  await scenario('five tabs, sorting, keyboard map and KPI drill pagination', async () => {
    const s = await session();
    try {
      await s.page.goto(base.origin + startQuery); await ready(s.page);
      for (const [label, key] of [['Источники','sources'],['Клиенты','clients'],['Виды спорта','sports'],['Типы заказов','types'],['Страны','countries']]) {
        await s.page.locator('.sales-statistics-toolbar label').filter({ hasText: new RegExp(`^${label}$`) }).click();
        await expect.poll(() => s.latest()?.tab).toBe(key); await ready(s.page);
        if (key === 'clients') {
          await select(s.page, 'Ранжирование клиентов', 'Получено платежей');
          await expect.poll(() => s.latest()?.ranking).toBe('received');
          await expect.poll(() => s.latest()?.sort).toBe('received'); await ready(s.page);
          const topClients = s.page.locator('.sales-statistics-panel').filter({ has: s.page.getByRole('heading', { name: 'ТОП-10 клиентов', exact: true }) });
          await topClients.getByRole('button', { name: 'Сортировать: Заказы', exact: true }).click();
          await expect.poll(() => s.latest()?.ranking).toBe('orders');
          await expect.poll(() => s.latest()?.sort).toBe('orders'); await ready(s.page);
          await topClients.getByRole('button', { name: 'Сортировать: Изделия', exact: true }).click();
          await expect.poll(() => s.latest()?.ranking).toBe('pieces');
          await expect.poll(() => s.latest()?.sort).toBe('pieces');
          await expect.poll(() => s.latest()?.direction).toBe('desc'); await ready(s.page);
          assert.equal(new URL(s.page.url()).searchParams.get('statRanking'), 'pieces');
          await topClients.getByRole('button', { name: 'Сортировать: Изделия', exact: true }).click();
          await expect.poll(() => s.latest()?.direction).toBe('asc'); await ready(s.page);
          assert.equal(s.latest().ranking, 'pieces');
          assert.equal(new URL(s.page.url()).searchParams.get('statRanking'), 'pieces');
          assert.equal(new URL(s.page.url()).searchParams.get('statDirection'), 'asc');
          await s.page.locator('.sales-statistics-primary').getByRole('button', { name: 'Сортировать: Изделия', exact: true }).click();
          await expect.poll(() => s.latest()?.ranking).toBe('pieces');
          await expect.poll(() => s.latest()?.sort).toBe('pieces'); await ready(s.page);
        }
        await s.page.screenshot({ path: resolve(artifacts, `tab-${key}.png`) });
      }
      await s.page.getByRole('button', { name: 'Сортировать: Страна', exact: true }).first().click();
      await expect.poll(() => s.latest()?.sort).toBe('label'); await ready(s.page);
      const map = s.page.locator('[data-country="FR"]'); await map.focus(); await map.press('Enter');
      await expect.poll(() => s.latest()?.country).toBe('FR'); await expect.poll(() => s.latest()?.drill).toBe('orders'); await ready(s.page);
      await expect(s.page.getByRole('dialog', { name: 'Детализация статистики' })).toContainText('Всего: 10');
      await s.page.screenshot({ path: resolve(artifacts, 'country-drill.png') });
      await s.page.goBack(); await ready(s.page);
      await s.page.locator('.sales-statistics-kpi-action').first().click(); await ready(s.page);
      const drawer = s.page.getByRole('dialog', { name: 'Детализация статистики' });
      await expect(drawer).toContainText('Всего: 70');
      await drawer.getByRole('button', { name: '2', exact: true }).click();
      await expect.poll(() => s.latest()?.page).toBe('2'); await ready(s.page);
      await expect(drawer.locator('tbody tr')).toHaveCount(25);
      await s.page.reload(); await ready(s.page); assert.equal(s.latest().drill, 'orders'); assert.equal(s.latest().page, '2');
    } finally { await s.finish('tabs-map-drill-pagination'); }
  });
  await scenario('chart predicates for payments, monthly client cohorts and other countries', async () => {
    const s = await session();
    try {
      await s.page.goto(base.origin + startQuery); await ready(s.page);
      await select(s.page, 'Показатель выручки', 'Фактические поступления');
      const revenue = s.page.locator('.sales-statistics-panel').filter({ has: s.page.getByRole('heading', { name: 'Динамика выручки', exact: true }) });
      await revenue.locator('rect[role="button"][aria-label^="2026-10"]').focus();
      await revenue.locator('rect[role="button"][aria-label^="2026-10"]').press('Enter');
      await expect.poll(() => s.latest()?.drill).toBe('payments'); await ready(s.page);
      assert.equal(s.latest().from, '2026-10-01');
      await expect(s.page.getByRole('dialog')).toContainText('Всего: 16');
      await s.page.goto(base.origin + startQuery); await ready(s.page);
      const cohorts = s.page.locator('.sales-statistics-panel').filter({ has: s.page.getByRole('heading', { name: 'Новые и постоянные клиенты', exact: true }) });
      await cohorts.locator('rect[role="button"][aria-label^="2026-10 · Постоянные клиенты"]').focus();
      await cohorts.locator('rect[role="button"][aria-label^="2026-10 · Постоянные клиенты"]').press('Enter');
      await expect.poll(() => s.latest()?.repeat).toBe('returning-client'); await ready(s.page); assert.equal(s.latest().drill, 'clients');
      await s.page.goto(base.origin + startQuery); await ready(s.page);
      const others = s.page.locator('rect[role="button"][aria-label^="2026-10 · Остальные"]');
      await others.focus(); await others.press('Enter');
      await expect.poll(() => s.latest()?.country).toMatch(/^OTHERS:/); await ready(s.page);
      const expected = fixtureModel().report(s.latest());
      await expect(s.page.getByRole('dialog')).toContainText(`Всего: ${expected.drilldown.total}`);
    } finally { await s.finish('chart-predicates'); }
  });
  await scenario('source tab receipts are visible only for financial roles', async () => {
    for (const role of ['OWNER', 'MANAGER']) {
      const s = await session(role);
      try {
        await s.page.goto(base.origin + startQuery + '&statTab=sources'); await ready(s.page);
        const table = s.page.locator('.sales-statistics-table').first();
        const heading = table.getByRole('button', { name: 'Сортировать: Получено платежей', exact: true });
        if (role === 'OWNER') {
          await heading.scrollIntoViewIfNeeded(); await expect(heading).toBeVisible();
          const expected = fixtureModel(role).report(s.latest()).sources.find(row => row.key === 'WEBSITE').receivedMinor;
          const formatted = await s.page.evaluate(amount => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(amount / 100), expected);
          const row = table.locator('tbody tr').filter({ has: s.page.getByRole('button', { name: 'С сайта', exact: true }) });
          await expect(row.locator('td').last()).toHaveText(formatted);
          await heading.click(); await expect.poll(() => s.latest()?.sort).toBe('received'); await ready(s.page);
        } else {
          await expect(heading).toHaveCount(0);
          await expect(table.locator('thead')).not.toContainText('Получено платежей');
        }
        await s.page.screenshot({ path: resolve(artifacts, `sources-receipts-${role}.png`) });
      } finally { await s.finish(`sources-receipts-${role}`); }
    }
  });
  for (const role of ['MANAGER','ACCOUNTANT','PRODUCTION']) await scenario(`role ${role} and Overview compatibility`, async () => {
    const s = await session(role);
    try {
      await s.page.goto(base.origin + startQuery);
      if (role === 'PRODUCTION') {
        await expect(s.page.locator('.overview-page')).toHaveAttribute('data-overview-ready', 'true');
        await expect(s.page.locator('.overview-kpi')).toHaveCount(0);
        assert.equal(s.calls.filter(c => c.path === statsPath).length, 0);
        await expect(s.page.getByRole('radio', { name: 'Статистика', exact: true })).toHaveCount(0);
      } else {
        await ready(s.page);
        if (role === 'MANAGER') {
          await expect(s.page.locator('.sales-statistics-financial-summary')).toBeHidden();
          await expect(s.page.getByRole('combobox', { name: 'Валюта отчёта', exact: true })).toHaveCount(0);
          await expect(s.page.locator('.sales-statistics-kpi').nth(5).locator('strong')).toHaveText('—');
          await expect(s.page.locator('.sales-statistics-kpi-previous').nth(5)).toHaveText('—');
          await expect(s.page.getByRole('heading', { name: 'Динамика выручки', exact: true })).toHaveCount(0);
          const dl = s.page.waitForEvent('download'); await s.page.getByRole('button', { name: 'Экспорт', exact: true }).click();
          await (await dl).saveAs(resolve(artifacts, 'manager-counts.csv'));
          const csv = await readFile(resolve(artifacts, 'manager-counts.csv'), 'utf8');
          assert.doesNotMatch(csv, /Стоимость заказов, мин|Получено платежей, мин|Средний чек, мин|Валюта/);
        } else {
          await s.page.locator('.sales-statistics-kpi-action').first().click(); await ready(s.page);
          await s.page.getByRole('dialog').getByRole('button', { name: 'QA-1-0', exact: true }).click(); await ready(s.page);
          assert.equal(new URL(s.page.url()).searchParams.get('section'), 'overview', 'Accountant does not navigate to Orders');
          await expect.poll(() => s.latest()?.clientId).toBe('browser-client-4');
          await s.page.goto(base.origin + startQuery); await ready(s.page);
        }
        await s.page.locator('.sales-statistics-mode label').filter({ hasText: /^Обзор$/ }).click();
        await expect(s.page.locator('.overview-kpi')).toHaveCount(role === 'ACCOUNTANT' ? 3 : 4);
      }
      await expect(s.page.getByRole('heading', { name: 'Мои задачи', exact: true })).toHaveCount(role === 'ACCOUNTANT' ? 0 : 1);
      await expect(s.page.getByRole('heading', { name: 'Последние сообщения', exact: true })).toHaveCount(role === 'MANAGER' ? 1 : 0);
      await s.page.screenshot({ path: resolve(artifacts, `overview-${role}.png`), fullPage: true });
    } finally { await s.finish(`role-${role}-overview`); }
  });
  await scenario('owner default Overview preserves seven KPI and five independent domains', async () => {
    const s = await session();
    try {
      await s.page.goto(base.origin + '/?section=overview&period=2026-10&currency=EUR');
      await expect(s.page.locator('.overview-page')).toHaveAttribute('data-overview-ready', 'true');
      await expect(s.page.locator('.overview-kpi')).toHaveCount(7);
      await expect(s.page.getByRole('heading', { name: 'Мои задачи', exact: true })).toBeVisible();
      await expect(s.page.getByRole('heading', { name: 'Последние сообщения', exact: true })).toBeVisible();
      await expect.poll(() => new Set(s.calls.filter(c => c.path.startsWith('/api/overview/') || c.path === '/api/finance/report').map(c => c.path)).size).toBe(5);
      assert.equal(s.calls.filter(c => c.path === statsPath).length, 0);
      await s.page.screenshot({ path: resolve(artifacts, 'overview-OWNER.png') });
      await s.page.setViewportSize({ width: 820, height: 1180 });
      assert.equal(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Overview tablet header stays within viewport');
      const modeBox = await s.page.locator('.overview-mode-control').boundingBox();
      assert.ok(modeBox && modeBox.x >= 0 && modeBox.x + modeBox.width <= 820);
      await s.page.screenshot({ path: resolve(artifacts, 'overview-OWNER-820.png') });
      await s.page.locator('label').filter({ hasText: /^Статистика$/ }).click(); await ready(s.page);
      assert.equal(s.latest().from, '2026-10-01'); assert.equal(s.latest().to, '2026-10-31');
      await s.page.locator('.sales-statistics-mode label').filter({ hasText: /^Обзор$/ }).click();
      await expect(s.page.locator('.overview-kpi')).toHaveCount(7);
      await s.page.reload(); await expect(s.page.locator('.overview-kpi')).toHaveCount(7);
    } finally { await s.finish('owner-overview'); }
  });
  for (const [name, options, text] of [['empty',{empty:true},'За выбранный период данных нет'],['missing-fx',{missingFx:true},'Часть денежных показателей недоступна']]) await scenario(name, async () => {
    const s = await session('OWNER', options);
    try {
      await s.page.goto(base.origin + startQuery); await ready(s.page);
      await expect(s.page.locator('.sales-statistics-page')).toContainText(text);
      if (name === 'missing-fx') {
        await expect(s.page.locator('.sales-statistics-kpi').nth(5).locator('strong')).toHaveText('—');
        await s.page.goto(base.origin+'?section=overview&view=statistics&from=2026-10-01&to=2026-10-31');await ready(s.page);
        await expect(s.page.locator('.sales-statistics-kpi-previous').nth(5)).toHaveText('—');
        await expect(s.page.locator('.sales-statistics-kpi').nth(5).locator('.sales-statistics-comparison')).toHaveText('—');
      }
      await s.page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true });
    } finally { await s.finish(name); }
  });
  await scenario('cash-only receipts stay in cash rankings and out of sales rankings', async () => {
    for(const role of ['OWNER','MANAGER']) {
      const s=await session(role,{cashOnly:true});
      try {
        await s.page.goto(base.origin+startQuery);await ready(s.page);
        const clients=s.page.locator('.sales-statistics-top-clients');
        const countries=s.page.locator('.sales-statistics-panel').filter({has:s.page.getByRole('heading',{name:'ТОП-10 стран по заказам',exact:true})});
        await expect(clients.locator('tbody tr')).toHaveCount(0);
        await expect(countries.locator('tbody tr')).toHaveCount(0);
        if(role==='OWNER'){
          const before=await s.page.locator('.sales-statistics-financial-summary strong').allTextContents();
          await select(s.page,'Ранжирование клиентов','Получено платежей');await ready(s.page);
          await expect(clients.locator('tbody tr')).not.toHaveCount(0);
          assert.deepEqual(await s.page.locator('.sales-statistics-financial-summary strong').allTextContents(),before,'Cash totals stay unchanged');
          await select(s.page,'Ранжирование клиентов','Заказы');await ready(s.page);
          await expect(clients.locator('tbody tr')).toHaveCount(0);
        }
      } finally {await s.finish(`cash-ranking-${role}`)}
    }
  });

  await scenario('cash-only missing FX keeps financial analytics instead of a fabricated empty period', async () => {
    const s = await session('OWNER', { cashOnly: true, missingFx: true });
    try {
      await s.page.goto(base.origin + startQuery); await ready(s.page);
      await expect(s.page.locator('.sales-statistics-kpi').first().locator('strong')).toHaveText('0');
      await expect(s.page.locator('.sales-statistics-page > .sales-statistics-state')).toHaveCount(0);
      await expect(s.page.locator('.sales-statistics-grid > article')).toHaveCount(9);
      await expect(s.page.locator('.sales-statistics-page')).toContainText('Часть денежных показателей недоступна');
      await expect(s.page.locator('.sales-statistics-financial-summary strong').first()).toHaveText('—');
      await s.page.screenshot({ path: resolve(artifacts, 'cash-only-missing-fx.png') });
    } finally { await s.finish('cash-only-missing-fx'); }
  });
});
