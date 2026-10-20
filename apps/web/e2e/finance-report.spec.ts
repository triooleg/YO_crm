import {test,expect,type Page} from '@playwright/test';
import {join} from 'node:path';

test('order deep-link filter stays visible and can be removed without leaving Finance',async({page})=>{
 const calls=await setup(page);await page.goto('/?section=finance&orderId=order-1');
 await expect(page.getByRole('status').filter({hasText:'Заказ: TEST-001'})).toBeVisible();
 await page.getByRole('button',{name:'Снять фильтр заказа',exact:true}).click();
 await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.has('orderId')).toBe(false);
 await expect(page).not.toHaveURL(/orderId=/);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});
import { moveFinanceMonth } from '../lib/finance-report';

// Synthetic reporting records only; no customer data or provider requests.
async function setup(page:Page,role='OWNER',options:{conflictExport?:boolean;delayDetail?:Promise<void>}={}){
 const calls:{path:string;method:string;query:URLSearchParams}[]=[];let conflict=options.conflictExport;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;calls.push({path,method:route.request().method(),query:url.searchParams});
  if(path==='/api/auth/me')return route.fulfill({json:{user:{role,displayName:'QA',email:'qa@example.test'}}});
  if(path==='/api/branding')return route.fulfill({json:{}});
  if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  if(path==='/api/finance/report/options')return route.fulfill({json:{orders:[{id:'order-remote',number:'REMOTE-1001',clientName:'Удалённый клиент',currency:'EUR'}],clients:[{id:'remote-client',name:'Удалённый клиент'}],limit:100}});
  if(path==='/api/finance/report/export'){if(conflict){conflict=false;return route.fulfill({status:409,json:{message:'Changed valuation'}})}return route.fulfill({contentType:'text/csv',body:'number,amount\nTEST-001,120.00'});}
  if(path.startsWith('/api/finance/report/orders/')){if(options.delayDetail)await options.delayDetail;return route.fulfill({json:{id:'order-1',number:'TEST-001',priceMinor:50000,depositRequiredMinor:25000,currency:'EUR',displayCurrency:url.searchParams.get('currency'),archivedAt:null,client:{displayName:'Тестовый клиент',country:'Ukraine',language:'ru'},payments:[{id:'p1',amountMinor:25000,currency:'EUR',displayAmountMinor:25000,receivedAt:'2026-10-10T12:00:00Z',method:'BANK_TRANSFER'}],invoices:[]}});}
  if(path==='/api/finance/settings')return route.fulfill({json:[]});
  if(path==='/api/finance/report'){
   const month=url.searchParams.get('month')||'2026-10',currency=url.searchParams.get('currency')||'EUR',tab=url.searchParams.get('tab')||'payments',mult=currency==='UAH'?40:currency==='USD'?1.1:1;
   const amount=(n:number)=>Math.round(n*mult),payment={id:'row-1',orderId:'order-1',number:'TEST-001',clientId:'client-1',clientName:'Тестовый клиент',date:'2026-10-10T12:00:00Z',amountMinor:amount(50000),paidMinor:amount(25000),balanceMinor:amount(25000),status:'PARTIAL',method:'BANK_TRANSFER',notes:'Длинное примечание клиента, размеры и пожелания для изготовления. '.repeat(12),originalCurrency:'EUR',originalAmountMinor:50000,originalPaidMinor:25000,originalBalanceMinor:25000,roundingDifferenceMinor:0,forecastDate:'2026-10-21',forecastSource:'deadline'};
   const expense={id:'expense-1',date:'2026-10-10',categoryId:'materials',categoryName:'Материалы',orderId:'order-1',number:'TEST-001',notes:'Ткань',amountMinor:amount(4500),originalAmountMinor:4500,originalCurrency:'EUR',shipmentId:null};
   const invoice={id:'inv-1',orderId:'order-1',number:'INV-001',orderNumber:'TEST-001',clientId:'client-1',clientName:'Тестовый клиент',date:'2026-10-10',dueDate:'2026-10-21',status:'ISSUED',amountMinor:amount(50000),paidMinor:null,balanceMinor:null,originalCurrency:'EUR',originalAmountMinor:50000};
   return route.fulfill({json:{month,currency,valuationVersion:'v1',valuation:{provider:'NBU',effectiveDate:'2026-10-15',fetchedAt:'2026-10-15T08:00:00Z',officialUrl:'https://bank.gov.ua/'},today:'2026-10-15',forecastUntil:'2026-11-14',current:{receivedMinor:amount(312368),expensesMinor:amount(62435),resultMinor:amount(249933)},previous:{receivedMinor:amount(745872),expensesMinor:amount(48800),resultMinor:amount(697072)},debtMinor:amount(124000),forecastMinor:amount(218000),forecastCount:6,invoiceCount:3,invoiceTotalMinor:amount(145000),unpaidInvoiceCount:2,monthlyTrend:Array.from({length:6},(_,index)=>moveFinanceMonth(month,index-5)).map((value,i)=>({month:value,receivedMinor:amount([460315,593098,521900,882381,745872,312368][i]!),expensesMinor:amount([32050,41020,29530,52015,48800,62435][i]!),resultMinor:amount([428265,552078,492370,830366,697072,249933][i]!)})),categoryBreakdown:[{id:'delivery',name:'Доставка',amountMinor:amount(30035)},{id:'materials',name:'Материалы',amountMinor:amount(13200)},{id:'fees',name:'Комиссии',amountMinor:amount(8640)},{id:'packaging',name:'Упаковка',amountMinor:amount(6210)},{id:'other',name:'Прочие',amountMinor:amount(4350)}],recentExpenses:[expense],upcoming:[payment],table:{tab,rows:tab==='expenses'?[expense]:tab==='invoices'?[invoice]:[payment],total:1,page:Number(url.searchParams.get('page')||1),pageSize:Number(url.searchParams.get('pageSize')||10)},options:{clients:[{id:'client-1',name:'Тестовый клиент'}],categories:[{id:'materials',name:'Материалы'}],orders:[{id:'order-1',number:'TEST-001',clientName:'Тестовый клиент',currency:'EUR'}]}}});
  }
  return route.fulfill({json:[]});
 });return calls;
}

for(const [width,height] of [[1536,1024],[1703,895],[1920,1080],[1440,900],[1366,768],[820,1180],[390,844]])test(`approved finance report keeps controls and bounded layout ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const calls=await setup(page);await page.goto('/?section=finance');
 await expect(page.locator('.finance-report-kpi')).toHaveCount(6);await expect(page.getByRole('button',{name:'Предыдущий месяц',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Следующий месяц',exact:true})).toBeVisible();
 await expect(page.locator('.finance-report-table')).toContainText('TEST-001');
 await expect(page.getByPlaceholder('От даты',{exact:true})).toBeVisible();await expect(page.getByPlaceholder('До даты',{exact:true})).toBeVisible();
 await expect.poll(()=>page.locator('.finance-report-bar-chart').evaluate((node:SVGSVGElement)=>Math.abs(node.viewBox.baseVal.width-node.clientWidth))).toBeLessThan(2);
 if(width===390)await expect(page.locator('.finance-chart-value')).toHaveCount(0);
 const number=page.locator('.finance-report-table .finance-report-link').first();expect(await number.evaluate(node=>getComputedStyle(node).whiteSpace)).toBe('nowrap');
 expect(await page.locator('.finance-report-table .mantine-Badge-label').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 if(width>=1703){const boxes=await page.locator('.finance-report-kpi').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));expect(new Set(boxes).size).toBe(1);}
 await page.screenshot({path:process.env.YO_CRM_VISUAL_DIR?join(process.env.YO_CRM_VISUAL_DIR,`finance-approved-${width}.png`):info.outputPath(`finance-approved-${width}.png`),fullPage:true});
 const beforeOpenKpi=await page.locator('.finance-report-kpis').boundingBox();await page.getByRole('combobox',{name:'Валюта отчёта'}).click();await expect(page.getByRole('option',{name:'$ USD',exact:true})).toBeVisible();
 const menuBox=await page.getByRole('listbox').boundingBox(),kpiBox=await page.locator('.finance-report-kpis').boundingBox();expect(menuBox!.y+menuBox!.height).toBeLessThanOrEqual(kpiBox!.y);
 expect(kpiBox!.y).toBeCloseTo(beforeOpenKpi!.y,0);expect(menuBox!.x).toBeGreaterThanOrEqual(0);expect(menuBox!.x+menuBox!.width).toBeLessThanOrEqual(width);expect(menuBox!.y).toBeGreaterThanOrEqual(0);
 await page.getByRole('button',{name:'Предыдущий месяц',exact:true}).click({trial:true});await page.getByRole('button',{name:'Следующий месяц',exact:true}).click({trial:true});
 await page.screenshot({path:info.outputPath(`finance-currency-open-${width}.png`)});await page.keyboard.press('Escape');
 const first=calls.find(call=>call.path==='/api/finance/report')!.query.get('month');await page.getByRole('button',{name:'Предыдущий месяц',exact:true}).click();await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('month')).not.toBe(first);
 await page.getByRole('button',{name:'Следующий месяц',exact:true}).click();await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('month')).toBe(first);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);expect(errors).toEqual([]);
});

test('currency and three tables use report projection, nullable invoice allocations and read-only load',async({page})=>{
 const calls=await setup(page,'ACCOUNTANT');await page.goto('/?section=finance');await expect(page.locator('.finance-report-kpi')).toHaveCount(6);await expect(page.getByRole('button',{name:'Добавить оплату',exact:true})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Валюта отчёта'}).click();await page.getByRole('option',{name:'$ USD',exact:true}).click();await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('currency')).toBe('USD');
 await page.getByRole('tab',{name:'Расходы',exact:true}).click();await expect(page.locator('.finance-report-table')).toContainText('Ткань');await page.getByRole('tab',{name:'Инвойсы',exact:true}).click();await expect(page.locator('.finance-report-table')).toContainText('INV-001');await expect(page.locator('.finance-report-table')).not.toContainText('NaN');
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});
test('legacy new-invoice context opens after initial filtered report without a cancellation race',async({page})=>{
 await setup(page);await page.goto('/?section=finance&orderId=order-1&action=new-invoice');await expect(page.getByRole('dialog')).toContainText('Редактор инвойса');await expect(page).not.toHaveURL(/action=new-invoice/);
});
test('valuation conflict on export refreshes complete report and announces the change',async({page})=>{
 const calls=await setup(page,'OWNER',{conflictExport:true});await page.goto('/?section=finance');await expect(page.locator('.finance-report-kpi')).toHaveCount(6);await page.getByRole('button',{name:/Экспорт/}).click();await page.getByRole('menuitem',{name:'Скачать CSV текущего списка'}).click();await expect(page.getByRole('status').filter({hasText:'Курсы или дата оценки изменились'})).toBeVisible();await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').length).toBeGreaterThan(1);expect(calls.find(call=>call.path==='/api/finance/report/export')!.query.get('valuationVersion')).toBe('v1');
});
test('failed FX report never replaces amounts with fabricated zero',async({page})=>{
 await setup(page);await page.route('**/api/finance/report?*',route=>route.fulfill({status:422,json:{message:'Нет действующего курса USD'}}));await page.goto('/?section=finance');await expect(page.locator('.finance-report-page').getByRole('alert')).toContainText('Нет действующего курса USD');await expect(page.locator('.finance-report-kpi')).toHaveCount(0);
});
test('stale detail action after filter change does not leave the order picker busy',async({page})=>{
 let release!:()=>void;const delay=new Promise<void>(resolve=>release=resolve);await setup(page,'OWNER',{delayDetail:delay});await page.goto('/?section=finance');await expect(page.locator('.finance-report-kpi')).toHaveCount(6);
 await page.locator('.finance-report-table').getByRole('button',{name:'Действия: TEST-001'}).click();await page.getByRole('menuitem',{name:'История оплат'}).click();
 await page.getByRole('button',{name:'Следующий месяц',exact:true}).click();await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');release();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Добавить оплату',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('combobox').click();await page.getByRole('option',{name:/TEST-001/}).click();await expect(dialog.getByRole('button',{name:'Открыть',exact:true})).toBeEnabled();
});
test('expense saves exact minor units in chosen operation currency and supports remote orders',async({page})=>{
 await setup(page);const writes:Record<string,unknown>[]=[];await page.route('**/api/finance/expenses',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{id:'new'}})});await page.goto('/?section=finance');await page.getByRole('button',{name:'Добавить расход',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Сумма',exact:true}).fill('34,50');await dialog.getByRole('combobox',{name:'Валюта операции'}).click();await page.getByRole('option',{name:'USD',exact:true}).click();
 await dialog.getByRole('combobox',{name:'Заказ',exact:true}).fill('REMOTE');await page.getByRole('option',{name:/REMOTE-1001/}).click();await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({amountMinor:3450,currency:'USD',categoryId:'materials',orderId:'order-remote'});
});
test('existing open invoice of an archived order still opens from narrow finance detail',async({page})=>{
 await setup(page);await page.route('**/api/finance/report/orders/order-1?*',route=>route.fulfill({json:{id:'order-1',number:'TEST-001',archivedAt:'2026-10-14',priceMinor:50000,depositRequiredMinor:25000,currency:'EUR',displayCurrency:'EUR',client:{displayName:'Тестовый клиент'},payments:[],invoices:[{id:'inv-1',number:'INV-001',status:'ISSUED',language:'ru',currency:'EUR',issueDate:'2026-10-01',totalMinor:50000,items:[{description:'Товар',quantity:1,amountMinor:50000}]}]}}));await page.goto('/?section=finance');await page.getByRole('tab',{name:'Инвойсы',exact:true}).click();await expect(page.locator('.finance-report-table')).toContainText('INV-001');await page.locator('.finance-report-table').getByRole('button',{name:'Действия: INV-001'}).click();await page.getByRole('menuitem',{name:'Изменить',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Редактирование инвойса');
});


test('all expense entry points clear hidden client filters and page sizes match the API',async({page})=>{
 const calls=await setup(page);await page.goto('/?section=finance');await expect(page.locator('.finance-report-table')).toContainText('TEST-001');
 for(const entry of ['tab','donut','sidebar']){
  await page.getByRole('tab',{name:'Платежи и задолженности',exact:true}).click();
  await page.getByRole('combobox',{name:'Клиент',exact:true}).click();await page.getByRole('option',{name:'Тестовый клиент',exact:true}).click();
  await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('clientId')).toBe('client-1');
  if(entry==='tab')await page.getByRole('tab',{name:'Расходы',exact:true}).click();
  else if(entry==='donut')await page.locator('.finance-report-category-list').getByRole('button').filter({hasText:'Материалы'}).click();
  else await page.locator('.finance-report-side article').first().getByRole('button',{name:/Все/}).click();
  await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('tab')).toBe('expenses');
  expect(calls.filter(call=>call.path==='/api/finance/report').at(-1)!.query.has('clientId')).toBe(false);
  await expect(page.locator('.finance-report-table')).toContainText('Ткань');
 }
 const size=page.locator('.finance-report-pagination').getByRole('combobox');
 for(const value of [25,50,100,10]){
  await size.click();await expect(page.getByRole('option',{name:/^20 /})).toHaveCount(0);
  await page.getByRole('option',{name:new RegExp(`^${value} строк$`)}).click();
  await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('pageSize')).toBe(String(value));
 }
});

test('paid and balance table tooltips show their own original allocations',async({page})=>{
 await setup(page);await page.goto('/?section=finance');await expect(page.locator('.finance-report-table')).toContainText('TEST-001');
 const cells=page.locator('.finance-report-table tbody tr').first().locator('td');
 await cells.nth(4).locator('span').first().hover();await expect(page.getByRole('tooltip')).toContainText(/250,00/);await expect(page.getByRole('tooltip')).not.toContainText(/500,00/);
 await cells.nth(5).locator('span').first().hover();await expect(page.getByRole('tooltip')).toContainText(/250,00/);
});

test('manual month and year selection preserves currency tab and report filters',async({page})=>{
 const calls=await setup(page);await page.goto('/?section=finance');await expect(page.locator('.finance-report-table')).toContainText('TEST-001');
 await page.getByRole('combobox',{name:'Валюта отчёта'}).click();await page.getByRole('option',{name:'$ USD',exact:true}).click();
 await page.getByRole('tab',{name:'Инвойсы',exact:true}).click();await expect(page.locator('.finance-report-table')).toContainText('INV-001');
 await page.getByRole('combobox',{name:'Клиент',exact:true}).click();await page.getByRole('option',{name:'Тестовый клиент',exact:true}).click();
 await page.getByRole('combobox',{name:'Статус',exact:true}).click();await page.getByRole('option',{name:'Выставлен',exact:true}).click();
 const search=page.getByRole('textbox',{name:'Поиск по клиенту, заказу…'});await search.fill('INV-001');
 await page.getByLabel('От даты',{exact:true}).fill('01.01.2025');await page.getByLabel('До даты',{exact:true}).fill('31.12.2027');
 await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('to')).toBe('2027-12-31');
 const before=calls.filter(call=>call.path==='/api/finance/report').at(-1)!.query;
 const currentYear=Number(before.get('month')!.slice(0,4)),targetYear=currentYear%10===0?currentYear+1:currentYear-1;
 const trigger=page.getByRole('button',{name:'Выбрать месяц и год',exact:true});await trigger.click();
 await page.getByRole('button',{name:String(currentYear),exact:true}).click();
 await page.getByRole('button',{name:String(targetYear),exact:true}).click();
 await page.getByRole('button',{name:/^март\.?$/i}).click();
 await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('month')).toBe(`${targetYear}-03`);
 await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(trigger).toContainText(`Март ${targetYear}`);
 const after=calls.filter(call=>call.path==='/api/finance/report').at(-1)!.query;
 for(const key of ['currency','tab','clientId','status','search','from','to'])expect(after.get(key)).toBe(before.get(key));
 await expect(page.getByRole('combobox',{name:'Валюта отчёта'})).toHaveValue('$ USD');
 await expect(page.getByRole('tab',{name:'Инвойсы',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('combobox',{name:'Клиент',exact:true})).toHaveValue('Тестовый клиент');
 await expect(page.getByRole('combobox',{name:'Статус',exact:true})).toHaveValue('Выставлен');await expect(search).toHaveValue('INV-001');
 await expect(page.getByLabel('От даты',{exact:true})).toHaveValue('01.01.2025');await expect(page.getByLabel('До даты',{exact:true})).toHaveValue('31.12.2027');
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});


test('reference-size layout has readable rows, aligned date controls and working expense month selector',async({page})=>{
 await page.setViewportSize({width:1536,height:1024});const calls=await setup(page);await page.goto('/?section=finance');
 await expect(page.locator('.finance-report-kpi')).toHaveCount(6);
 const controls=await page.locator('.finance-report-filters > *').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect()).filter(rect=>rect.width&&rect.height).map(rect=>rect.bottom));
 expect(Math.max(...controls)-Math.min(...controls)).toBeLessThan(2);
 expect(await page.locator('.finance-report-bar-chart').evaluate((node:SVGSVGElement)=>Math.abs(node.viewBox.baseVal.height-node.clientHeight))).toBeLessThan(2);
 expect(await page.locator('.finance-report-table tbody td').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
 expect(await page.locator('.finance-report-mini-table td').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
 const initial=calls.filter(call=>call.path==='/api/finance/report').at(-1)!.query.get('month')!;
 await page.getByRole('button',{name:'Месяц структуры расходов',exact:true}).click();
 await page.getByRole('button',{name:/^март\.?$/i}).click();
 await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('month')).toBe(`${initial.slice(0,4)}-03`);
 await page.getByLabel('От даты',{exact:true}).fill('01.03.2026');await page.getByLabel('От даты',{exact:true}).press('Tab');
 await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('from')).toBe('2026-03-01');
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});


for(const width of [1536,1366,390]) for(const currency of ['EUR','USD','UAH']) test(`chart labels retain clearance and readable donut ${width} ${currency}`,async({page},info)=>{
 await page.setViewportSize({width,height:1024});const calls=await setup(page);
 await page.goto(`/?section=finance&currency=${currency}`);
 await expect(page.locator('.finance-report-kpi')).toHaveCount(6);
 await expect.poll(()=>calls.filter(call=>call.path==='/api/finance/report').at(-1)?.query.get('currency')).toBe(currency);
 const chart=page.locator('.finance-report-bar-chart');
 await expect.poll(()=>chart.evaluate((node:SVGSVGElement)=>Math.abs(node.viewBox.baseVal.width-node.clientWidth))).toBeLessThan(2);
 const collisions=await chart.evaluate(node=>{
  const bars=Array.from(node.querySelectorAll('rect')).map(bar=>bar.getBoundingClientRect());
  return Array.from(node.querySelectorAll('.finance-chart-value')).flatMap(label=>{
   const box=label.getBoundingClientRect();const svg=node.getBoundingClientRect();
   const overlap=bars.some(bar=>bar.height>0&&Math.min(box.right,bar.right)-Math.max(box.left,bar.left)>1&&Math.min(box.bottom,bar.bottom)-Math.max(box.top,bar.top)>1);
   return overlap||box.top<svg.top+4?[label.textContent]:[];
  });
 });expect(collisions).toEqual([]);
 if(width>=1366)await expect(page.locator('.finance-chart-value')).toHaveCount(12);
 const textSizes=await page.locator('.finance-report-donut-content svg text').evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)*(node as SVGTextElement).getScreenCTM()!.a));
 expect(textSizes.length).toBeGreaterThan(0);expect(Math.min(...textSizes)).toBeGreaterThanOrEqual(11.9);
 expect(await page.locator('.finance-report-info').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`finance-fixed-${width}-${currency}.png`),fullPage:true});
 const clearance=await page.locator('.finance-report-table tbody tr').first().evaluate(row=>{
  const badge=row.querySelector('.mantine-Badge-root')!.getBoundingClientRect();
  const cell=row.querySelectorAll('td')[6]!.getBoundingClientRect();
  const method=row.querySelector('.finance-report-method')!.getBoundingClientRect();
  return {inside:badge.right<=cell.right,gap:method.left-badge.right};
 });expect(clearance.inside).toBe(true);expect(clearance.gap).toBeGreaterThanOrEqual(8);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});
