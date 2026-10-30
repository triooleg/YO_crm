import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleShipmentOrders, shipmentChannelCanSend, mergeShipmentDeliveries, createShipmentNotificationsApi, createShipmentNotificationSession, ShipmentNotificationRequestError } from '../lib/shipment-notifications.ts';

test('only parcels with a tracking number and usable full HTTPS link are offered, preserving order ownership', () => {
  const parcel = { id:'s1', carrier:'UPS', trackingNumber:'TEST1', trackingUrl:'https://www.ups.com/track?tracknum=TEST1', trackingRevision:1 };
  const result = eligibleShipmentOrders([
    {id:'o1', number:'YO-1', shipments:[parcel, {...parcel,id:'blank',trackingNumber:' '}, {...parcel,id:'http',trackingUrl:'http://ups.com/track'}, {...parcel,id:'bad',trackingUrl:'javascript:alert(1)'}, {...parcel,id:'credentials',trackingUrl:'https://user:secret@ups.com/track'}]},
    {id:'o2', number:'YO-2', shipments:[]},
    {id:'o3', number:'YO-3', shipments:[{...parcel,id:'s3'}]},
  ]);
  assert.deepEqual(result.map(o=>[o.id,o.shipments.map(s=>s.id)]), [['o1',['s1']],['o3',['s3']]]);
});

test('allow new channels and retry only FAILED, never SENT, UNKNOWN, PENDING or SENDING', () => {
  for (const status of ['SENT','UNKNOWN','PENDING','SENDING']) assert.equal(shipmentChannelCanSend(true,'CHAT',{id:'n',deliveries:[{channel:'CHAT',status}]}),false);
  assert.equal(shipmentChannelCanSend(true,'CHAT',{id:'n',deliveries:[{channel:'CHAT',status:'FAILED'}]}),true);
  assert.equal(shipmentChannelCanSend(false,'CHAT'),false);
  assert.equal(shipmentChannelCanSend(true,'CHAT'),true);
  assert.equal(shipmentChannelCanSend(true,'EMAIL',{id:'n',deliveries:[]}),true);
});

test('a stale status response cannot downgrade a known successful delivery', () => {
  const sent={channel:'EMAIL',status:'SENT',sentAt:'2026-10-27T10:00:00Z'};
  assert.deepEqual(mergeShipmentDeliveries([sent,{channel:'CHAT',status:'UNKNOWN'}],[{channel:'EMAIL',status:'PENDING'},{channel:'CHAT',status:'FAILED'}]),[{channel:'CHAT',status:'FAILED'},sent]);
});

const parcel={id:'s1',carrier:'UPS',trackingNumber:'TEST1',trackingUrl:'https://www.ups.com/track?tracknum=TEST1',trackingRevision:1};
const options={orders:[{id:'o1',number:'YO-1',shipments:[parcel]}],chat:{available:true},email:{available:true,recipient:'synthetic@example.test',requiresConfirmation:true},languages:[{value:'en',label:'English'},{value:'ru',label:'Русский'}]};
const preview={...parcel,orderId:'o1',orderNumber:'YO-1',shipmentId:'s1',scopeToken:'scope-1',language:'en',content:'Your order has shipped',subject:'Order YO-1 shipped',emailRecipient:'synthetic@example.test',emailRequiresConfirmation:true,chatAvailable:true,emailAvailable:true};
function fixture(overrides={}) {
  const posts=[];
  const api={options:async()=>structuredClone(options),preview:async body=>({...preview,...body}),send:async body=>{posts.push(body);return {id:'n1',deliveries:[{channel:'CHAT',status:'FAILED'},{channel:'EMAIL',status:'SENT'}]}},status:async()=>({id:'n1',deliveries:[{channel:'CHAT',status:'FAILED'},{channel:'EMAIL',status:'SENT'}]}),...overrides};
  return {session:createShipmentNotificationSession({clientId:'client 1',conversationId:'conversation 1',channel:'INSTAGRAM'},api),posts};
}

test('unique parcel opens preview, defaults both channels, requires explicit fallback email confirmation and retries failed chat only',async()=>{
  const {session,posts}=fixture();await session.refresh();await session.open();
  assert.equal(session.getSnapshot().preview.shipmentId,'s1');
  assert.equal(session.getSnapshot().sendChat,true);assert.equal(session.getSnapshot().sendEmail,true);
  assert.equal(await session.send(),false);assert.equal(posts.length,0);
  session.edit({confirmClientEmail:true,content:'Reviewed content'});assert.equal(await session.send(),true);
  assert.equal(posts[0].content,'Reviewed content');assert.equal(posts[0].scopeToken,'scope-1');assert.equal(posts[0].conversationId,'conversation 1');
  session.edit({content:'Cannot change a partial operation',sendEmail:true});assert.equal(await session.send(),false);
  session.edit({sendEmail:false});assert.equal(await session.send(),true);
  assert.equal(posts[1].sendEmail,false);assert.equal(posts[1].sendChat,true);assert.equal(posts[1].content,'Reviewed content');
});

test('multiple orders and parcels require explicit choices; choosing another order clears the old parcel',async()=>{
  const {session}=fixture({options:async()=>({...options,orders:[{id:'o1',number:'YO-1',shipments:[parcel,{...parcel,id:'s2'}]},{id:'o2',number:'YO-2',shipments:[{...parcel,id:'s3'}]}]})});
  await session.open();assert.equal(session.getSnapshot().preview,undefined);
  await session.selectOrder('o1');assert.equal(session.getSnapshot().preview,undefined);
  await session.selectShipment('s2');assert.equal(session.getSnapshot().preview.shipmentId,'s2');
  await session.selectOrder('o2');assert.equal(session.getSnapshot().preview.shipmentId,'s3');
});

test('email-only is eligible; missing email leaves chat alone; language refresh uses server template',async()=>{
  const {session,posts}=fixture({preview:async body=>({...preview,...body,chatAvailable:false,emailRequiresConfirmation:false,content:body.language==='ru'?'Ваш заказ отправлен':'Your order shipped'})});
  await session.open();assert.equal(session.getSnapshot().sendChat,false);assert.equal(session.getSnapshot().sendEmail,true);
  await session.language('ru');assert.equal(session.getSnapshot().content,'Ваш заказ отправлен');await session.send();assert.equal(posts[0].language,'ru');
  const {session:chat}=fixture({preview:async()=>({...preview,emailRecipient:undefined,emailAvailable:false})});await chat.open();assert.equal(chat.getSnapshot().sendEmail,false);assert.equal(chat.canSend(),true);
});

test('lost response blocks resends across close/reopen until server reconciliation; no automatic send',async()=>{
  let attempts=0,reconciled=false;
  const {session}=fixture({send:async()=>{attempts++;throw Error('network lost')},preview:async()=>({...preview,previous:reconciled?{id:'n1',content:'Saved content',subject:'Saved subject',deliveries:[{channel:'EMAIL',status:'UNKNOWN'},{channel:'CHAT',status:'SENT'}]}:undefined})});
  await session.open();session.edit({confirmClientEmail:true});await session.send();assert.equal(session.getSnapshot().uncertain,true);
  session.close();await session.open();assert.equal(session.canSend(),false);await session.send();assert.equal(attempts,1);
  reconciled=true;await session.status();assert.equal(session.getSnapshot().content,'Saved content');assert.equal(session.canSend(),false);assert.equal(attempts,1);
});

test('double clicks do not send twice and disposed context cannot accept old responses',async()=>{
  let finish;const {session,posts}=fixture({send:body=>{posts.push(body);return new Promise(resolve=>finish=resolve)}});
  await session.open();session.edit({confirmClientEmail:true});const pending=session.send();assert.equal(await session.send(),false);assert.equal(posts.length,1);
  session.dispose();finish({id:'n1',deliveries:[{channel:'EMAIL',status:'SENT'}]});assert.equal(await pending,false);assert.equal(session.getSnapshot().result,undefined);
});

test('previous pending/unknown channels stay disabled, status refresh preserves SENT, new tracking revision is independent',async()=>{
  let revision=1;
  const {session}=fixture({preview:async()=>({...preview,trackingRevision:revision,previous:revision===1?{id:'n1',content:'Saved',subject:'Saved',deliveries:[{channel:'EMAIL',status:'SENT',sentAt:'2026-10-27T10:00:00Z'},{channel:'CHAT',status:'PENDING'}]}:undefined}),status:async()=>({id:'n1',deliveries:[{channel:'EMAIL',status:'FAILED'},{channel:'CHAT',status:'UNKNOWN'}]})});
  await session.open();assert.equal(session.canSend(),false);await session.status();assert.equal(session.getSnapshot().result.deliveries.find(x=>x.channel==='EMAIL').status,'SENT');assert.equal(session.canSend(),false);
  session.close();revision=2;await session.open();session.edit({confirmClientEmail:true});assert.equal(session.canSend(),true);
});

test('API boundary encodes context and operation id, uses authenticated JSON and does not reflect raw server errors',async()=>{
  const calls=[];const api=createShipmentNotificationsApi(async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({})}});
  await api.options({clientId:'client&1',channel:'INSTAGRAM',conversationId:'conv ?'});assert.equal(calls[0].url,'/api/shipment-notifications/options?clientId=client%261&channel=INSTAGRAM&conversationId=conv+%3F');assert.equal(calls[0].init.credentials,'include');
  await api.status('id/?');assert.equal(calls[1].url,'/api/shipment-notifications/id%2F%3F');
  await assert.rejects(createShipmentNotificationsApi(async()=>({ok:false,status:403,json:async()=>({message:'secret'})})).options({clientId:'c'}),/shipment-notification-403/);
});

test('UNKNOWN permits a manual retry only after authoritative FAILED; checking status never sends',async()=>{
  let reconciled=false;
  const {session,posts}=fixture({preview:async()=>({...preview,previous:{id:'n1',content:'Original content',subject:'Original subject',deliveries:[{channel:'CHAT',status:'SENT'},{channel:'EMAIL',status:'UNKNOWN'}]}}),status:async()=>({id:'n1',deliveries:[{channel:'CHAT',status:'SENT'},{channel:'EMAIL',status:reconciled?'FAILED':'UNKNOWN'}]})});
  await session.open();session.edit({confirmClientEmail:true});assert.equal(await session.send(),false);await session.status();assert.equal(session.canSend(),false);assert.equal(posts.length,0);
  reconciled=true;await session.status();assert.equal(posts.length,0);assert.equal(session.canSend(),true);await session.send();
  assert.equal(posts.length,1);assert.equal(posts[0].sendEmail,true);assert.equal(posts[0].sendChat,false);assert.equal(posts[0].content,'Original content');
});

test('an unrelated unknown channel does not prevent manually retrying a definitively failed channel',async()=>{
  const {session,posts}=fixture({preview:async()=>({...preview,previous:{id:'n1',content:'Original',subject:'Original',deliveries:[{channel:'CHAT',status:'FAILED'},{channel:'EMAIL',status:'UNKNOWN'}]}})});
  await session.open();assert.equal(session.canSend(),true);await session.send();assert.equal(posts[0].sendChat,true);assert.equal(posts[0].sendEmail,false);
});

test('preview responses after disposal cannot expose another client context or initiate preview loading',async()=>{
  let finish;const {session}=fixture({options:()=>new Promise(resolve=>finish=resolve)});
  const open=session.open();session.dispose();finish(options);await open;assert.equal(session.getSnapshot().preview,undefined);assert.equal(session.getSnapshot().options,undefined);
  let finishPreview;const {session:other}=fixture({preview:()=>new Promise(resolve=>finishPreview=resolve)});
  const pending=other.open();await new Promise(resolve=>setImmediate(resolve));other.dispose();finishPreview(preview);await pending;assert.equal(other.getSnapshot().preview,undefined);
});

test('server status read failure preserves known SENT and forbids retrying that channel',async()=>{
  const {session}=fixture({status:async()=>{throw Error('offline')}});await session.open();session.edit({confirmClientEmail:true});await session.send();await session.status();
  assert.equal(session.getSnapshot().error,'status');assert.equal(session.getSnapshot().result.deliveries.find(d=>d.channel==='EMAIL').status,'SENT');
  session.edit({sendEmail:true});assert.equal(session.canSend(),false);
});

test('scope token is rebound to an existing notification language before retrying',async()=>{
  const previews=[];
  const {session,posts}=fixture({preview:async body=>{previews.push(body);return {...preview,language:'ru',scopeToken:body.language==='ru'?'ru-token':'profile-token',previous:{id:'n1',language:'ru',content:'Сохранённый текст',subject:'Сохранённая тема',deliveries:[{channel:'CHAT',status:'FAILED'}]}}}});
  await session.open();assert.equal(previews.at(-1).language,'ru');session.edit({confirmClientEmail:true});await session.send();assert.equal(posts[0].scopeToken,'ru-token');assert.equal(posts[0].language,'ru');
});

test('reopening preserves reviewed content and known SENT even if a stale preview omits previous',async()=>{
  const {session,posts}=fixture();await session.open();session.edit({content:'Reviewed immutable',confirmClientEmail:true});await session.send();session.close();await session.open();
  assert.equal(session.getSnapshot().content,'Reviewed immutable');assert.equal(session.getSnapshot().sendEmail,false);await session.send();assert.equal(posts[1].content,'Reviewed immutable');assert.equal(posts[1].sendEmail,false);
});

test('definitive validation conflict requires a fresh preview, while a server timeout remains uncertain',async()=>{
  for(const status of [400,401,403,404,409,422]) {
    let attempts=0;
    const {session}=fixture({send:async()=>{attempts++;throw new ShipmentNotificationRequestError(status)}});
    await session.open();session.edit({confirmClientEmail:true});await session.send();
    assert.equal(session.getSnapshot().uncertain,false);assert.equal(session.getSnapshot().preview,undefined);assert.equal(session.getSnapshot().error,'rejected');assert.equal(session.canSend(),false);
    await session.selectShipment('s1');session.edit({confirmClientEmail:true});assert.equal(session.canSend(),true);assert.equal(attempts,1);
  }
  const {session}=fixture({send:async()=>{throw new ShipmentNotificationRequestError(408)}});await session.open();session.edit({confirmClientEmail:true});await session.send();assert.equal(session.getSnapshot().uncertain,true);
});

test('an available channel with no previous delivery can be added to the immutable notification with explicit email confirmation',async()=>{
  const {session,posts}=fixture({preview:async()=>({...preview,previous:{id:'n1',content:'Original reviewed chat text',subject:'Original reviewed subject',deliveries:[{channel:'CHAT',status:'SENT',sentAt:'2026-10-27T10:00:00Z'}]}})});
  await session.open();assert.equal(session.getSnapshot().sendChat,false);assert.equal(session.getSnapshot().sendEmail,true);
  assert.equal(session.canSend(),false);assert.equal(await session.send(),false);assert.equal(posts.length,0);
  session.edit({confirmClientEmail:true,content:'Do not replace original',subject:'Do not replace original'});
  assert.equal(session.canSend(),true);assert.equal(await session.send(),true);
  assert.equal(posts.length,1);assert.equal(posts[0].sendChat,false);assert.equal(posts[0].sendEmail,true);assert.equal(posts[0].confirmClientEmail,true);
  assert.equal(posts[0].content,'Original reviewed chat text');assert.equal(posts[0].subject,'Original reviewed subject');
  assert.equal(session.getSnapshot().result.deliveries.find(d=>d.channel==='CHAT').status,'SENT');
});
