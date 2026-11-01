import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {historyNativeFixture} from './history-native-fixture.mjs';
import {nativeHistoryServices} from './history-native-engine-fixture.mjs';
import {pilotMessage,pilotOwner,pilotScope} from './history-migration-fixture.mjs';
import {loadTargetModule} from './overview-target-loader.mjs';

test('real inbound/detail with native archive: concurrent writer, replay, chronology and selective rollback',
 {skip:process.env.YO_HISTORY_NATIVE!=='1',timeout:180000},async()=>{
  const names=['HISTORY_MIGRATION_ENABLED','HISTORY_MIGRATION_PLANNING_ENABLED','SETTINGS_ENCRYPTION_KEY','AI_ENABLED','AI_MESSAGE_ANALYSIS_ENABLED'];
  const before=names.map(k=>process.env[k]),previousFetch=globalThis.fetch;let f;
  process.env.HISTORY_MIGRATION_ENABLED='true';process.env.HISTORY_MIGRATION_PLANNING_ENABLED='true';
  process.env.SETTINGS_ENCRYPTION_KEY='synthetic-native-inbox-key-not-production';process.env.AI_ENABLED='false';process.env.AI_MESSAGE_ANALYSIS_ENABLED='false';
  globalThis.fetch=()=>{throw Error('Provider/network requests forbidden in native qualification');};
  try{
    f=await historyNativeFixture();const s=await nativeHistoryServices(f,{seed:true});
    const {CommunicationsService}=loadTargetModule('communications/communications.service.ts');
    const service=new CommunicationsService(f.db,{}),baseline=await s.snapshot();
    const job=await s.intake.create(pilotScope,'synthetic-password',pilotOwner),pair=await s.intake.pair(job.jobId,'synthetic-password',pilotOwner);
    const messages=[0,1,2].map(ordinal=>pilotMessage('inbox-'+ordinal,{ordinal,text:'Historical '+ordinal,timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv',attachments:ordinal===1?[{name:'Unavailable photo',mimeType:'image/jpeg',size:null,checksum:null,available:false}]:[]}));
    const payloadJson=JSON.stringify({version:1,source:'KEYCRM',messages,completeness:{status:'PARTIAL'}});
    await s.intake.stage(job.jobId,`Bearer ${pair.token}`,{batchId:randomUUID(),payloadJson,checksum:createHash('sha256').update(payloadJson).digest('hex')});
    await s.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);
    const approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]};
    const preview=await s.pilot.previewArchive(job.jobId,approval,pilotOwner);
    const cleanGrant=await f.dump();
    const event={channel:'INSTAGRAM',externalSenderId:'synthetic_handle',receiverId:'synthetic-business',externalMessageId:'native-live-1',content:'Live original',receivedAt:new Date('2026-10-31T10:00:00Z'),metadata:{messageType:'text'}};
    const entered=Promise.withResolvers(),release=Promise.withResolvers();
    const writer=await f.connect();
    const heldService=new CommunicationsService({$transaction:callback=>writer.$transaction(async tx=>{
      const result=await callback(tx);entered.resolve();await release.promise;return result;
    },{timeout:15000})},{});
    const active=heldService.persistInbound(event,'META',{synthetic:true});await entered.promise;
    try{await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner),e=>e.meta?.code==='55P03');}
    finally{release.resolve();await active;}
    const afterLive=await s.snapshot();assert.equal(afterLive.Message.length,baseline.Message.length+1);
    assert.equal(await service.persistInbound(event,'META',{synthetic:true}),false);
    assert.deepEqual(await s.snapshot(),afterLive,'provider replay must not alter unread, envelope, audit or business rows');
    await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner),/Предпросмотр/);
    const fresh=await s.pilot.previewArchive(job.jobId,approval,pilotOwner);
    assert.ok(fresh.blockers.includes('UNVERIFIED_EXISTING_PROVENANCE'));
    await assert.rejects(s.pilot.applyArchive(job.jobId,fresh.previewDigest,approval,'synthetic-password',pilotOwner),/Сначала устраните/);
    assert.deepEqual(await s.snapshot(),afterLive,'unverified native/source overlap fails closed without edits');
    // Continue reader/rollback qualification in a separate freshly restored owned
    // database. Never delete the native message to make an import appear safe.
    const restored=await f.restore(cleanGrant),r=await nativeHistoryServices(restored),reader=new CommunicationsService(restored.db,{});
    const ready=await r.pilot.previewArchive(job.jobId,approval,pilotOwner);
    const applied=await r.pilot.applyArchive(job.jobId,ready.previewDigest,approval,'synthetic-password',pilotOwner);assert.equal(applied.added,3);
    assert.equal((await r.pilot.applyArchive(job.jobId,ready.previewDigest,approval,'synthetic-password',pilotOwner)).added,0);
    assert.equal(await reader.persistInbound(event,'META',{synthetic:true}),true);
    const imported=(await reader.detail('existing','INSTAGRAM')).messages;
    const archive=imported.filter(m=>m.metadata?.historyArchive);
    assert.deepEqual(archive.map(m=>m.content),['Historical 0','Historical 1','Historical 2']);
    assert.ok(archive.every(m=>m.createdAt.toISOString()==='2024-01-01T10:30:00.000Z'));
    assert.equal(archive[1].metadata.historyArchive.missingAttachments.length,1);
    assert.ok(archive.every(m=>!m.externalId),'KeyCRM aliases must not become native provider IDs');
    assert.equal(imported.at(-1).content,'Live original');
    assert.deepEqual((await reader.detail('existing')).messages.filter(m=>m.metadata?.historyArchive).map(m=>m.id),archive.map(m=>m.id));
    assert.equal((await reader.detail('existing','EMAIL')).messages.length,1);
    const snapshot=await r.snapshot();for(const table of ['Order','Payment','OrderItem','Athlete','MessageAnalysis','AiJob','AiJobAttempt'])assert.deepEqual(snapshot[table],baseline[table]);
    await r.pilot.rollback(job.jobId,applied.runId,'synthetic-password',pilotOwner);
    const remaining=(await reader.detail('existing','INSTAGRAM')).messages;assert.equal(remaining.length,1);assert.equal(remaining[0].content,'Live original');
    assert.equal(await reader.persistInbound(event,'META',{synthetic:true}),false);
    const final=await r.snapshot();assert.equal(final.Message.length,snapshot.Message.length,'rollback hides without deleting history');
    assert.equal(final.HistoryMigrationOrigin.length,3);assert.equal(final.MessageAttachment.length,baseline.MessageAttachment.length);
    assert.deepEqual(await s.snapshot(),afterLive,'source database with real native message stays unchanged throughout restore/import/rollback');
  }finally{
    globalThis.fetch=previousFetch;if(f)await f.close();names.forEach((k,i)=>{if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i];});
  }
});
