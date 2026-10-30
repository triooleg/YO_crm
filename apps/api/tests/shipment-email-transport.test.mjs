import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadTargetModule} from './website-test-loader.mjs';
const require=createRequire(import.meta.url),nodemailer=require('nodemailer');
const {EmailTransportService,EmailDeliveryUncertainError}=loadTargetModule('communications/email-transport.service.ts');
const connection={enabled:true,smtpHost:'smtp.gmail.com',smtpPort:465,imapHost:'imap.gmail.com',imapPort:993,username:'sender@example.org',fromAddress:'sender@example.org',password:'synthetic-not-a-secret',signature:'Team Yoleotard'};
const input={to:'order@example.org',subject:'Shipped',text:'Track your parcel',messageId:'<shipment-11111111-1111-4111-8111-111111111111@yoleotard.com>'};
test('shipment transport forwards caller RFC Message-ID and keeps existing signature/plain SMTP behavior',async()=>{
 const original=nodemailer.createTransport,mail=[];nodemailer.createTransport=()=>({sendMail:async value=>{mail.push(value);return {messageId:value.messageId||'<generated@example.org>'}}});
 try{const service=new EmailTransportService({});service.settings=async()=>connection;
 assert.equal((await service.send(input)).messageId,input.messageId);assert.equal(mail[0].messageId,input.messageId);assert.equal(mail[0].text,'Track your parcel\n\nTeam Yoleotard');assert.equal(mail[0].to,input.to);
 const {messageId,...ordinary}=input;assert.equal((await service.send(ordinary)).messageId,'<generated@example.org>');assert.equal(mail[1].messageId,undefined);
 }finally{nodemailer.createTransport=original}
});
for(const [name,response] of [['network',{code:'ETIMEDOUT'}],['definitive SMTP',{responseCode:550}],['missing id',null]])test(`shipment transport preserves ${name} classification`,async()=>{
 const original=nodemailer.createTransport;nodemailer.createTransport=()=>({sendMail:async()=>{if(response)throw Object.assign(new Error('synthetic'),response);return {}}});
 try{const service=new EmailTransportService({});service.settings=async()=>connection;
 await assert.rejects(()=>service.send(input),error=>name==='definitive SMTP'?error.message==='Gmail отклонил исходящее письмо':error instanceof EmailDeliveryUncertainError);
 }finally{nodemailer.createTransport=original}
});
test('shipment transport rejects account switch before opening SMTP',async()=>{
 const original=nodemailer.createTransport;let opened=false;nodemailer.createTransport=()=>{opened=true;throw new Error('must not connect')};
 try{const service=new EmailTransportService({});service.settings=async()=>connection;await assert.rejects(()=>service.send({...input,accountIdentity:'different-account'}),/аккаунт изменился/);assert.equal(opened,false)}finally{nodemailer.createTransport=original}
});
