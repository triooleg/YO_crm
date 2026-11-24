import {test,expect,type Page} from '@playwright/test';
import {join} from 'node:path';

const calculationAccepted={id:'tax-test',status:'RUNNING'};
const calculationCompleted={id:'tax-test',status:'COMPLETED',result:{from:'2026-11-09',through:'2026-11-12'}};

for(const [width,height] of [[1920,1080],[1366,768],[390,844]])test(`manual tax calculation posts once and refreshes the selected finance report at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height});
 const calls=await setup(page);
 let writes=0;
 await page.route('**/api/finance/taxes/calculate',route=>{
  expect(route.request().method()).toBe('POST');
  writes++;
  return route.fulfill({status:202,json:calculationAccepted});
 });
 let polls=0;
 await page.route('**/api/finance/taxes/calculate/tax-test',route=>{
  if(++polls===1)return route.fulfill({status:503,json:{message:'Временная ошибка'}});
  return route.fulfill({json:polls===2?calculationAccepted:calculationCompleted});
 });
 await page.goto('/?section=finance&period=2026-10');
 await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');
 await page.screenshot({path:info.outputPath('finance-before-calculation.png')});
 const reads=calls.filter(call=>call.path==='/api/finance/report').length;
 await page.getByRole('button',{name:'Рассчитать',exact:true}).click();
 await expect(page.getByText('Налоговый расчёт выполняется.',{exact:false})).toBeVisible();
 await page.screenshot({path:info.outputPath('finance-during-calculation.png')});
 await expect(page.getByRole('status').filter({hasText:'Налоговый отчёт обновлён'})).toBeVisible({timeout:12_000});
 expect(writes).toBe(1);
 expect(polls).toBe(3);
 expect(calls.filter(call=>call.path==='/api/finance/report').length).toBeGreaterThan(reads);
 await expect(page).toHaveURL(/period=2026-10/);
 await page.screenshot({path:info.outputPath('finance-after-calculation.png')});
});

test('a failed report refresh after calculation shows the error without a success notice',async({page})=>{
 await setup(page);
 await page.route('**/api/finance/taxes/calculate',async route=>{
  return route.fulfill({status:202,json:calculationAccepted});
 });
 await page.route('**/api/finance/taxes/calculate/tax-test',async route=>{
  await page.route('**/api/finance/report?*',report=>report.fulfill({status:503,json:{message:'Отчёт временно недоступен'}}));
  return route.fulfill({json:calculationCompleted});
 });
 await page.goto('/?section=finance');
 await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'Рассчитать',exact:true}).click();
 await expect(page.getByText('Отчёт временно недоступен',{exact:false})).toBeVisible();
 await expect(page.getByText('Налоговый отчёт обновлён',{exact:false})).toHaveCount(0);
});

test('changing month during the calculation refresh does not announce a stale success',async({page})=>{
 await setup(page);
 let calculationStarted=false;
 let releaseOld!:()=>void;
 const oldResponse=new Promise<void>(resolve=>releaseOld=resolve);
 let held=false;
 await page.route('**/api/finance/report?*',async route=>{
  if(!calculationStarted)return route.fallback();
  const month=new URL(route.request().url()).searchParams.get('month');
  if(month==='2026-10'){
   held=true;
   await oldResponse;
   return route.fallback();
  }
  return route.fulfill({status:503,json:{message:'Новый период временно недоступен'}});
 });
 await page.route('**/api/finance/taxes/calculate',route=>{
  return route.fulfill({status:202,json:calculationAccepted});
 });
 await page.route('**/api/finance/taxes/calculate/tax-test',route=>{
  calculationStarted=true;
  return route.fulfill({json:calculationCompleted});
 });
 try{
  await page.goto('/?section=finance&period=2026-10');
  await expect(page.locator('.finance-report-page')).toHaveAttribute('aria-busy','false');
  await page.getByRole('button',{name:'Рассчитать',exact:true}).click();
  await expect.poll(()=>held).toBe(true);
  await page.getByRole('button',{name:'Следующий месяц',exact:true}).click();
  await expect(page.getByText('Новый период временно недоступен',{exact:false})).toBeVisible();
  releaseOld();
  await expect(page.getByText('Налоговый отчёт обновлён',{exact:false})).toHaveCount(0);
 }finally{releaseOld();}
});

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
async function setup(page:Page,role='OWNER',options:{conflictExport?:boolean;delayDetail?:Promise<void>;checkoutEstimate?:boolean;delayReport?:Promise<void>;expenseUpdate?:()=>Promise<boolean|'failed'>}={}){
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
   if(options.delayReport) await options.delayReport;
   const expenseUpdated=await options.expenseUpdate?.();
   if(expenseUpdated==='failed')return route.fulfill({status:503,json:{message:'Temporary test failure'}});
   const month=url.searchParams.get('month')||'2026-10',currency=url.searchParams.get('currency')||'EUR',tab=url.searchParams.get('tab')||'payments',mult=currency==='UAH'?40:currency==='USD'?1.1:1;
   const amount=(n:number)=>Math.round(n*mult),payment={id:'row-1',orderId:'order-1',number:'TEST-001',clientId:'client-1',clientName:'Тестовый клиент',date:'2026-10-10T12:00:00Z',amountMinor:amount(50000),paidMinor:amount(25000),balanceMinor:amount(25000),status:'PARTIAL',method:'BANK_TRANSFER',notes:'Длинное примечание клиента, размеры и пожелания для изготовления. '.repeat(12),originalCurrency:'EUR',originalAmountMinor:50000,originalPaidMinor:25000,originalBalanceMinor:25000,roundingDifferenceMinor:0,forecastDate:'2026-10-21',forecastSource:'deadline'};
   const expense={id:'expense-1',date:'2026-10-10',categoryId:'materials',categoryName:'Материалы',orderId:'order-1',number:'TEST-001',notes:expenseUpdated?'Новый тестовый расход':'Ткань',amountMinor:amount(expenseUpdated?7500:4500),originalAmountMinor:expenseUpdated?7500:4500,originalCurrency:'EUR',shipmentId:null};
   const invoice={id:'inv-1',orderId:'order-1',number:'INV-001',orderNumber:'TEST-001',clientId:'client-1',clientName:'Тестовый клиент',date:'2026-10-10',dueDate:'2026-10-21',status:'ISSUED',amountMinor:amount(50000),paidMinor:null,balanceMinor:null,originalCurrency:'EUR',originalAmountMinor:50000};
   const period={month,receivedMinor:312368,ordinaryExpensesMinor:expenseUpdated?69935:62435,accruedTaxesMinor:23456,resultAfterAccrualMinor:226477,taxPaidMinor:0,cashResultMinor:249933,websiteReceivedMinor:54080,incomplete:true};
   const taxRow={id:'synthetic-tax-row',period:month,source:'RECEIPT',kind:'FINALIZE',paymentId:'test-payment',orderId:'order-1',number:'TEST-001',component:'UNIFIED',status:'CHECKOUT_PRELIMINARY',incomplete:true,uahAmountMinor:138014,amountMinor:2704,valuationBasis:'INCOME_DATE',evidence:{receiptConfirmed:false}};
   const fiscal=options.checkoutEstimate?{current:period,previous:period,trend:[period],missing:[{code:'CHECKOUT_PRELIMINARY',month}],rows:[{...taxRow,source:"PENDING",status:"RECEIPT_CONFIRMATION_REQUIRED"}],expenseStructure:{rows:[],drawable:false,totalMinor:85891},taxSummary:{pendingCount:2}}:undefined;
   return route.fulfill({json:{month,currency,fiscal,projection:(options.checkoutEstimate||options.expenseUpdate)&&url.searchParams.get('projection')==='summary'?'summary':undefined,receiptConfirmationCount:1,valuationVersion:'v1',valuation:{provider:'NBU',effectiveDate:'2026-10-15',fetchedAt:'2026-10-15T08:00:00Z',officialUrl:'https://bank.gov.ua/'},today:'2026-10-15',forecastUntil:'2026-11-14',current:{receivedMinor:amount(312368),expensesMinor:amount(62435),resultMinor:amount(249933)},previous:{receivedMinor:amount(745872),expensesMinor:amount(48800),resultMinor:amount(697072)},debtMinor:amount(124000),forecastMinor:amount(218000),forecastCount:6,invoiceCount:3,invoiceTotalMinor:amount(145000),unpaidInvoiceCount:2,monthlyTrend:Array.from({length:6},(_,index)=>moveFinanceMonth(month,index-5)).map((value,i)=>({month:value,receivedMinor:amount([460315,593098,521900,882381,745872,312368][i]!),expensesMinor:amount([32050,41020,29530,52015,48800,62435][i]!),resultMinor:amount([428265,552078,492370,830366,697072,249933][i]!)})),categoryBreakdown:[{id:'delivery',name:'Доставка',amountMinor:amount(30035)},{id:'materials',name:'Материалы',amountMinor:amount(13200)},{id:'fees',name:'Комиссии',amountMinor:amount(8640)},{id:'packaging',name:'Упаковка',amountMinor:amount(6210)},{id:'other',name:'Прочие',amountMinor:amount(4350)}],recentExpenses:[expense],upcoming:[payment],table:{tab,rows:tab==='expenses'?[expense]:tab==='invoices'?[invoice]:tab==='taxes'&&options.checkoutEstimate?[taxRow]:[payment],total:1,page:Number(url.searchParams.get('page')||1),pageSize:Number(url.searchParams.get('pageSize')||10)},options:{clients:[{id:'client-1',name:'Тестовый клиент'}],categories:[{id:'materials',name:'Материалы'}],orders:[{id:'order-1',number:'TEST-001',clientName:'Тестовый клиент',currency:'EUR'}]}}});
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
test('expense refresh keeps the workspace mounted and makes one background report read',async({page},info)=>{
 await page.clock.install();
 const pageErrors:string[]=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 let saved=false,writes=0,release=()=>{},releaseWrite=()=>{};
 const refresh=new Promise<void>(resolve=>{release=resolve});
 const write=new Promise<void>(resolve=>{releaseWrite=resolve});
 const calls=await setup(page,'OWNER',{checkoutEstimate:true,expenseUpdate:async()=>{
  if(!saved)return false;
  await refresh;
  return true;
 }});
 await page.route('**/api/finance/expenses',async route=>{
  writes++;
  await write;
  saved=true;
  return route.fulfill({json:{id:'new'}});
 });
 try{
  await page.goto('/?section=finance&period=2026-10');
  const workspace=page.locator('.finance-report-page');
  const table=page.locator('.finance-report-table');
  await expect(workspace).toHaveAttribute('aria-busy','false');
  await expect(table).toContainText('TEST-001');
  const before=await table.elementHandle();
  const addExpense=page.getByRole('button',{name:'Добавить расход',exact:true});
  await addExpense.scrollIntoViewIfNeeded();
  await addExpense.click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:'Сумма',exact:true}).fill('75');
  const afterOpen=calls.length;
  const scrollPosition=()=>workspace.evaluate(node=>node.closest('.crm-content')!.scrollTop);
  const scrollTop=await scrollPosition();
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect.poll(()=>writes).toBe(1);
  await page.clock.fastForward(61_000);
  expect(calls.slice(afterOpen).filter(call=>call.path==='/api/finance/report')).toEqual([]);
  await expect(table).toContainText('TEST-001');
  releaseWrite();
  await expect(dialog).toHaveCount(0);
  await expect.poll(()=>calls.slice(afterOpen).filter(call=>call.path==='/api/finance/report').length).toBe(1);
  await expect(table).toContainText('TEST-001');
  await expect(workspace).toHaveAttribute('aria-busy','false');
  expect(await before!.evaluate(node=>node.isConnected)).toBe(true);
  const exportButton=page.getByRole('button',{name:/Экспорт/});
  await expect(exportButton).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(table).toContainText('TEST-001');
  await page.screenshot({path:info.outputPath('expense-refresh-pending.png')});
  release();
  await expect(page.locator('.finance-report-kpi').filter({hasText:'Расходы (без налогов)'})).toContainText('699,35');
  await expect(page.getByText('Новый тестовый расход',{exact:true})).toBeVisible();
  await expect(exportButton).toBeEnabled();
  expect(await before!.evaluate(node=>node.isConnected)).toBe(true);
  expect(await scrollPosition()).toBe(scrollTop);
  expect(writes).toBe(1);
  const postSave=calls.slice(afterOpen);
  expect(postSave.filter(call=>call.path==='/api/finance/report').map(call=>call.query.get('projection'))).toEqual([null]);
  expect(postSave.filter(call=>call.path==='/api/finance/exchange-rates/ensure-current')).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.screenshot({path:info.outputPath('expense-refresh-complete.png')});
 }finally{releaseWrite();release();}
});

test('expense refresh failure leaves the edited row visible and retries only the read',async({page})=>{
 let writes=0,reads=0,release=()=>{};
 const refresh=new Promise<void>(resolve=>{release=resolve});
 await setup(page,'OWNER',{expenseUpdate:async()=>{
  if(!writes)return false;
  if(++reads!==1)return true;
  await refresh;
  return 'failed';
 }});
 await page.route('**/api/finance/expenses/expense-1',route=>{
  expect(route.request().method()).toBe('PATCH');
  writes++;
  return route.fulfill({json:{id:'expense-1'}});
 });
 try{
  await page.goto('/?section=finance&period=2026-10&tab=expenses');
  const workspace=page.locator('.finance-report-page');
  const table=page.locator('.finance-report-table');
  const actions=table.getByRole('button',{name:'Действия: Материалы',exact:true});
  await expect(table).toContainText('Ткань');
  await expect(workspace).toHaveAttribute('aria-busy','false');
  await actions.click();
  await page.getByRole('menuitem',{name:'Изменить',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:'Сумма',exact:true}).fill('75');
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(table).toContainText('Ткань');
  await expect(actions).toBeDisabled();
  release();
  const error=page.getByRole('alert').filter({hasText:'Изменения расходов сохранены.'});
  await expect(error).toBeVisible();
  await expect(table).toContainText('Ткань');
  await expect(actions).toBeDisabled();
  await error.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
  await expect(table).toContainText('Новый тестовый расход');
  await expect(error).toHaveCount(0);
  await expect(actions).toBeEnabled();
  expect(writes).toBe(1);
  expect(reads).toBe(2);
 }finally{release();}
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

for(const [width,height] of [[1920,1080],[1366,768],[390,844]])test(`Checkout preliminary figures are visible at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height});
 const calls=await setup(page,'OWNER',{checkoutEstimate:true});
 await page.goto('/?section=finance&period=2026-11');
 const metrics=page.locator('.finance-report-kpi');
 await expect(metrics.filter({hasText:'Налоги ФОП'})).toContainText(/234,56/);
 await expect(metrics.filter({hasText:'Финансовый результат'})).toContainText(/2\s*264,77/);
 const notice=page.locator('.crm-notifications').getByText(/Предварительный расчёт по данным Checkout/);
 await expect(page.locator('.finance-report-page').getByText(/Предварительный расчёт по данным Checkout/)).toHaveCount(0);
 await expect(notice).toBeVisible();
 await notice.scrollIntoViewIfNeeded();
 if(width===390){
  const bounds=await notice.boundingBox();
  const header=await page.locator('.finance-report-page h1').boundingBox();
  expect(bounds!.y).toBeGreaterThan(header!.y+header!.height);
  await expect(page.locator('.finance-information-notices')).toBeHidden();
  await expect(page.locator('.crm-notifications[data-position="bottom-center"]').getByText(/Предварительный расчёт по данным Checkout/)).toBeVisible();
 }
 await page.screenshot({path:info.outputPath('checkout-notice.png')});
 await expect(page.getByText(/Ожидают сверки оплаты/)).toHaveCount(0);
 const toastAction=page.locator('.crm-notifications').getByRole('button',{name:'Перейти к налоговой сверке'});
 await expect(toastAction).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 expect(calls.filter(call=>call.method!=='GET').map(call=>call.path).every(path=>path==='/api/finance/exchange-rates/ensure-current')).toBe(true);
 await page.screenshot({path:info.outputPath('checkout-preliminary.png'),fullPage:true});
 if(width===1920){
  await page.getByRole("button",{name:"Предыдущий месяц",exact:true}).click();
  await expect.poll(()=>calls.some(call=>call.query.get("month")==="2026-10")).toBe(true);
  await expect(notice).toHaveCount(0);
  return;
 }
 await toastAction.click();
 if(width===390) await expect(page.locator('.finance-information-notices')).toBeVisible();
 await expect(page.getByRole('tab',{name:'Налоги ФОП',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('combobox',{name:'Статус',exact:true}).click();
 await page.getByRole('option',{name:'Предварительно · Checkout',exact:true}).click();
 await expect.poll(()=>calls.some(call=>call.query.get('status')==='CHECKOUT_PRELIMINARY')).toBe(true);
 await expect(page.locator('.finance-tax-entries')).toContainText('Предварительно · Checkout');
 await expect(notice).toHaveCount(0);
 await page.reload();
 await expect(metrics.filter({hasText:'Налоги ФОП'})).toContainText(/234,56/);
 await expect(notice).toHaveCount(0);
 await page.getByRole('tab',{name:'Платежи и задолженности',exact:true}).click();
 await page.locator('.finance-report-main').getByRole('button',{name:'Перейти к налоговой сверке'}).click();
 await expect(page.getByRole('tab',{name:'Налоги ФОП',exact:true})).toHaveAttribute('aria-selected','true');
 await page.locator('.finance-tax-entries').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('checkout-tax-tab.png')});
});

test('finance shows report totals while exchange-rate refresh is still pending', async ({ page }) => {
 const calls=await setup(page);
 let unblock!:()=>void;
 const wait=new Promise<void>(resolve=>{unblock=resolve;});
 let started=false;
 await page.route('**/api/finance/exchange-rates/ensure-current',async route=>{
  started=true;
  await wait;
  await route.fulfill({status:503,json:{message:'Тестовая задержка источника курсов'}});
 });
 try {
  await page.goto('/?section=finance&period=2026-10');
  await expect.poll(()=>started).toBe(true);
  await expect(page.locator('.finance-report-kpi').filter({hasText:'Долги клиентов'})).toContainText(/1\s?240,00/);
  await expect(page.locator('.finance-report-table')).toContainText('TEST-001');
  expect(calls.some(call=>call.path==='/api/finance/report')).toBe(true);
 } finally { unblock(); }
 await expect(page.getByText('Тестовая задержка источника курсов',{exact:true})).toBeVisible();
});

test('Checkout preliminary figures wait for an available notification slot',async({page})=>{
 let release!:()=>void;
 const delayReport=new Promise<void>(resolve=>{release=resolve});
 const calls=await setup(page,'OWNER',{checkoutEstimate:true,delayReport});
 const items=Array.from({length:3},(_,i)=>({
   id:`synthetic-notice-${i}`,number:`QA-${i}`,paymentStatus:'PAID',client:{displayName:'Synthetic QA'},
 }));
 await page.route('**/api/orders/website-notifications',route=>route.fulfill({json:{items,unreadCount:items.length}}));
 await page.goto('/?section=finance&period=2026-11');
 const notifications=page.locator('.crm-notifications');
 try {
  await expect(notifications.getByRole('button',{name:/Synthetic QA/})).toHaveCount(3);
 } finally {release();}
 await expect(page.locator('.finance-report-kpi').filter({hasText:'Налоги ФОП'})).toContainText(/234,56/);
 const toast=notifications.getByText(/Предварительный расчёт по данным Checkout/);
 await expect(toast).toHaveCount(0);
 expect(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('crm:notice:finance-checkout-preliminary:')))).toBe(false);
 await page.getByRole('button',{name:'Предыдущий месяц',exact:true}).click();
 await expect.poll(()=>calls.some(call=>call.query.get('month')==='2026-10')).toBe(true);
 await expect(page.locator('.finance-report-main').getByRole('button',{name:'Перейти к налоговой сверке'})).toBeVisible();
 await notifications.getByRole('button',{name:'Закрыть уведомление',exact:true}).first().click();
 await expect(toast).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('crm:notice:finance-checkout-preliminary:')))).toBe(true);
});
