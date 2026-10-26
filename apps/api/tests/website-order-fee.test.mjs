import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';

const {websiteOrderCardFee}=loadTargetModule('orders/website-order-fee.ts');
test('website card fee is read from source snapshot without changing tax or total',()=>{
 const order={sourceSystem:'YOLEOTARD_WEBSITE',priceMinor:28878,taxMinor:0,externalData:{totals:{itemsMinor:28000,deliveryMinor:300,cardFeeMinor:578,chargedMinor:28878}}};
 assert.equal(websiteOrderCardFee(order),578);assert.equal(order.priceMinor,28878);assert.equal(order.taxMinor,0);
 assert.equal(websiteOrderCardFee({...order,sourceSystem:'KEYCRM'}),null);
 assert.equal(websiteOrderCardFee({...order,priceMinor:28000}),null);
 assert.equal(websiteOrderCardFee({...order,externalData:{totals:{cardFeeMinor:'578',chargedMinor:28878}}}),null);
});
