import test from "node:test";
import assert from "node:assert/strict";
import {emailCursorUid,emailDisplayContent,emailRetryCursor,emailStandaloneAttachments,emailUidRange} from "../src/communications/email-sync-rules.ts";

test("Gmail cursor resets for another account or UIDVALIDITY",()=>{const saved={account:"a@gmail.com",mailbox:"INBOX",uidValidity:"1",uid:40};assert.equal(emailCursorUid(saved,"a@gmail.com","1"),40);assert.equal(emailCursorUid(saved,"b@gmail.com","1"),0);assert.equal(emailCursorUid(saved,"a@gmail.com","2"),0)});
test("Gmail UID range is empty when UIDNEXT proves there is no new mail",()=>{assert.deepEqual(emailUidRange(40,41,[]),[]);assert.equal(emailUidRange(40,42,[]),"41:*");assert.deepEqual(emailUidRange(0,0,[1,2,3]),[1,2,3])});
test("Gmail display data is bounded while MIME and attachment fanout stay controlled",()=>{assert.ok(emailDisplayContent("x".repeat(150_000)).length<101_000);assert.equal(emailStandaloneAttachments(Array.from({length:100},(_,i)=>i)).length,20)});
test("Gmail quarantine retry is scope-bound and can only rewind",()=>{const current={account:"a@gmail.com",mailbox:"INBOX",uidValidity:"7",uid:100};assert.equal(emailRetryCursor(current,{...current,uid:70},"a@gmail.com","7"),69);assert.equal(emailRetryCursor(current,{...current,account:"b@gmail.com",uid:70},"a@gmail.com","7"),null);assert.equal(emailRetryCursor(current,{...current,uidValidity:"8",uid:70},"a@gmail.com","7"),null);assert.equal(emailRetryCursor(current,{...current,uid:101},"a@gmail.com","7"),null)});
