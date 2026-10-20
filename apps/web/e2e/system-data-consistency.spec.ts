import {test,expect} from '@playwright/test';
test('Shipping displays the stored legacy tracking code without changing shipment status',async({page})=>{
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'owner',role:'OWNER',displayName:'QA'}}});
 if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
 if(path==='/api/branding')return route.fulfill({json:{}});
 if(path==='/api/shipping')return route.fulfill({json:{orders:[{id:'legacy',number:'LEGACY-ORDER',deliveryTrackingCode:'LEGACY-TRACK',shippingStatus:'NOT_READY',currency:'EUR',client:{displayName:'Example'},items:[],shipment:null}],carriers:[]}});
 return route.fulfill({json:[]});});
 await page.goto('/?section=shipping');await expect(page.getByText('LEGACY-TRACK',{exact:true})).toBeVisible();
});


test('unread error is visibly unknown and a later successful response restores the real count',async({page})=>{
 let recovered=false;await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'owner',role:'OWNER',displayName:'QA'}}});
 if(path==='/api/communications/unread-count')return route.fulfill(recovered?{json:{unreadCount:4}}:{status:503,json:{message:'Unread unavailable'}});
 if(path==='/api/branding')return route.fulfill({json:{}});return route.fulfill({json:[]});});
 await page.goto('/?section=clients');const bell=page.locator('.crm-topbar-notifications');
 await expect(bell).toHaveAttribute('title',/недоступно/);await expect(bell.locator('.crm-topbar-notification-badge')).toHaveText('?');
 recovered=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(bell.locator('.crm-topbar-notification-badge')).toHaveText('4');
});

test('failed order and shipping reads never present confirmed zero KPIs',async({page})=>{
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'owner',role:'OWNER',displayName:'QA'}}});
 if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
 if(path==='/api/branding')return route.fulfill({json:{}});
 if(path==='/api/orders'||path==='/api/shipping')return route.fulfill({status:503,json:{message:'Source unavailable'}});
 return route.fulfill({json:[]});});
 await page.goto('/?section=orders');await expect(page.locator('.orders-error')).toContainText('Source unavailable');
 await expect(page.locator('.orders-kpi strong')).toHaveText(['—','—','—','—','—','—']);
 await page.goto('/?section=shipping');await expect(page.locator('.phase2-error')).toContainText('Source unavailable');
 await expect(page.locator('.shipping-stats b')).toHaveText(['—','—','—','—']);
});

test('failed production read does not invent an available production window',async({page})=>{
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'owner',role:'OWNER',displayName:'QA'}}});
 if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
 if(path==='/api/branding')return route.fulfill({json:{}});
 if(path.startsWith('/api/orders/production')||path==='/api/orders/defaults')return route.fulfill({status:503,json:{message:'Source unavailable'}});
 return route.fulfill({json:[]});});
 await page.goto('/?section=production');await expect(page.getByRole('alert')).toBeVisible();
 await expect(page.locator('.production-kpi')).toHaveCount(0);
});

test('foreign receipt without applied evidence stays unknown in orders and payment dialog',async({page})=>{
 const order={id:'foreign',number:'UNKNOWN-PAYMENT',type:'CUSTOM_ORDER',currency:'EUR',priceMinor:10000,depositRequiredMinor:5000,salesStatus:'ORDER_CONFIRMED',productionStatus:'NOT_SCHEDULED',paymentStatus:'PARTIALLY_PAID',shippingStatus:'NOT_READY',createdAt:'2026-10-01T12:00:00Z',client:{id:'a',displayName:'Example',source:'MANUAL'},items:[],activities:[],invoices:[],payments:[{id:'p',amountMinor:3000,currency:'USD',method:'BANK_TRANSFER',receivedAt:'2026-10-01T12:00:00Z'}]};
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'owner',role:'OWNER',displayName:'QA'}}});
 if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
 if(path==='/api/branding')return route.fulfill({json:{}});
 if(path==='/api/orders')return route.fulfill({json:[order]});if(path==='/api/orders/foreign')return route.fulfill({json:order});return route.fulfill({json:[]});});
 await page.goto('/?section=orders');await expect(page.locator('.orders-col-payment').getByText(/Требует проверки/).first()).toBeVisible();
 await expect(page.locator('.orders-payment-progress')).toHaveAttribute('aria-label','Требует проверки');
 await page.getByRole('button',{name:order.number,exact:true}).click();await page.getByRole('button',{name:/Добавить оплату/}).first().click();
 await expect(page.getByRole('dialog').getByText('Требует проверки',{exact:true})).toBeVisible();
});

test('an exact upcoming parcel never inherits a different legacy tracking code',async({page})=>{
 const parcel={id:'new-parcel',status:'READY',trackingNumber:null,carrier:'DHL',costMinor:0,customerChargeMinor:0,currency:'EUR'};
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'owner',role:'OWNER',displayName:'QA'}}});
 if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});if(path==='/api/branding')return route.fulfill({json:{}});
 if(path==='/api/shipping')return route.fulfill({json:{orders:[{id:'parent',number:'EXACT-PARCEL',deliveryTrackingCode:'OLD-OTHER-PARCEL',shippingStatus:'NOT_READY',currency:'EUR',client:{displayName:'Example'},items:[],shipment:null,orderShipments:[parcel],upcomingShipments:[{shipmentId:parcel.id,status:'READY',expectedAt:'2026-10-16T12:00:00Z'}]}],carriers:[]}});return route.fulfill({json:[]});});
 await page.goto('/?section=shipping&filter=upcoming&horizon=7');await expect(page.getByText('EXACT-PARCEL',{exact:true})).toBeVisible();await expect(page.getByText('OLD-OTHER-PARCEL',{exact:true})).toHaveCount(0);
});

for(const known of [false,undefined])test(`production preserves unknown settlement and older API behavior flag=${known}`,async({page})=>{
 const order={id:'evidence',number:'PRODUCTION-EVIDENCE',notes:'Example',currency:'EUR',priceMinor:10000,paidMinor:0,depositRequiredMinor:5000,paymentStatus:'UNPAID',paymentSettlementKnown:known,productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',salesStatus:'ORDER_CONFIRMED',hasTrackingNumber:false,client:{displayName:'Example'},items:[]};
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'owner',role:'OWNER',displayName:'QA'}}});
 if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});if(path==='/api/branding')return route.fulfill({json:{}});
 if(path==='/api/orders/production')return route.fulfill({json:[order]});if(path==='/api/orders/defaults')return route.fulfill({json:{defaultDurationDays:7,shippingLeadDays:2}});return route.fulfill({json:[]});});
 await page.goto('/?section=production');await expect(page.locator('.production-payment-badge')).toHaveText(known===false?'Требует проверки':'Ожидает оплаты');
 await expect(page.locator('.production-kpi').nth(2).locator('strong')).toContainText(known===false?'0':'1');
 await page.locator('.production-order-summary').click();await expect(page.locator('.production-order-details')).toBeVisible();
 if(known===false)await expect(page.locator('.production-order-details')).toContainText('Требует проверки');
});
