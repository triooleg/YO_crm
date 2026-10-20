import {test,expect,type Page} from '@playwright/test';
import {overviewTargets} from '../lib/overview-navigation';

async function fixture(page:Page){
 const calls:{path:string;method:string;query:URLSearchParams}[]=[];
 const clients=[{id:'oct',displayName:'Anna October',athletes:[],orders:[],activities:[]},{id:'old',displayName:'Anna September',athletes:[],orders:[],activities:[]}];
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;calls.push({path,method:request.method(),query:url.searchParams});
  if(path==='/api/auth/me')return route.fulfill({json:{user:{role:'OWNER',displayName:'QA'}}});
  if(path==='/api/branding')return route.fulfill({json:{}});
  if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  if(path==='/api/clients')return route.fulfill({json:clients.filter(client=>(!url.searchParams.get('period')||client.id==='oct')&&client.displayName.toLowerCase().includes((url.searchParams.get('search')||'').toLowerCase()))});
  if(path.endsWith('/merge-suggestions'))return route.fulfill({json:[]});
  if(path.startsWith('/api/clients/'))return route.fulfill({json:clients.find(client=>path.endsWith('/'+client.id))});
  if(path==='/api/finance/report/options')return route.fulfill({json:{clients:[],orders:[]}});
  if(path==='/api/finance/report'){
   const month=url.searchParams.get('month')!,currency=url.searchParams.get('currency')!,tab=url.searchParams.get('tab')!;
   return route.fulfill({json:{month,currency,valuationVersion:'fixture',valuation:{provider:'NBU'},today:'2026-10-15',forecastUntil:'2026-11-14',current:{receivedMinor:1000,expensesMinor:200,resultMinor:800},previous:{receivedMinor:0,expensesMinor:0,resultMinor:0},debtMinor:0,forecastMinor:0,forecastCount:0,invoiceCount:0,invoiceTotalMinor:0,unpaidInvoiceCount:0,monthlyTrend:[{month,receivedMinor:1000,expensesMinor:200,resultMinor:800}],categoryBreakdown:[],recentExpenses:[],upcoming:[],table:{tab,rows:[],page:1,pageSize:10,total:0},options:{clients:[],orders:[],categories:[]}}});
  }
  return route.fulfill({json:[]});
 });return calls;
}
const href=(target:ReturnType<typeof overviewTargets.finance>)=>'/?'+new URLSearchParams({section:target.section,...target.context});
for(const [tab,metric] of [['expenses','expenses'],['invoices','result'],['payments','received']])test(`Overview Finance restores ${tab}/${metric} over saved currency and reload`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('finance-report-currency','EUR'));
 const calls=await fixture(page);await page.goto(href(overviewTargets.finance('2026-09','USD',tab,metric)));
 await expect(page.locator('.finance-report-kpi')).toHaveCount(6);
 const last=()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)!.query;
 await expect.poll(()=>[last()?.get('month'),last()?.get('currency'),last()?.get('tab')]).toEqual(['2026-09','USD',tab]);
 const metricLabel=({result:'Финансовый результат',expenses:'Расходы',received:'Поступления'} as Record<string,string>)[metric];
 await expect(page.getByRole('radio',{name:metricLabel,exact:true})).toBeChecked();
 await page.reload();await expect(page.locator('.finance-report-kpi')).toHaveCount(6);
 await expect.poll(()=>[last()?.get('month'),last()?.get('currency'),last()?.get('tab')]).toEqual(['2026-09','USD',tab]);
 await expect(page.getByRole('radio',{name:metricLabel,exact:true})).toBeChecked();
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});
test('late client period response cannot overwrite the cleared list',async({page})=>{
 await fixture(page);await page.goto(href(overviewTargets.clients('2026-10')));
 const banner=page.getByRole('status').filter({hasText:'2026'});await expect(banner).toBeVisible();
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
 let started!:()=>void;const holding=new Promise<void>(resolve=>started=resolve);
 await page.route('**/api/clients?*',async route=>{
  const q=new URL(route.request().url()).searchParams;
  if(q.get('period')==='2026-10'&&q.get('search')==='Anna'){
   started();await held;return route.fulfill({json:[{id:'oct',displayName:'Obsolete period response',athletes:[],orders:[],activities:[]}]});
  }return route.fallback();
 });
 const search=page.getByPlaceholder('Имя, телефон, Instagram…');await search.fill('Anna');
 await holding;await banner.getByRole('button').click();await expect(page.locator('.phase2-client')).toHaveCount(2);
 const finished=page.waitForEvent('requestfinished',{predicate:request=>{const url=new URL(request.url());return url.pathname==='/api/clients'&&url.searchParams.get('period')==='2026-10'&&url.searchParams.get('search')==='Anna'}});
 release();await finished;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('.phase2-client')).toHaveCount(2);await expect(page.locator('.phase2-list')).not.toContainText('Obsolete period response');
});
test('invalid Clients period leaves the ordinary list and search untouched',async({page})=>{
 const calls=await fixture(page);await page.goto('/?section=clients&period=2026-13');
 await expect(page.locator('.phase2-client')).toHaveCount(2);
 expect(calls.filter(call=>call.path==='/api/clients').every(call=>!call.query.has('period')&&!call.query.has('search'))).toBe(true);
 await expect(page.getByPlaceholder('Имя, телефон, Instagram…')).toHaveValue('');
 await expect(page.getByRole('status').filter({hasText:'2026'})).toHaveCount(0);
});
test('client period overflow stays visible and recoverable instead of presenting a login screen',async({page})=>{
 await fixture(page);
 await page.route('**/api/clients?*',route=>{const q=new URL(route.request().url()).searchParams;return q.has('period')&&!q.get('search')?route.fulfill({status:400,json:{message:'За период найдено более 1000 клиентов. Уточните поиск.'}}):route.fallback()});
 await page.goto(href(overviewTargets.clients('2026-10')));
 await expect(page.locator('.phase2-error').filter({hasText:'1000'})).toBeVisible();
 const banner=page.getByRole('status').filter({hasText:'2026'});await expect(banner).toBeVisible();
 await page.getByPlaceholder('Имя, телефон, Instagram…').fill('Anna');
 await expect(page.locator('.phase2-client')).toHaveCount(1);await expect(page.locator('.phase2-error').filter({hasText:'1000'})).toHaveCount(0);
 await banner.getByRole('button').click();
 await expect(page.locator('.phase2-client')).toHaveCount(2);await expect(page.locator('.phase2-error').filter({hasText:'1000'})).toHaveCount(0);
});
test('ordinary client list failure keeps the existing login fallback without period context',async({page})=>{
 await fixture(page);await page.route('**/api/clients',route=>route.fulfill({status:500,json:{message:'Unavailable'}}));
 await page.goto('/?section=clients');
 await expect(page.getByRole('heading',{name:'Вход в Yoleotard CRM',exact:true})).toBeVisible();
});
test('invalid Finance URL context preserves saved currency and ordinary defaults',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('finance-report-currency','UAH'));
 const calls=await fixture(page);await page.goto('/?section=finance&period=2026-13&currency=GBP&tab=bad&metric=bad');
 await expect(page.locator('.finance-report-kpi')).toHaveCount(6);
 const query=calls.filter(call=>call.path==='/api/finance/report').at(-1)!.query;
 expect(query.get('month')).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);expect(query.get('currency')).toBe('UAH');expect(query.get('tab')).toBe('payments');
 await expect(page.getByRole('radio',{name:'Поступления',exact:true})).toBeChecked();
});
test('Overview Clients period stays separate from search and can be visibly cleared',async({page})=>{
 const calls=await fixture(page);await page.goto(href(overviewTargets.clients('2026-10')));
 await expect(page.locator('.phase2-client').filter({hasText:'Anna October'})).toBeVisible();
 await expect.poll(()=>calls.filter(call=>call.path==='/api/clients').at(-1)?.query.get('period')).toBe('2026-10');
 const banner=page.getByRole('status').filter({hasText:'2026'});await expect(banner).toBeVisible();
 const search=page.getByPlaceholder('Имя, телефон, Instagram…');await expect(search).toHaveValue('');await search.fill('Anna');
 await expect.poll(()=>calls.filter(call=>call.path==='/api/clients').at(-1)?.query.get('search')).toBe('Anna');
 expect(calls.filter(call=>call.path==='/api/clients').at(-1)!.query.get('period')).toBe('2026-10');
 await banner.getByRole('button').click();
 await expect.poll(()=>calls.filter(call=>call.path==='/api/clients').at(-1)?.query.has('period')).toBe(false);
 await expect(page.locator('.phase2-client')).toHaveCount(2);await expect(search).toHaveValue('Anna');
 await expect(page).not.toHaveURL(/period=/);await expect(banner).toHaveCount(0);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});
