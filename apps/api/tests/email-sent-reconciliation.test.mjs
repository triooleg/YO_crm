import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupEmailSentDuplicateFiles, emailReconciledDraftMetadata, emailSentFirstMetadata } from "../src/communications/email-sync-rules.ts";

test("Sent-first reconciliation merges the draft, keeps the claimed photo, and removes the duplicate copy",async()=>{
  const root=await mkdtemp(join(tmpdir(),"gmail-reconcile-")),files=join(root,"communication-files"),duplicateName="11111111-1111-4111-8111-111111111111.jpg";
  await mkdir(files);await writeFile(join(files,duplicateName),Buffer.from([0xff,0xd8,0xff]));
  const previousUploads=process.env.UPLOADS_DIR;process.env.UPLOADS_DIR=root;
  const deleted=[],warnings=[],claimed=[{type:"image",name:"model.jpg",mimeType:"image/jpeg",sizeBytes:3,url:"/api/communications/files/22222222-2222-4222-8222-222222222222.jpg"}];
  try{
    const sentMetadata=emailSentFirstMetadata({provider:"GMAIL",source:"GMAIL",attachments:[{url:`/api/communications/files/${duplicateName}`}]},claimed),draftMetadata=emailReconciledDraftMetadata({draftFlag:true},"sent-1");
    assert.equal(sentMetadata.source,"CRM");assert.equal(sentMetadata.attachments[0].name,"model.jpg");assert.equal(draftMetadata.draftFlag,true);assert.equal(draftMetadata.deduplicatedIntoMessageId,"sent-1");
    await cleanupEmailSentDuplicateFiles([{id:"sent-copy-1",name:duplicateName}],name=>rm(join(files,name)),async id=>{deleted.push(id)},error=>warnings.push(error));
    assert.deepEqual(deleted,["sent-copy-1"]);assert.equal(warnings.length,0);await assert.rejects(()=>readFile(join(files,duplicateName)));
    await cleanupEmailSentDuplicateFiles([{id:"retained-row",name:"missing.jpg"}],async()=>{throw new Error("disk busy")},async id=>{deleted.push(id)},error=>warnings.push(error));
    assert.deepEqual(deleted,["sent-copy-1"]);assert.equal(warnings.length,1);
    let databaseAttempts=0;const missing=Object.assign(new Error("already removed"),{code:"ENOENT"});
    await cleanupEmailSentDuplicateFiles([{id:"retry-row",name:"already-gone.jpg"}],async()=>{throw missing},async()=>{databaseAttempts++;throw new Error("database busy")},error=>warnings.push(error));
    await cleanupEmailSentDuplicateFiles([{id:"retry-row",name:"already-gone.jpg"}],async()=>{throw missing},async id=>{databaseAttempts++;deleted.push(id)},error=>warnings.push(error));
    assert.equal(databaseAttempts,2);assert.deepEqual(deleted,["sent-copy-1","retry-row"]);
  }finally{if(previousUploads===undefined)delete process.env.UPLOADS_DIR;else process.env.UPLOADS_DIR=previousUploads;await rm(root,{recursive:true,force:true})}
});
