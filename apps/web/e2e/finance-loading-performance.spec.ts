import {test,expect,type Page} from '@playwright/test';

const cash={receivedMinor:10000,expensesMinor:1000,resultMinor:9000};
function report(params:URLSearchParams){
 const summary=params.get('projection')==='summary',tab=params.get('tab')||'payments';
 return {projection:summary?'summary':undefined,month:params.get('month')||'2026-11',currency:params.get('currency')||'EUR',valuationVersion:'v1',valuation:{provider:'NBU',effectiveDate:'2026-11-02',fetchedAt:'2026-11-02',officialUrl:null},today:'2026-11-02',forecastUntil:'2026-12-02',current:cash,previous:cash,debtMinor:14000,forecastMinor:14000,forecastCount:1,invoiceCount:0,invoiceTotalMinor:0,unpaidInvoiceCount:0,monthlyTrend:[{month:'2026-11',...cash}],categoryBreakdown:[],recentExpenses:[],upcoming:[],table:{tab,rows:summary?[]:[{id:'p',orderId:'o',number:'26-TEST',clientId:'c',clientName:'Synthetic customer',date:'2026-11-02',amountMinor:24000,paidMinor:10000,balanceMinor:14000,status:'PARTIAL',method:'BANK_TRANSFER',notes:null,originalCurrency:'EUR',originalAmountMinor:24000,originalPaidMinor:10000,originalBalanceMinor:14000,roundingDifferenceMinor:0,forecastDate:null,forecastSource:null}],total:summary?0:1,page:Number(params.get('page')||1),pageSize:10},options:{clients:[],categories:[],orders:[]}};
}
async function fixture(page:Page,waitFull?:Promise<void>,role='OWNER'){
 const calls:{path:string;params:URLSearchParams;method:string}[]=[];
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());calls.push({path:url.pathname,params:url.searchParams,method:request.method()});
  if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:{id:'qa',role,displayName:'QA'}}});
  if(url.pathname==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  if(url.pathname==='/api/orders/website-notifications')return route.fulfill({json:{unreadCount:0,items:[]}});
  if(url.pathname==='/api/finance/report/options')return route.fulfill({json:{orders:[],clients:[]}});
  if(url.pathname==='/api/finance/report'){
   if(url.searchParams.get('projection')!=='summary'&&waitFull)await waitFull;
   return route.fulfill({json:report(url.searchParams)});
  }
  return route.fulfill({json:{}});
 });return Object.assign(calls,{errors});
}
test('cards appear before deferred table; table sorting and search skip summary/rate refresh',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const calls=await fixture(page,gate);
 await page.goto('/?section=finance&period=2026-11');
 await expect(page.locator('.finance-report-kpi').filter({hasText:'Долги клиентов'})).toContainText('140,00');
 await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','true');
 await expect(page.getByRole('button',{name:'Добавить оплату',exact:true})).toBeDisabled();
 await expect(page.getByText('26-TEST',{exact:true})).toHaveCount(0);
 release();await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');
 await expect(page.getByRole('button',{name:'26-TEST',exact:true})).toBeVisible();
 expect(calls.filter(c=>c.path==='/api/finance/report').map(c=>c.params.get('projection'))).toEqual(['summary',null]);
 const rates=()=>calls.filter(c=>c.path.endsWith('/ensure-current')).length;
 const summaries=()=>calls.filter(c=>c.params.get('projection')==='summary').length;
 expect(rates()).toBe(1);
 expect(calls.filter(c=>c.path==='/api/finance/report/options')).toHaveLength(0);
 await page.getByRole('button',{name:'Сортировать: Сумма',exact:true}).click();
 await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');
 await expect.poll(()=>calls.filter(c=>c.path==='/api/finance/report').length).toBe(3);
 const search=page.getByRole('textbox',{name:'Поиск по клиенту, заказу…',exact:true});await search.fill('synthetic');
 await expect.poll(()=>calls.filter(c=>c.path==='/api/finance/report').at(-1)?.params.get('search')).toBe('synthetic');
 expect(rates()).toBe(1);expect(summaries()).toBe(1);
 const reads=calls.filter(c=>c.path==='/api/finance/report').length;
 await page.locator('.finance-report-trend').getByText('Расходы',{exact:true}).click();
 expect(calls.filter(c=>c.path==='/api/finance/report').length).toBe(reads);
 expect(calls.errors).toEqual([]);
 await page.screenshot({path:'../../.local/finance-perf/finance-loading-desktop.png',fullPage:true});
});
test('Overview requests only summary without transaction tables',async({page})=>{
 const calls=await fixture(page,undefined,'ACCOUNTANT');await page.goto('/?section=overview&period=2026-11');
 await expect.poll(()=>calls.filter(c=>c.path==='/api/finance/report').length).toBe(1);
 expect(calls.find(c=>c.path==='/api/finance/report')?.params.get('projection')).toBe('summary');
 await expect(page.locator('.overview-finance-card')).toBeVisible();expect(calls.errors).toEqual([]);
});
for(const width of [1920,1366,390])test(`finance layout remains usable at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===1920?1080:768});const calls=await fixture(page);
 await page.goto('/?section=finance&period=2026-11');
 await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');
 await expect(page.locator('.finance-report-kpi')).toHaveCount(8);
 await page.getByRole('button',{name:'Закрыть подсказку о расчёте показателей',exact:true}).click();
 const overflow=await page.locator('body').evaluate(element=>element.scrollWidth>window.innerWidth+1);
 expect(overflow).toBe(false);expect(calls.errors).toEqual([]);
 await page.screenshot({path:`../../.local/finance-perf/finance-loading-${width}.png`,fullPage:true});
 await page.locator('.finance-report-table').scrollIntoViewIfNeeded();
 await expect(page.locator('.finance-report-table')).toContainText('26-TEST');
 await page.screenshot({path:`../../.local/finance-perf/finance-loading-details-${width}.png`,fullPage:true});
});
test('unsettled search disables export and old row actions throughout debounce',async({page})=>{
 await fixture(page);await page.goto('/?section=finance&period=2026-11');
 await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');
 await page.clock.install({time:new Date('2026-11-02T12:00:00Z')});
 await page.clock.pauseAt(new Date('2026-11-02T12:00:01Z'));
 await page.getByRole('textbox',{name:'Поиск по клиенту, заказу…',exact:true}).fill('new search');
 expect(await page.getByRole('button',{name:'Экспорт ⌄',exact:true}).isDisabled()).toBe(true);
 expect(await page.getByRole('button',{name:'Действия: 26-TEST',exact:true}).isDisabled()).toBe(true);
 await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','true');
 await page.clock.runFor(300);
 await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');
});
test('failed financial read ends the busy state and offers retry',async({page})=>{
 await fixture(page);
 await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/finance/report'?route.fulfill({status:503,json:{message:'Synthetic report unavailable'}}):route.fallback());
 await page.goto('/?section=finance&period=2026-11');
 await expect(page.getByRole('alert').filter({hasText:'Synthetic report unavailable'})).toBeVisible();
 await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');
});
