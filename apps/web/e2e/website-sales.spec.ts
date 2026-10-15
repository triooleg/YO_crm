import {test,expect,type Page} from '@playwright/test';
import {moveFinanceMonth} from '../lib/finance-report';
const {loadTargetModule}=require('./website-sales-model-loader.cjs');
const {buildOrderListPage}=loadTargetModule('orders/order-list-read-model.ts');
const {buildFinanceReport,financeReportCsv}=loadTargetModule('finance/finance-report-model.ts');
const {classifyOrderSource,countOrderSources,CONFIRMED_WEBSITE_SOURCE}=loadTargetModule('orders/order-source.ts');
const now=new Date('2026-10-15T12:00:00Z');
// Synthetic acceptance records only. They run through the real reporting models.
const orders=Array.from({length:55},(_,i)=>{
 const origin={sourceSystem:'KEYCRM',sourceAccount:CONFIRMED_WEBSITE_SOURCE.account,sourceLinkMode:'IMPORTED',externalId:String(i),externalData:{source_id:i<31?12:2},activities:[{type:'KEYCRM_ORDER_IMPORTED',metadata:{keycrmOrderId:String(i),sourceName:i<31?'Вебсайт':'Instagram'}}]};
 return {id:`order-${i}`,number:`QA-${String(i).padStart(3,'0')}`,createdAt:new Date(i===0?'2026-09-03':'2026-10-02'),requiredDeliveryAt:new Date('2026-10-30'),type:'CUSTOM_ORDER',discipline:'RHYTHMIC_GYMNASTICS',salesStatus:'NEW_LEAD',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',paymentStatus:'PARTIALLY_PAID',currency:'EUR',priceMinor:10000,depositRequiredMinor:5000,clientId:`client-${i}`,client:{id:`client-${i}`,displayName:`Synthetic ${i}`,source:'INSTAGRAM',athletes:[]},items:[{id:`item-${i}`,name:'Synthetic design',quantity:1,priceMinor:10000}],payments:[],activities:[],invoices:[],orderSource:classifyOrderSource(origin)};
});
const valuation={provider:'NBU',cache:{version:1,provider:'NBU',officialUrl:'https://bank.gov.ua',effectiveDate:'2026-10-15',fetchedAt:now.toISOString(),rates:[{baseCurrency:'EUR',quoteCurrency:'UAH',numerator:'50',denominator:'1',decimal:'50',sourceSeriesOrValcode:'EUR'},{baseCurrency:'USD',quoteCurrency:'UAH',numerator:'40',denominator:'1',decimal:'40',sourceSeriesOrValcode:'USD'}]}};
const ledger={orders,orderSources:Object.fromEntries(orders.map(row=>[row.id,row.orderSource])),payments:[{id:'first',orderId:'order-0',amountMinor:2500,currency:'EUR',receivedAt:now,method:'PAYPAL'},{id:'second',orderId:'order-0',amountMinor:1500,currency:'EUR',receivedAt:now,method:'PAYPAL'},{id:'void',orderId:'order-0',amountMinor:700,currency:'EUR',receivedAt:now,voidedAt:now},{id:'other',orderId:'order-54',amountMinor:6000,currency:'EUR',receivedAt:now}],expenses:[],invoices:[],categories:[]};
async function fixture(page:Page,role='OWNER',large=false){
 const calls:{path:string;method:string;query:URLSearchParams}[]=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname,q=url.searchParams;calls.push({path:p,method:req.method(),query:q});
  const output=(json:unknown)=>route.fulfill({json});
  if(req.method()!=='GET')return route.fulfill({status:405,json:{message:'Read-only test'}});
  if(p==='/api/auth/me')return output({user:{id:'qa',role,displayName:'QA'}});
  if(p==='/api/branding')return output({});
  if(p==='/api/communications/unread-count')return output({unreadCount:0});
  if(p==='/api/orders'){
   const period=q.get('period'),search=q.get('search')||'';
   const rows=orders.filter(row=>(!period||row.createdAt.toISOString().startsWith(period))&&`${row.number} ${row.client.displayName}`.includes(search));
   return output(buildOrderListPage(rows,Object.fromEntries(q),now));
  }
  if(p.startsWith('/api/orders/'))return output(orders.find(row=>p.endsWith('/'+row.id)));
  if(p==='/api/finance/report/options')return output({orders:[],clients:[]});
  if(p==='/api/finance/report'||p==='/api/finance/report/export'){
   const input=Object.fromEntries(q);const report=buildFinanceReport(large?{...ledger,payments:ledger.payments.map(row=>({...row,amountMinor:row.amountMinor*1000000}))}:ledger,input,valuation,now,p.endsWith('/export'));
   return p.endsWith('/export')?route.fulfill({contentType:'text/csv',body:financeReportCsv(report,input.tab||'payments')}):output(report);
  }
  if(p==='/api/overview/orders'){
   const month=q.get('month')!,from=new Date(month+'-01'),to=new Date(moveFinanceMonth(month,1)+'-01'),origin=ledger.orderSources;
   const breakdown=countOrderSources(orders,origin,from,to),total=breakdown.reduce((n:number,row:any)=>n+row.count,0);
   return output({month,currency:q.get('currency'),today:'2026-10-15',counts:{total,previousTotal:1,work:0,ready:0,overdue:0,requiresVerification:0,awaitingPayment:55},ring:{total,excluded:0,segments:[{key:'new',count:total},{key:'work',count:0},{key:'ready',count:0},{key:'awaiting',count:0},{key:'completed',count:0}]},trend:[],recent:[],valuationError:null,sourceAnalytics:{total,websiteCount:breakdown.find((x:any)=>x.source==='WEBSITE').count,breakdown,trend:Array.from({length:Number(q.get('range')||6)},(_,i)=>{const period=moveFinanceMonth(month,i-Number(q.get('range')||6)+1);return {month:period,breakdown:countOrderSources(orders,origin,new Date(period+'-01'),new Date(moveFinanceMonth(period,1)+'-01'))}})}});
  }
  if(p==='/api/overview/tasks')return output({rows:[],doneColumnId:null});
  if(p==='/api/overview/messages')return output({rows:[],unreadCount:0});
  if(p==='/api/overview/shipments')return output({rows:[],count7:0,requiresVerification:0,today:'2026-10-15'});
  return output([]);
 });return calls;
}
test('Orders source paging covers the full server cohort, deep links, reload and browser back',async({page})=>{
 const calls=await fixture(page);await page.goto('/?section=orders&source=WEBSITE&orderId=order-29&sort=created&direction=asc');
 await expect(page.locator('.orders-summary-row')).toHaveCount(11);await expect(page.locator('.orders-pagination')).toContainText('31');
 await expect(page.locator('#order-details-order-29')).toBeVisible();await expect(page.locator('#order-details-order-29')).toBeInViewport();await expect(page.locator('#order-details-order-29')).toContainText('Источник заказа');
 await expect(page.locator('.orders-order-number').first()).toContainText('С сайта');
 await page.locator('.orders-source-summary').getByRole('button').click();await expect(page).not.toHaveURL(/source=WEBSITE/);
 await expect.poll(()=>calls.filter(x=>x.path==='/api/orders').at(-1)?.query.get('source')).toBe(null);
 await page.goBack();await expect(page).toHaveURL(/source=WEBSITE/);await page.reload();await expect(page.locator('.orders-pagination')).toContainText('31');
 expect(calls.filter(x=>x.method!=='GET')).toEqual([]);
});
test('Overview adds online KPI/source ring and actual keyboard/legend links, keeps status and finance charts',async({page})=>{
 const calls=await fixture(page);await page.goto('/?section=overview&period=2026-10&currency=USD');
 await expect(page.locator('.overview-kpi')).toHaveCount(8);await expect(page.locator('.overview-source-kpi')).toContainText('30');
 await page.locator('.overview-status-card .order-source-legend button').first().click();await expect(page).toHaveURL(/section=orders/);await expect(page).toHaveURL(/source=WEBSITE/);await expect(page).toHaveURL(/period=2026-10/);
 await expect(page.locator('.orders-pagination')).toContainText('30');await page.goBack();await expect(page.locator('.overview-kpi')).toHaveCount(8);
 await page.getByText('Основные показатели',{exact:true}).click();await expect(page.getByRole('heading',{name:'Заказы по статусам',exact:true})).toBeVisible();
 const rect=page.locator('.overview-trend-card .order-source-trend rect[role=button]').last();await rect.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/section=orders/);await expect(page).toHaveURL(/source=INSTAGRAM/);
 expect(calls.filter(x=>x.method!=='GET')).toEqual([]);
});
test('Finance actual partial receipts, source filter, all currencies and matching CSV; old expense chart remains',async({page})=>{
 const calls=await fixture(page);await page.goto('/?section=finance&period=2026-10&currency=EUR');
 await expect(page.locator('.finance-report-kpi')).toHaveCount(7);await expect(page.locator('.finance-source-kpi')).toContainText('40,00');await expect(page.locator('.finance-source-kpi')).toContainText('40%');
 await page.getByRole('button',{name:'Поступления по заказам с сайта',exact:true}).click();await expect(page).toHaveURL(/source=WEBSITE/);
 await page.getByRole('combobox',{name:'Валюта отчёта',exact:true}).click();await page.getByRole('option',{name:'$ USD',exact:true}).click();await expect(page.locator('.finance-source-kpi')).toContainText('50,00');
 await page.getByRole('combobox',{name:'Валюта отчёта',exact:true}).click();await page.getByRole('option',{name:'₴ UAH',exact:true}).click();await expect(page.locator('.finance-source-kpi')).toContainText('000,00');
 await page.getByText('Основные показатели',{exact:true}).click();await expect(page.getByRole('heading',{name:'Структура расходов',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Экспорт/}).click();const download=page.waitForEvent('download');await page.getByRole('menuitem',{name:/CSV/}).click();await download;
 const exportCall=calls.findLast(x=>x.path==='/api/finance/report/export')!;expect(exportCall.query.get('source')).toBe('WEBSITE');expect(exportCall.query.get('currency')).toBe('UAH');
 await page.getByRole('button',{name:'Сбросить',exact:true}).click();await expect(page).not.toHaveURL(/source=/);await page.goBack();await expect(page).toHaveURL(/source=WEBSITE/);
 expect(calls.filter(x=>x.method!=='GET')).toEqual([]);
});
for(const width of [1536,1366,820,390])test(`Source additions stay responsive ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1024});await fixture(page);
 for(const section of ['overview','finance','orders']){await page.goto(`/?section=${section}&period=2026-10&currency=EUR`);await expect(page.locator(section==='overview'?'.overview-source-kpi':section==='finance'?'.finance-source-kpi':'.orders-source-summary')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`${section}-${width}.png`),fullPage:true});}
});
test('Manager overview receives no finance source data or finance chart requests',async({page})=>{
 const calls=await fixture(page,'MANAGER');await page.goto('/?section=overview&period=2026-10');await expect(page.locator('.overview-kpi')).toHaveCount(5);expect(calls.some(x=>x.path==='/api/finance/report')).toBe(false);await expect(page.locator('.overview-finance-card')).toHaveCount(0);
});

test('Settled manual Orders pages and source change restore the canonical initial entry with Back/Forward',async({page})=>{
 const calls=await fixture(page);await page.goto('/?section=orders');await expect(page.locator('.orders-summary-row')).toHaveCount(20);
 const nav=page.locator('.orders-pagination nav');await nav.getByRole('button',{name:'2',exact:true}).click();await expect.poll(()=>calls.filter(x=>x.path==='/api/orders').at(-1)?.query.get('page')).toBe('2');await expect(page.locator('.orders-pagination')).toContainText('21–40');
 await page.goBack();await expect(page.locator('.orders-pagination')).toContainText('1–20');await page.goForward();await expect(page.locator('.orders-pagination')).toContainText('21–40');
 await nav.getByRole('button',{name:'3',exact:true}).click();await expect(page.locator('.orders-summary-row')).toHaveCount(15);await page.locator('.orders-source-summary').getByRole('button').click();await expect(page).toHaveURL(/source=WEBSITE/);await expect(page.locator('.orders-pagination')).toContainText('1–20');
 await page.goBack();await expect(page).not.toHaveURL(/source=WEBSITE/);await expect(page.locator('.orders-pagination')).toContainText('41–55');
 await page.locator('.orders-page-size select').selectOption('100');await expect(page.locator('.orders-summary-row')).toHaveCount(55);await expect(page.locator('.orders-pagination')).toContainText('1–55');
});

test('Source trend keeps physical 12px labels and exact accessible amounts at 12 months in UAH',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await fixture(page,'OWNER',true);await page.goto('/?section=finance&period=2026-10&currency=UAH&range=12');
 const chart=page.locator('.order-source-trend svg');await chart.scrollIntoViewIfNeeded();await expect(chart.locator('rect[role=button]').first()).toBeVisible();
 await expect.poll(()=>chart.evaluate((svg:SVGSVGElement)=>Math.abs(svg.viewBox.baseVal.width-svg.getBoundingClientRect().width))).toBeLessThan(2);
 const text=await chart.locator('text').evaluateAll(nodes=>nodes.map(node=>({size:parseFloat(getComputedStyle(node).fontSize),box:(node as SVGTextElement).getBBox()})));expect(text.every(row=>row.size>=12)).toBe(true);
 const boxes=await chart.locator('.order-source-bar-value').evaluateAll(nodes=>nodes.map(node=>{const b=(node as SVGTextElement).getBBox();return {x:b.x,width:b.width}}));for(let i=1;i<boxes.length;i++)expect(boxes[i-1]!.x+boxes[i-1]!.width).toBeLessThanOrEqual(boxes[i]!.x+1);
 const center=page.locator('.order-source-center strong');await center.scrollIntoViewIfNeeded();const fit=await center.evaluate(node=>({text:node.getBoundingClientRect().width,hole:Math.min(node.closest('.order-source-donut')!.getBoundingClientRect().width,225)*.56}));expect(fit.text).toBeLessThanOrEqual(fit.hole);
 await expect(chart.locator('rect[role=button]').first()).toHaveAttribute('aria-label',/₴/);await page.screenshot({path:info.outputPath('uah-12-months-visible.png')});
});

test('Seven finance KPI cards retain the full million-UAH debt at laptop widths',async({page})=>{
 await fixture(page);
 await page.route('**/api/finance/report?*',async route=>{
  const report=buildFinanceReport(ledger,Object.fromEntries(new URL(route.request().url()).searchParams),valuation,now);
  report.debtMinor=110906006;
  await route.fulfill({json:report});
 });
 for(const width of [1536,1366,1920,390]){
  await page.setViewportSize({width,height:1080});
  await page.goto('/?section=finance&period=2026-10&currency=UAH');
  await expect(page.locator('.finance-report-kpi')).toHaveCount(7);
  const amount=page.locator('.finance-report-kpi').filter({has:page.getByRole('heading',{name:'Долги клиентов',exact:true})}).locator('strong');
  await expect(amount).toHaveText(/^1\s109\s060,06\s₴$/);
  const fit=await amount.evaluate(node=>{const r=document.createRange();r.selectNodeContents(node);const text=r.getBoundingClientRect(),card=node.closest('.finance-report-kpi')!.getBoundingClientRect();return text.left>=card.left&&text.right<=card.right-8;});
  expect(fit,`full debt and currency fit the card at ${width}px`).toBe(true);
 }
});
