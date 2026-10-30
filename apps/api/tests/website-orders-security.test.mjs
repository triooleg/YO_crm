import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargetModule } from './website-test-loader.mjs';
const { authorizeWebsiteOrder } = loadTargetModule('website-orders/website-orders-security.ts');
const token='synthetic-website-test-token-0123456789';
test('website bearer rejects missing, wrong and malformed credentials without echoing them',()=>{
 for(const header of [undefined,'Bearer wrong-private-value','Basic '+token,'Bearer '+token+', Bearer '+token]){
  assert.throws(()=>authorizeWebsiteOrder(header,token),error=>error.code==='WEBSITE_UNAUTHORIZED'&&!JSON.stringify(error).includes(token)&&!error.message.includes('wrong-private-value'));
 }
 assert.doesNotThrow(()=>authorizeWebsiteOrder('Bearer '+token,token));
});
test('website endpoint is disabled when server token is missing or too short',()=>{
 for(const secret of [undefined,'','short'])assert.throws(()=>authorizeWebsiteOrder('Bearer '+token,secret),e=>e.code==='WEBSITE_DISABLED');
});
