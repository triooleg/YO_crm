import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {PrismaHistoryNativeStorage}=loadTargetModule('history-migration/history-native-storage.ts');
const {sealHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');
process.env.SETTINGS_ENCRYPTION_KEY='synthetic-native-storage-test-only-key';
const run={id:'run',nativeConversationId:'conversation',nativeAccountId:'business',nativeCustomerId:'customer',status:'APPLIED'};
const db=(replies)=>({$queryRaw:async()=>replies.shift(),$executeRaw:async()=>1});
test('native storage independent run lookup never treats corrupt/multiple bindings as ordinary traffic',async()=>{
 assert.deepEqual(await new PrismaHistoryNativeStorage(db([[]])).loadBinding('conversation'),{kind:'NONE'});
 for(const runs of [[run,{...run,id:'other'}],[{...run,nativeAccountId:null}],[{...run,status:'UNKNOWN'}],[{...run,nativeConversationId:'other'}]])
  await assert.rejects(new PrismaHistoryNativeStorage(db([runs])).loadBinding('conversation'));
 const binding=await new PrismaHistoryNativeStorage(db([[{...run,status:'ROLLED_BACK'}]])).loadBinding('conversation');
 assert.equal(binding.status,'ROLLED_BACK');assert.equal(binding.accountId,'business');
});
test('native storage authenticates window purpose and exact run/conversation key; missing stays missing',async()=>{
 const binding={kind:'PROTECTED',conversationId:'conversation',runId:'run',accountId:'business',customerId:'customer',channel:'INSTAGRAM',status:'APPLIED'};
 assert.equal(await new PrismaHistoryNativeStorage(db([[]])).loadWindow(binding),null);
 const content={version:1,runId:'run',conversationId:'conversation'};
 const ciphertext=sealHistoryEvidence('NATIVE_WINDOW','run:conversation',content);
 assert.deepEqual(await new PrismaHistoryNativeStorage(db([[{payloadEncrypted:ciphertext}]])).loadWindow(binding),content);
 await assert.rejects(new PrismaHistoryNativeStorage(db([[{payloadEncrypted:sealHistoryEvidence('NATIVE_WINDOW','other:conversation',content)}]])).loadWindow(binding));
 await assert.rejects(new PrismaHistoryNativeStorage(db([[{payloadEncrypted:'corrupt'}]])).loadWindow(binding));
});
test('native retry verifies indexed ownership and variant columns against original sealed evidence, preserving resolved status',async()=>{
 const review={version:1,reviewKey:'a'.repeat(64),scopeKey:'["synthetic-scope"]',payloadHash:'b'.repeat(64),conversationId:'conversation',runId:'run',reason:'BEFORE_CUTOFF',eventJson:'{"event":"synthetic"}',bindingJson:'{}',windowJson:'{}'};
 const stored={id:review.reviewKey,runId:review.runId,conversationId:review.conversationId,scopeKey:review.scopeKey,payloadHash:review.payloadHash,reason:review.reason,status:'RESOLVED',payloadEncrypted:sealHistoryEvidence('NATIVE_REVIEW',review.reviewKey,review)};
 assert.deepEqual(await new PrismaHistoryNativeStorage(db([[stored]])).insertReviewAndEnvelope({...review,reason:'MISSING_WINDOW',bindingJson:'{"status":"ROLLED_BACK"}'}),{id:review.reviewKey,created:false});
 for(const patch of [{id:'c'.repeat(64)},{runId:'wrong'},{conversationId:'wrong'},{scopeKey:'wrong'},{payloadHash:'c'.repeat(64)},{reason:'MISSING_WINDOW'},{status:'UNKNOWN'}])
  await assert.rejects(new PrismaHistoryNativeStorage(db([[{...stored,...patch}]])).insertReviewAndEnvelope(review));
});
