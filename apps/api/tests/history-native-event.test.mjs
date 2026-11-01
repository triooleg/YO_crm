import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {originalMetaHistoryTimestamp}=loadTargetModule('history-migration/history-native-event.ts');
const scope={accountId:'business',customerId:'customer',nativeMessageId:'mid',direction:'INBOUND'};
const payload=(change={})=>({entry:[{id:'business',messaging:[{sender:{id:'customer'},recipient:{id:'business'},timestamp:1704110400123,message:{mid:'mid',text:'Synthetic'},...change}]}]});
test('history ingress time requires original scoped Meta event, never delivery or receipt fallback',()=>{
 assert.equal(originalMetaHistoryTimestamp(payload(),scope),'2024-01-01T12:00:00.123Z');
 for(const timestamp of [undefined,null,'1704110400123',0,-1,NaN,Infinity,1704110400123.5,8640000000000001])
  assert.equal(originalMetaHistoryTimestamp(payload({timestamp}),scope),null);
 for(const patch of [{accountId:'wrong'},{customerId:'wrong'},{nativeMessageId:'wrong'},{direction:'OUTBOUND'}])
  assert.equal(originalMetaHistoryTimestamp(payload(),{...scope,...patch}),null);
 assert.equal(originalMetaHistoryTimestamp(null,scope),null);
});
test('outbound echo uses account sender and customer recipient and refuses ambiguous source events',()=>{
 const echo=payload({sender:{id:'business'},recipient:{id:'customer'},message:{mid:'mid',is_echo:true}});
 assert.equal(originalMetaHistoryTimestamp(echo,{...scope,direction:'OUTBOUND'}),'2024-01-01T12:00:00.123Z');
 assert.equal(originalMetaHistoryTimestamp(echo,scope),null);
 const ambiguous=payload();ambiguous.entry[0].messaging.push({...ambiguous.entry[0].messaging[0],timestamp:1704110400999});
 assert.equal(originalMetaHistoryTimestamp(ambiguous,scope),null);
 const standby=payload();standby.entry[0].standby=standby.entry[0].messaging;delete standby.entry[0].messaging;
 assert.equal(originalMetaHistoryTimestamp(standby,scope),'2024-01-01T12:00:00.123Z');
});
