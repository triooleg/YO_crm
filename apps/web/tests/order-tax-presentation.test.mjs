import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/order-tax-presentation.ts', import.meta.url), 'utf8');
const { orderTaxPresentation } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64'));

test('fixed 400 EUR remains 400, commercial tax and delivery never reprice the order', () => {
  const input = { priceMinor: 40000, currency: 'EUR', deliveryMinor: 3000, taxMinor: 3800, giftWrapMinor: 0, discountMinor: 0 };
  const result = orderTaxPresentation(input, [{ priceMinor: 35000, quantity: 1 }]);
  assert.equal(result.totalMinor, 40000);
  assert.equal(result.productsMinor, 35000);
  assert.equal(result.deliveryMinor, 3000);
  assert.equal(result.priceTaxMinor, null);
  assert.equal(result.allocated, false);
  assert.deepEqual(input, { priceMinor: 40000, currency: 'EUR', deliveryMinor: 3000, taxMinor: 3800, giftWrapMinor: 0, discountMinor: 0 });
});

test('estimate is consumed as nullable server evidence, never calculated from unpaid total', () => {
  const order = { priceMinor: 40000, currency: 'EUR' };
  const estimate = { amountMinor: 2400, currency: 'EUR', asOfDate: '2026-05-01', basis: 'ORDER_CREATED_AT', policyId: 'policy1', effectiveFrom: '2026-05-01', incomplete: false, missing: [] };
  assert.equal(orderTaxPresentation(order, [], estimate).priceTaxMinor, 2400);
  for (const invalid of [undefined, null, { ...estimate, amountMinor: null }, { ...estimate, incomplete: true }, { ...estimate, currency: 'UAH' }, { ...estimate, amountMinor: 50000 }, { ...estimate, amountMinor: NaN }]) {
    assert.equal(orderTaxPresentation(order, [], invalid).priceTaxMinor, null);
  }
  assert.equal(orderTaxPresentation(order, []).totalMinor, 40000);
});

test('unknown delivery or unsafe items remain unallocated without a residual guess', () => {
  const view = orderTaxPresentation({ priceMinor: 40000, currency: 'EUR' }, [{ priceMinor: 35000, quantity: 1 }]);
  assert.equal(view.deliveryMinor, null); assert.equal(view.allocated, false);
  assert.equal(orderTaxPresentation({ priceMinor: 40000, currency: 'EUR' }, [{ priceMinor: Number.MAX_SAFE_INTEGER, quantity: 2 }]).productsMinor, null);
});
test('website card fee is already inside the charged EUR price', () => {
  const view = orderTaxPresentation({priceMinor:28878,currency:'EUR',deliveryMinor:300,taxMinor:0,websiteCardFeeMinor:578,giftWrapMinor:0,discountMinor:0},[{priceMinor:28000,quantity:1}]);
  assert.equal(view.allocated,true);assert.equal(view.totalMinor,28878);assert.equal(view.productsMinor+view.deliveryMinor+578,28878);
});
test('website checkout discount is already netted into item prices',()=>{
 const view=orderTaxPresentation({sourceSystem:'YOLEOTARD_WEBSITE',priceMinor:21500,currency:'EUR',deliveryMinor:1000,taxMinor:0,websiteCardFeeMinor:500,giftWrapMinor:0,discountMinor:1000},[{priceMinor:10000,quantity:2}]);
 assert.equal(view.allocated,true);assert.equal(view.totalMinor,21500);
});
