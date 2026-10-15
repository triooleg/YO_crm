import {test,expect,type Page} from '@playwright/test';
import {moveFinanceMonth} from '../lib/finance-report';
const {loadTargetModule}=require('./website-sales-model-loader.cjs');
const {buildOrderListPage}=loadTargetModule('orders/order-list-read-model.ts');
const {buildFinanceReport,financeReportCsv}=loadTargetModule('finance/finance-report-model.ts');
const {classifyOrderSource,countOrderSources,CONFIRMED_WEBSITE_SOURCE}=loadTargetModule('orders/order-source.ts');
const now=new Date('2026-10-15T12:00:00Z');

test('Every named source is available across Overview, Finance and Orders',async({page})=>{
 await fixture(page);
 const names=['С сайта','Ручной / CRM','Instagram','Facebook','Чат','WhatsApp','Viber','E-mail','Другое','Не определён'];
 for(const section of ['overview','finance']){
  await page.goto(`/?section=${section}&period=2026-10`);
  const card=page.locator(section==='overview'?'.overview-status-card':'.finance-report-charts');
  await expect(card.locator('.order-source-legend button')).toHaveCount(10);
  for(const name of names)await expect(card.locator('.order-source-legend')).toContainText(name);
  const filter=page.getByRole('combobox',{name:'Источник в динамике',exact:true});await filter.click();
  for(const name of names)await expect(page.getByRole('option',{name,exact:true})).toBeVisible();
  await page.getByRole('option',{name:'Facebook',exact:true}).click();
  await expect(page).toHaveURL(section==='overview'?/sourceTrend=FACEBOOK/:/source=FACEBOOK/);
  await expect(page.locator('.order-source-trend-legend')).toContainText('Facebook');
  if(section==='overview')await expect(page.locator('.overview-trend-card .order-source-empty')).toBeVisible();
 }
 await page.goto('/?section=orders&source=VIBER');
 await expect(page.locator('.orders-filter-chips')).toContainText('Viber');
 await expect(page.locator('.orders-summary-row')).toHaveCount(0);
});

test('Overview plot regions align in every chart mode without stretching SVG text',async({page},info)=>{
 test.setTimeout(120000);await fixture(page);
 for(const [index,width] of [1920,1366,820,390].entries()){
  await page.setViewportSize({width,height:1080});await page.goto(`/?section=overview&period=2026-10&currency=${['EUR','USD','UAH','EUR'][index]}`);
  await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');
  for(const mode of ['Основные показатели','По источникам']){
   await page.locator('.overview-status-card').getByText(mode,{exact:true}).click();
   for(const [metricIndex,metric] of ['Заказы','Доходы','Клиенты'].entries()){
    await page.locator('.overview-trend-card').getByText(metric,{exact:true}).click();
    const range=page.locator('.overview-trend-card header').getByRole('combobox');await range.click();await page.getByRole('option',{name:`${[3,6,12][metricIndex]} месяцев`,exact:true}).click();
    const plots=page.locator('.overview-chart-body');await expect(plots).toHaveCount(3);
    await expect.poll(async()=>plots.evaluateAll(nodes=>{
     const rows=new Map<number,DOMRect[]>();for(const n of nodes){const r=n.getBoundingClientRect(),top=Math.round(n.closest('article')!.getBoundingClientRect().top);rows.set(top,[...(rows.get(top)||[]),r]);}
     return [...rows.values()].every(row=>Math.max(...row.map(r=>r.top))-Math.min(...row.map(r=>r.top))<2&&Math.max(...row.map(r=>r.bottom))-Math.min(...row.map(r=>r.bottom))<2);
    })).toBe(true);
    const scales=await page.locator('.overview-chart-body .overview-chart-plot svg,.overview-chart-body .order-source-plot svg').evaluateAll(nodes=>nodes.map(n=>{const svg=n as SVGSVGElement,r=svg.getBoundingClientRect();return Math.abs(svg.viewBox.baseVal.width-r.width)<2&&Math.abs(svg.viewBox.baseVal.height-r.height)<2;}));
    expect(scales.every(Boolean),'SVG uses physical plot coordinates').toBe(true);
    const monthLabels=await page.locator('.overview-chart-plot svg').evaluateAll(nodes=>nodes.every(node=>{
     const svg=node as SVGSVGElement,labels=[...svg.querySelectorAll('text.overview-axis')].filter(text=>Number(text.getAttribute('y'))>svg.viewBox.baseVal.height-10).map(text=>text.getBoundingClientRect());
     return labels.every((r,index)=>index===0||r.left>=labels[index-1]!.right+2);
    }));expect(monthLabels,'month labels remain separate on narrow twelve-month plots').toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   }
   await page.locator('.overview-charts').screenshot({path:info.outputPath(`overview-aligned-${width}-${mode==='По источникам'?'sources':'standard'}.png`)});
   if(width===390)for(const [cardIndex,card] of (await page.locator('.overview-charts>.overview-card').all()).entries()){
    await card.scrollIntoViewIfNeeded();await card.screenshot({path:info.outputPath(`overview-mobile-card-${mode==='По источникам'?'sources':'standard'}-${cardIndex}.png`)});
   }
  }
 }
});
// Synthetic acceptance records only. They run through the real reporting models.
const orders=Array.from({length:55},(_,i)=>{
 const origin={sourceSystem:'KEYCRM',sourceAccount:CONFIRMED_WEBSITE_SOURCE.account,sourceLinkMode:'IMPORTED',externalId:String(i),externalData:{source_id:i<31?12:2},activities:[{type:'KEYCRM_ORDER_IMPORTED',metadata:{keycrmOrderId:String(i),sourceName:i<31?'Вебсайт':'Instagram'}}]};
 return {id:`order-${i}`,number:`QA-${String(i).padStart(3,'0')}`,createdAt:new Date(i===0?'2026-09-03':'2026-10-02'),requiredDeliveryAt:new Date('2026-10-30'),type:'CUSTOM_ORDER',discipline:'RHYTHMIC_GYMNASTICS',salesStatus:'NEW_LEAD',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',paymentStatus:'PARTIALLY_PAID',currency:'EUR',priceMinor:10000,depositRequiredMinor:5000,clientId:`client-${i}`,client:{id:`client-${i}`,displayName:`Synthetic ${i}`,source:'INSTAGRAM',athletes:[]},items:[{id:`item-${i}`,name:'Synthetic design',quantity:1,priceMinor:10000}],payments:[],activities:[],invoices:[],orderSource:classifyOrderSource(origin)};
});

test('Manager note opens its current text, saves only that note and preserves drafts on conflict',async({page},info)=>{
 await fixture(page);
 let comment='Текущая заметка менеджера\nВторая строка';let conflict=false;
 const writes:{path:string;body:unknown}[]=[];
 await page.route('**/api/orders**',async route=>{
  const req=route.request(),u=new URL(req.url());
  const target={...orders[0]!,managerComment:comment,buyerComment:'Пожелания клиента',notesStructured:[]};
  if(req.method()==='PATCH'&&u.pathname==='/api/orders/order-0/manager-comment'){
   const body=req.postDataJSON();writes.push({path:u.pathname,body});
   if(conflict)return route.fulfill({status:409,json:{message:'Заметка уже изменена другим сотрудником'}});
   comment=body.managerComment;return route.fulfill({json:{id:target.id,managerComment:comment}});
  }
  if(u.pathname==='/api/orders/order-0')return route.fulfill({json:target});
  if(u.pathname==='/api/orders')return route.fulfill({json:buildOrderListPage(orders.map(row=>row.id===target.id?target:row),Object.fromEntries(u.searchParams),now)});
  return route.fallback();
 });
 await page.goto('/?section=orders&orderId=order-0');
 const details=page.locator('#order-details-order-0');
 await details.getByRole('tab',{name:'Заметки',exact:true}).click();
 const note=details.locator('article').filter({has:page.getByRole('heading',{name:'Заметки менеджера',exact:true})});
 await note.getByRole('button',{name:'Изменить заметку',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Редактирование заметки менеджера',exact:true});
 const input=dialog.getByRole('textbox',{name:'Заметки менеджера',exact:true});
 await expect(input).toHaveValue(comment);
 await dialog.screenshot({path:info.outputPath('manager-note-editor.png')});
 await input.fill('Несохранённый черновик');await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
 expect(writes).toEqual([]);
 await note.getByRole('button',{name:'Изменить заметку',exact:true}).click();
 await expect(input).toHaveValue(comment);
 await input.fill('Исправленная заметка');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await details.getByRole('tab',{name:'Заметки',exact:true}).click();
 await expect(note).toContainText('Исправленная заметка');
 expect(writes).toEqual([{path:'/api/orders/order-0/manager-comment',body:{managerComment:'Исправленная заметка',expectedManagerComment:'Текущая заметка менеджера\nВторая строка'}}]);
 await expect(details).toContainText('Пожелания клиента');
 conflict=true;await note.getByRole('button',{name:'Изменить заметку',exact:true}).click();
 await input.fill('Не потерять этот текст');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(dialog).toContainText('Заметка уже изменена другим сотрудником');await expect(input).toHaveValue('Не потерять этот текст');
 await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
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
   return output({month,currency:q.get('currency'),today:'2026-10-15',counts:{total,previousTotal:1,work:0,ready:0,overdue:0,requiresVerification:0,awaitingPayment:55},ring:{total,excluded:0,segments:[{key:'new',count:total},{key:'work',count:0},{key:'ready',count:0},{key:'awaiting',count:0},{key:'completed',count:0}]},trend:Array.from({length:Number(q.get('range')||6)},(_,i)=>{const month=moveFinanceMonth(q.get('month')!,i-Number(q.get('range')||6)+1),inMonth=orders.filter(row=>row.createdAt.toISOString().startsWith(month));return {month,orders:inMonth.length,clients:new Set(inMonth.map(row=>row.clientId)).size}}),recent:[],valuationError:null,sourceAnalytics:{total,websiteCount:breakdown.find((x:any)=>x.source==='WEBSITE').count,breakdown,trend:Array.from({length:Number(q.get('range')||6)},(_,i)=>{const period=moveFinanceMonth(month,i-Number(q.get('range')||6)+1);return {month:period,breakdown:countOrderSources(orders,origin,new Date(period+'-01'),new Date(moveFinanceMonth(period,1)+'-01'))}})}});
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
 await expect(page.locator('.orders-summary-row .orders-channel.website')).toHaveCount(11);
 await expect(page.locator('.orders-order-number').first()).not.toContainText('С сайта');
 await page.locator('.orders-kpi-grid .orders-kpi').filter({hasText:'Онлайн-заказы'}).click();await expect(page).not.toHaveURL(/source=WEBSITE/);
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
 for(const section of ['overview','finance','orders']){await page.goto(`/?section=${section}&period=2026-10&currency=EUR`);await expect(page.locator(section==='overview'?'.overview-source-kpi':section==='finance'?'.finance-source-kpi':'.orders-kpi-grid .orders-kpi:nth-child(2)')).toBeVisible();if(section==='orders'){await expect(page.locator('.orders-kpi-grid .orders-kpi')).toHaveCount(7);await expect(page.locator('.orders-summary-row')).toHaveCount(20);await expect(page.locator('.orders-kpi-grid')).not.toContainText('—');}expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`${section}-${width}.png`),fullPage:true});}
});
test('Manager overview receives no finance source data or finance chart requests',async({page})=>{
 const calls=await fixture(page,'MANAGER');await page.goto('/?section=overview&period=2026-10');await expect(page.locator('.overview-kpi')).toHaveCount(5);expect(calls.some(x=>x.path==='/api/finance/report')).toBe(false);await expect(page.locator('.overview-finance-card')).toHaveCount(0);
});

test('Settled manual Orders pages and source change restore the canonical initial entry with Back/Forward',async({page})=>{
 const calls=await fixture(page);await page.goto('/?section=orders');await expect(page.locator('.orders-summary-row')).toHaveCount(20);
 const nav=page.locator('.orders-pagination nav');await nav.getByRole('button',{name:'2',exact:true}).click();await expect.poll(()=>calls.filter(x=>x.path==='/api/orders').at(-1)?.query.get('page')).toBe('2');await expect(page.locator('.orders-pagination')).toContainText('21–40');
 await page.goBack();await expect(page.locator('.orders-pagination')).toContainText('1–20');await page.goForward();await expect(page.locator('.orders-pagination')).toContainText('21–40');
 await nav.getByRole('button',{name:'3',exact:true}).click();await expect(page.locator('.orders-summary-row')).toHaveCount(15);await page.locator('.orders-kpi-grid .orders-kpi').filter({hasText:'Онлайн-заказы'}).click();await expect(page).toHaveURL(/source=WEBSITE/);await expect(page.locator('.orders-pagination')).toContainText('1–20');
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

test('Order timeline and Details reconcile tracking without changing persisted statuses or inventing dates',async({page},info)=>{
 const calls=await fixture(page);
 const tracked={...orders[0]!,deliveryTrackingCode:'TRACK-617',salesStatus:'SHIPPED',productionStatus:'SCHEDULED',shippingStatus:'NOT_READY',shipment:null,orderShipments:[]};
 await page.route('**/api/orders**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/orders')return route.fulfill({json:buildOrderListPage(orders.map(row=>row.id===tracked.id?tracked:row),Object.fromEntries(u.searchParams),now)});
  if(u.pathname==='/api/orders/'+tracked.id)return route.fulfill({json:tracked});
  return route.fallback();
 });
 for(const width of [1536,390]){
  await page.setViewportSize({width,height:1024});await page.goto('/?section=orders&orderId=order-0');
  const details=page.locator('#order-details-order-0');await expect(details).toBeVisible();
  const flow=details.locator('.orders-order-flow');
  await expect(flow.locator('[data-domain=production]')).toHaveText('Выполнено');
  await expect(flow.locator('[data-domain=shipping]')).toHaveText('Отправлено');
  await expect(flow).toContainText('Отправка подтверждена трек-номером: TRACK-617');
  await expect(flow).not.toContainText('Не готов к отправке');
  await expect(flow).not.toContainText('Фактическая отправка: Не указана');
  await expect(details.locator('.orders-stage-list')).toContainText('Выполнено');
  await expect(details.locator('.orders-stage-list')).toContainText('Отправлено');
  await flow.scrollIntoViewIfNeeded();await flow.screenshot({path:info.outputPath(`tracking-timeline-${width}.png`)});
 }
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
 expect(tracked.productionStatus).toBe('SCHEDULED');expect(tracked.shippingStatus).toBe('NOT_READY');
});

test('Long tracking captions stay within their stage without moving connectors',async({page},info)=>{
 const calls=await fixture(page);const tracking='PC000020000072122NPG';
 const tracked={...orders[0]!,salesStatus:'SHIPPED',shipment:{trackingNumber:tracking},managerComment:null};
 await page.route('**/api/orders/order-0',route=>route.fulfill({json:tracked}));
 for(const width of [1536,390]){
  await page.setViewportSize({width,height:1080});await page.goto('/?section=orders&orderId=order-0');
  const flow=page.locator('#order-details-order-0 .orders-order-flow');
  const caption=flow.locator('article').last().locator('.orders-flow-caption small');
  await expect(caption).toContainText(tracking);
  const bounds=await caption.evaluate(node=>{
   const range=document.createRange();range.selectNodeContents(node);
   const stage=node.closest('article')!.getBoundingClientRect(),card=node.closest('.orders-order-overview')!.getBoundingClientRect();
   return {fits:[...range.getClientRects()].every(r=>r.left>=stage.left-1&&r.right<=stage.right+1&&r.bottom<=card.bottom+1),font:getComputedStyle(node).fontSize};
  });
  expect(bounds.fits,'complete tracking text remains inside its stage and card').toBe(true);expect(bounds.font).toBe('11px');
  const centers=await flow.locator('article>i').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return r.top+r.height/2;}));
  expect(Math.max(...centers)-Math.min(...centers)).toBeLessThan(1);
  await flow.screenshot({path:info.outputPath(`long-tracking-${width}.png`)});
 }
 expect(calls.filter(c=>c.method!=='GET')).toEqual([]);
});

test('Production selected timeline keeps full badge labels and dispatched facts',async({page},info)=>{
 const calls=await fixture(page);
 const tracked={...orders[0]!,hasTrackingNumber:true,paidMinor:60000,priceMinor:120000,depositRequiredMinor:60000,salesStatus:'SHIPPED',productionStatus:'SCHEDULED',shippingStatus:'NOT_READY',productionSlot:{id:'slot',startsAt:'2026-10-02',endsAt:'2026-10-12',tentative:false,locked:false,capacity:1}};
 await page.route('**/api/orders/production?*',route=>route.fulfill({json:[tracked]}));
 await page.route('**/api/orders/defaults',route=>route.fulfill({json:{defaultDurationDays:7,shippingLeadDays:3}}));
 for(const width of [1536,390]){
  await page.setViewportSize({width,height:1080});await page.goto('/?section=production&orderId=order-0');
  const details=page.locator('.production-order-details');await expect(details).toBeVisible();
  const flow=details.locator('.production-lifecycle');
  await expect(flow.locator('> div').first().locator('em')).toHaveText(/1\s*200,00\s*€\s*\/\s*600,00\s*€/);
  await expect(flow.locator('.mantine-Badge-label')).toHaveCount(3);
  const labels=await flow.locator('.mantine-Badge-label').evaluateAll(nodes=>nodes.map(node=>{const r=document.createRange();r.selectNodeContents(node);const text=r.getBoundingClientRect(),badge=node.closest('.mantine-Badge-root')!.getBoundingClientRect();return text.left>=badge.left&&text.right<=badge.right&&text.top>=badge.top&&text.bottom<=badge.bottom;}));
  expect(labels.every(Boolean),'all status text fits inside its badge').toBe(true);
  await expect(flow).toContainText('Выполнено');await expect(flow).toContainText('Отправлено');
  await expect(details.locator('.production-details-dates')).toContainText('Подтверждена трек-номером');
  await flow.scrollIntoViewIfNeeded();await flow.screenshot({path:info.outputPath(`production-selected-timeline-${width}.png`)});
 }
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('Production headers meet the first order and partial payment icon matches its badge',async({page},info)=>{
 const calls=await fixture(page);
 const partial={...orders[0]!,hasTrackingNumber:false,paidMinor:10000,priceMinor:40000,depositRequiredMinor:20000,paymentStatus:'PARTIALLY_PAID',productionStatus:'SCHEDULED',productionSlot:{id:'slot',startsAt:'2026-10-02',endsAt:'2026-10-12',tentative:true,locked:false,capacity:1}};
 await page.route('**/api/orders/production?*',route=>route.fulfill({json:[partial]}));
 await page.route('**/api/orders/defaults',route=>route.fulfill({json:{defaultDurationDays:7,shippingLeadDays:3}}));
 for(const width of [1536,390]){
  await page.setViewportSize({width,height:1080});await page.goto('/?section=production&orderId=order-0');
  const flow=page.locator('.production-lifecycle');await expect(flow.locator('.is-partial')).toBeVisible();
  await expect(flow.locator('.is-partial em')).toHaveText(/400,00\s*€\s*\/\s*100,00\s*€/);
  const colors=await flow.locator('.is-partial').evaluate(node=>({icon:getComputedStyle(node.querySelector(':scope > span')!).backgroundColor,badge:getComputedStyle(node.querySelector('.mantine-Badge-root')!).backgroundColor}));
  expect(colors.icon).toBe(colors.badge);
  const geometry=await page.locator('.production-board-canvas').evaluate(node=>({header:node.querySelector('.production-order-columns-head')!.getBoundingClientRect().bottom,row:node.querySelector('.production-order-row')!.getBoundingClientRect().top}));
  expect(Math.abs(geometry.header-geometry.row)).toBeLessThan(2);
  await page.locator('.production-board').screenshot({path:info.outputPath(`production-header-orders-${width}.png`)});
  await flow.scrollIntoViewIfNeeded();await flow.screenshot({path:info.outputPath(`partial-payment-${width}.png`)});
 }
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('Completed orders show fulfilled and cannot reappear through Production context',async({page})=>{
 const calls=await fixture(page);let completed={...orders[0]!,salesStatus:'COMPLETED',productionSlot:null as null|{id:string;startsAt:string;endsAt:string;tentative:boolean;locked:boolean;capacity:number}};
 await page.route('**/api/orders**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/orders')return route.fulfill({json:buildOrderListPage([completed],Object.fromEntries(u.searchParams),now)});
  if(u.pathname==='/api/orders/'+completed.id)return route.fulfill({json:completed});
  if(u.pathname==='/api/orders/production')return route.fulfill({json:[completed]});
  if(u.pathname==='/api/orders/defaults')return route.fulfill({json:{defaultDurationDays:7,shippingLeadDays:3}});
  return route.fallback();
 });
 for(const slot of [null,{id:'history',startsAt:'2026-10-02',endsAt:'2026-10-12',tentative:false,locked:false,capacity:1}]){
 completed={...completed,productionSlot:slot};
 await page.goto('/?section=orders&orderId=order-0');
 await expect(page.locator('.orders-summary-row .orders-col-production')).toContainText('Выполнено');
 await expect(page.locator('.orders-assign-production')).toHaveCount(0);
 const details=page.locator('#order-details-order-0');
 await details.getByRole('tab',{name:'Производство',exact:true}).click();
 await expect(details.locator('.orders-production-plan button,.orders-production-schedule button')).toHaveCount(0);
 if(slot)await expect(details.locator('.orders-production-calendar')).toContainText('2026');
 }
 await page.goto('/?section=production&orderId=order-0');
 await expect(page.locator('.production-empty-state')).toBeVisible();
 await expect(page.locator('.production-order-row')).toHaveCount(0);
 await expect(page.locator('.production-order-details')).toHaveCount(0);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('Orders ready KPI and website KPI use their actual filtered cohorts',async({page})=>{
 const calls=await fixture(page);const target={...orders[0]!,salesStatus:'READY_TO_SHIP',shippingStatus:'NOT_READY',productionStatus:'SCHEDULED'};
 await page.route('**/api/orders?*',route=>{const u=new URL(route.request().url());return route.fulfill({json:buildOrderListPage([target],Object.fromEntries(u.searchParams),now)});});
 await page.goto('/?section=orders');
 const cards=page.locator('.orders-kpi-grid .orders-kpi');await expect(cards).toHaveCount(7);
 const ready=cards.filter({hasText:'Готовы к отправке'});await expect(ready.locator('strong')).toHaveText('1');await ready.click();
 await expect(page.locator('.orders-summary-row')).toHaveCount(1);
 await expect(page).toHaveURL(/quick=ready/);
 await page.locator('.orders-sort select').selectOption('source');await expect(page).toHaveURL(/sort=source/);
 const website=cards.filter({hasText:'Онлайн-заказы'});await expect(website).toBeVisible();await website.click();await expect(page).toHaveURL(/source=WEBSITE/);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('Partial child transport exceptions remain visible in timeline and Details',async({page})=>{
 const calls=await fixture(page);let exception='LOST';
 await page.route('**/api/orders**',async route=>{
  const target={...orders[0]!,productionStatus:'SCHEDULED',items:[{...orders[0]!.items[0]!,quantity:2,instances:[{id:'a',productionStatus:'READY'},{id:'b',productionStatus:'SEWING'}]}],orderShipments:[{id:'p',status:exception,trackingNumber:'PARTIAL',instances:[{id:'a'}]},{id:'q',status:'DRAFT',instances:[{id:'b'}]}]};
  const u=new URL(route.request().url());
  if(u.pathname==='/api/orders')return route.fulfill({json:buildOrderListPage(orders.map(row=>row.id===target.id?target:row),Object.fromEntries(u.searchParams),now)});
  if(u.pathname==='/api/orders/'+target.id)return route.fulfill({json:target});
  return route.fallback();
 });
 for(const [status,label] of [['LOST','Утерян'],['RETURNED','Возвращён']]){
  exception=status!;await page.goto('/?section=orders&orderId=order-0');
  const details=page.locator('#order-details-order-0'),flow=details.locator('.orders-order-flow');
  await expect(flow.locator('[data-domain=shipping]')).toHaveText(`Частично отправлено · ${label}`);
  const colors=await flow.locator('[data-domain=shipping]').evaluate((node,status)=>{
   const probe=document.createElement('span');probe.style.backgroundColor=`var(--mantine-color-${status==='LOST'?'red':'orange'}-6)`;document.body.append(probe);
   const expected=getComputedStyle(probe).backgroundColor;probe.remove();
   return {expected,actual:getComputedStyle(node).backgroundColor,icon:getComputedStyle(node.closest('article')!.querySelector('i')!).backgroundColor};
  },status);
  expect(colors.actual).toBe(colors.expected);expect(colors.icon).toBe(colors.expected);
  await expect(flow.locator('[data-domain=production]')).toHaveText('Запланирован');
  await expect(details.locator('.orders-stage-list')).toContainText(`Частично отправлено · ${label}`);
 }
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('Website order uses the existing client icon position and sale caption without a source column',async({page})=>{
 const calls=await fixture(page);
 await page.goto('/?section=orders&source=WEBSITE&pageSize=100');
 await expect(page.locator('.orders-summary-row')).toHaveCount(31);
 await expect(page.locator('.orders-summary-row .orders-channel.website[aria-label="С сайта"]')).toHaveCount(31);
 await expect(page.locator('.orders-summary-row .orders-assign-production')).toHaveCount(0);
 await expect(page.locator('.orders-summary-row .orders-website-sale')).toHaveCount(31);
 await expect(page.locator('.orders-dashboard-table thead')).not.toContainText('Источник');
 await expect(page.locator('.orders-order-number').first()).not.toContainText('С сайта');
 await page.goto('/?section=orders&source=INSTAGRAM&pageSize=100');
 await expect(page.locator('.orders-summary-row')).toHaveCount(24);
 await expect(page.locator('.orders-summary-row .orders-channel.instagram')).toHaveCount(24);
 await expect(page.locator('.orders-summary-row .orders-channel.website')).toHaveCount(0);
 await expect(page.locator('.orders-summary-row .orders-assign-production')).toHaveCount(24);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('A dated tentative slot is Scheduled in Orders and Production without confirming it',async({page},info)=>{
 const calls=await fixture(page);
 const target={...orders[0]!,productionStatus:'NOT_SCHEDULED',paidMinor:0,hasTrackingNumber:false,productionSlot:{id:'slot',startsAt:'2026-10-02',endsAt:'2026-10-12',tentative:true,locked:false,capacity:1}};
 await page.route('**/api/orders**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/orders')return route.fulfill({json:buildOrderListPage(orders.map(row=>row.id===target.id?target:row),Object.fromEntries(u.searchParams),now)});
  if(u.pathname==='/api/orders/'+target.id)return route.fulfill({json:target});
  if(u.pathname==='/api/orders/production')return route.fulfill({json:[target]});
  if(u.pathname==='/api/orders/defaults')return route.fulfill({json:{defaultDurationDays:7,shippingLeadDays:3}});
  return route.fallback();
 });
 await page.goto('/?section=orders&orderId=order-0');
 await expect(page.locator('#order-details-order-0 .orders-order-flow [data-domain=production]')).toHaveText('Запланирован');
 await expect(page.locator('#order-details-order-0 .orders-stage-list')).toContainText('Запланирован');
 const row=page.locator('.orders-summary-row').filter({has:page.getByRole('button',{name:'QA-000',exact:true})});
 await expect(row.locator('.orders-col-production [data-status=SCHEDULED]')).toBeVisible();
 await expect(row.locator('.orders-website-sale')).toHaveCount(0);
 await page.goto('/?section=production&orderId=order-0');
 await expect(page.locator('.timeline-production-segment[data-status=SCHEDULED]')).toContainText('Запланировано');
 await expect(page.locator('.production-flow-bar.tentative')).toHaveCount(1);
 await expect(page.locator('.production-order-details .production-lifecycle .is-scheduled')).toContainText('Запланировано');
 await page.locator('.production-order-details').screenshot({path:info.outputPath('dated-tentative-slot.png')});
 expect(target.productionStatus).toBe('NOT_SCHEDULED');expect(target.productionSlot.tentative).toBe(true);expect(target.paidMinor).toBe(0);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});
