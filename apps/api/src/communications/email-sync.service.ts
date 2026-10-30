import { shipmentEmailAccountIdentity } from "./shipment-email-account";
import { recoveryIsolationEnabled } from "../recovery-safety";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { ContactChannel, MessageDirection, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { uploadsRoot } from "../uploads";
import { CommunicationsService } from "./communications.service";
import { emailPlainTextFromHtml, emailSafeHtml, legacyEmailBackfillCursor, legacyEmailHtmlFromRaw } from "./email-html";
import { EmailTransportService, type EmailConnection } from "./email-transport.service";
import { emailCursorUid, emailDisplayContent, emailLatestContent, emailRetryCursor, emailSentImageAllowed, emailStandaloneAttachments, emailUidRange } from "./email-sync-rules";

const emailExtensions:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","application/pdf":"pdf","text/plain":"txt"};
type SyncDirection="INBOUND"|"OUTBOUND";
type SyncMailbox={path:string;cursorKey:"inboxCursor"|"sentCursor";direction:SyncDirection};
type SyncCursor={account:string;mailbox:string;uidValidity:string;uid:number};
type StoredAttachment={name:string;mimeType:string;sizeBytes:number;url:string};

@Injectable()
export class EmailSyncService implements OnModuleInit,OnModuleDestroy{
  private readonly logger=new Logger(EmailSyncService.name);
  private timer?:NodeJS.Timeout;
  private startupTimers:NodeJS.Timeout[]=[];
  private running=false;
  private backfillRunning=false;
  constructor(private readonly prisma:PrismaService,private readonly transport:EmailTransportService,private readonly communications:CommunicationsService){}
  onModuleInit(){if(recoveryIsolationEnabled())return;this.timer=setInterval(()=>void this.tick(),30_000);this.startupTimers=[setTimeout(()=>void this.backfillLegacyHtml(),2_000),setTimeout(()=>void this.tick(),5_000)]}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);for(const timer of this.startupTimers)clearTimeout(timer)}

  private async backfillLegacyHtml(){if(recoveryIsolationEnabled())return;
    if(this.backfillRunning)return;this.backfillRunning=true;
    try{
      const cursorSetting=await this.prisma.appSetting.findUnique({where:{section_key:{section:"integration.email.sync",key:"legacyHtmlBackfillCursor"}}}),cursorValue=cursorSetting?.value&&typeof cursorSetting.value==="object"&&!Array.isArray(cursorSetting.value)?cursorSetting.value as Prisma.JsonObject:{};
      let cursor=typeof cursorValue.messageId==="string"?cursorValue.messageId:undefined,scanned=0;
      while(scanned<5_000){
        const batch=await this.prisma.message.findMany({where:{direction:MessageDirection.INBOUND,conversation:{channel:ContactChannel.EMAIL}},orderBy:{id:"asc"},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,content:true,metadata:true}});
        if(!batch.length)break;
        let retryRequired=false;
        for(const message of batch){
          scanned+=1;
          const metadata=message.metadata&&typeof message.metadata==="object"&&!Array.isArray(message.metadata)?message.metadata as Prisma.JsonObject:{};
          if(typeof metadata.emailHtml==="string"||metadata.emailHtmlBackfillVersion===1){cursor=legacyEmailBackfillCursor(cursor,message.id);continue}
          const rawPath=typeof metadata.rawPath==="string"&&/^[a-f0-9-]{36}\.eml$/.test(metadata.rawPath)?metadata.rawPath:"";
          if(!rawPath){cursor=legacyEmailBackfillCursor(cursor,message.id);continue}
          try{
            const restored=await legacyEmailHtmlFromRaw(await readFile(join(uploadsRoot(),"communication-files",rawPath)));
            await this.prisma.$transaction(async tx=>{
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"email-html-backfill:"+message.id},0))`;
              const current=await tx.message.findUnique({where:{id:message.id},select:{direction:true,content:true,metadata:true,conversation:{select:{channel:true}}}});
              if(!current||current.direction!==MessageDirection.INBOUND||current.conversation.channel!==ContactChannel.EMAIL)return;
              const currentMetadata=current.metadata&&typeof current.metadata==="object"&&!Array.isArray(current.metadata)?current.metadata as Prisma.JsonObject:{};
              if(currentMetadata.rawPath!==rawPath||typeof currentMetadata.emailHtml==="string"||currentMetadata.emailHtmlBackfillVersion===1)return;
              const content=restored.emailHtml?restored.content:current.content,newMetadata={...currentMetadata,...(restored.emailHtml?{emailHtml:restored.emailHtml,emailHtmlBackfillOriginalContent:current.content}:{}),emailHtmlBackfillVersion:1} as Prisma.InputJsonValue;
              await tx.message.update({where:{id:message.id},data:{content,normalizedText:content.normalize("NFKC"),metadata:newMetadata}});
              await tx.auditLog.create({data:{action:"EMAIL_HTML_BACKFILL",entityType:"Message",entityId:message.id,after:{channel:"EMAIL",htmlRestored:Boolean(restored.emailHtml),originalContentPreserved:Boolean(restored.emailHtml),version:1}}});
            });
            cursor=legacyEmailBackfillCursor(cursor,message.id);
          }catch(error){retryRequired=true;cursor=legacyEmailBackfillCursor(cursor,message.id,true);this.logger.warn(`EMAIL_HTML_BACKFILL_FAILED message=${message.id} ${error instanceof Error?error.constructor.name:"UnknownError"}`);break}
        }
        await this.prisma.appSetting.upsert({where:{section_key:{section:"integration.email.sync",key:"legacyHtmlBackfillCursor"}},create:{section:"integration.email.sync",key:"legacyHtmlBackfillCursor",value:{messageId:cursor??null}},update:{value:{messageId:cursor??null}}});
        if(retryRequired){this.startupTimers.push(setTimeout(()=>void this.backfillLegacyHtml(),60_000));break}
        if(batch.length<100)break;
      }
      if(scanned>=5_000){this.logger.warn("EMAIL_HTML_BACKFILL_LIMIT_REACHED");this.startupTimers.push(setTimeout(()=>void this.backfillLegacyHtml(),60_000))}
    }finally{this.backfillRunning=false}
  }

  private saveCursor(key:SyncMailbox["cursorKey"],cursor:SyncCursor){return this.prisma.appSetting.upsert({where:{section_key:{section:"integration.email.sync",key}},create:{section:"integration.email.sync",key,value:cursor},update:{value:cursor}})}
  private async recordFailure(account:string,mailbox:string,uidValidity:string,uid:number,rawPath:string|undefined,error:unknown){
    const failure={account,mailbox,uidValidity,uid,rawPath,errorType:error instanceof Error?error.constructor.name:"UnknownError",occurredAt:new Date().toISOString()},scope=createHash("sha256").update(`${account}:${mailbox}:${uidValidity}`).digest("hex").slice(0,24);
    await this.prisma.$transaction([this.prisma.appSetting.upsert({where:{section_key:{section:"integration.email.sync",key:`failure.${scope}.${uid}`}},create:{section:"integration.email.sync",key:`failure.${scope}.${uid}`,value:failure},update:{value:failure}}),this.prisma.auditLog.create({data:{action:"EMAIL_SYNC_FAILED",entityType:"EmailMessage",entityId:String(uid),after:failure}})]);
    this.logger.warn(`EMAIL_MESSAGE_QUARANTINED mailbox=${mailbox==="INBOX"?"INBOX":"SENT"} uid=${uid} ${failure.errorType}`)
  }
  async retryFailure(key:string,actorId:string){
    if(!/^failure\.[a-f0-9]{24}\.\d+$/.test(key))throw new Error("Некорректный ключ ошибки Gmail");
    const [row,settings,cursor]=await Promise.all([this.prisma.appSetting.findUnique({where:{section_key:{section:"integration.email.sync",key}}}),this.transport.settings(),this.prisma.appSetting.findUnique({where:{section_key:{section:"integration.email.sync",key:"inboxCursor"}}})]);
    if(!row||!row.value||typeof row.value!=="object"||Array.isArray(row.value))throw new Error("Ошибка Gmail не найдена");
    const value=row.value as Record<string,unknown>,current=cursor?.value&&typeof cursor.value==="object"&&!Array.isArray(cursor.value)?cursor.value as Record<string,unknown>:{},account=settings.username.trim().toLowerCase(),uid=Number(value.uid),failureUidValidity=String(value.uidValidity||""),rawPath=typeof value.rawPath==="string"?value.rawPath:null;
    if(value.account!==account||value.mailbox!=="INBOX"||value.uidValidity!==current.uidValidity||current.account!==account||current.mailbox!=="INBOX")throw new Error("Ошибка Gmail относится к другому аккаунту или почтовому ящику");
    if(!Number.isInteger(uid)||uid<1||uid>Number(current.uid||0))throw new Error("UID ошибки Gmail не относится к текущему курсору");
    await this.prisma.$transaction(async tx=>{await tx.appSetting.upsert({where:{section_key:{section:"integration.email.sync",key:"retryMarker"}},create:{section:"integration.email.sync",key:"retryMarker",value:{failureKey:key,account,mailbox:"INBOX",uidValidity:failureUidValidity,uid,rawPath}},update:{value:{failureKey:key,account,mailbox:"INBOX",uidValidity:failureUidValidity,uid,rawPath}}});await tx.auditLog.create({data:{actorId,action:"RETRY_REQUESTED",entityType:"EmailMessage",entityId:String(uid),after:{channel:"EMAIL",quarantineKey:key}}})});
    return{queued:true,uid}
  }
  private async applyRetryMarker(account:string,uidValidity:string,current:Record<string,unknown>){
    const applied=await this.prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"email-sync:INBOX"},0))`;const marker=await tx.appSetting.findUnique({where:{section_key:{section:"integration.email.sync",key:"retryMarker"}}});if(!marker?.value||typeof marker.value!=="object"||Array.isArray(marker.value))return null;const value=marker.value as Record<string,unknown>,uid=Number(value.uid),retryUid=emailRetryCursor(current,value,account,uidValidity);if(retryUid===null)return null;const next={account,mailbox:"INBOX",uidValidity,uid:retryUid};await tx.appSetting.upsert({where:{section_key:{section:"integration.email.sync",key:"inboxCursor"}},create:{section:"integration.email.sync",key:"inboxCursor",value:next},update:{value:next}});if(typeof value.failureKey==="string")await tx.appSetting.deleteMany({where:{section:"integration.email.sync",key:value.failureKey}});await tx.appSetting.delete({where:{section_key:{section:"integration.email.sync",key:"retryMarker"}}});await tx.auditLog.create({data:{action:"RETRY_QUEUED",entityType:"EmailMessage",entityId:String(uid),after:{channel:"EMAIL",uid}}});return{uid:next.uid,rawPath:typeof value.rawPath==="string"?value.rawPath:undefined}});
    if(applied?.rawPath)await unlink(join(uploadsRoot(),"communication-files",applied.rawPath)).catch(()=>undefined);
    return applied?.uid??emailCursorUid(current,account,uidValidity,"INBOX")
  }
  private async storedAttachments(parsed:ParsedMail,directory:string,written:string[],sentImagesOnly=false){
    const attachments:StoredAttachment[]=[];
    for(const attachment of emailStandaloneAttachments(parsed.attachments)){const extension=emailExtensions[attachment.contentType];if(!extension||attachment.size>5*1024*1024||sentImagesOnly&&!emailSentImageAllowed(attachment.contentType,attachment.content))continue;const name=`${randomUUID()}.${extension}`;await writeFile(join(directory,name),attachment.content,{flag:"wx"});written.push(name);attachments.push({name:attachment.filename||"attachment",mimeType:attachment.contentType,sizeBytes:attachment.size,url:`/api/communications/files/${name}`})}
    return attachments
  }
  private messageTime(parsed:ParsedMail,internalDate?:Date|string){return parsed.date?new Date(parsed.date):internalDate?new Date(internalDate):new Date()}
  private recipients(parsed:ParsedMail){const values=Array.isArray(parsed.to)?parsed.to.flatMap(item=>item.value):parsed.to?.value||[];return values.map(item=>item.address?.trim().toLowerCase()).filter((address):address is string=>Boolean(address))}
  private references(parsed:ParsedMail){return Array.isArray(parsed.references)?parsed.references:parsed.references?[parsed.references]:[]}
  private async persistParsed(mailbox:SyncMailbox,settings:EmailConnection,parsed:ParsedMail,uidValidity:string,uid:number,internalDate:Date|string|undefined,rawPath:string,sourceSize:number,directory:string,written:string[]){
    const own=settings.fromAddress.trim().toLowerCase(),externalMessageId=parsed.messageId||`imap:${createHash("sha256").update(mailbox.path).digest("hex").slice(0,12)}:${uidValidity}:${uid}`,occurredAt=this.messageTime(parsed,internalDate),emailHtml=emailSafeHtml(parsed.html),visibleText=emailPlainTextFromHtml(parsed.html),content=emailDisplayContent(emailLatestContent((visibleText||parsed.text||parsed.subject||"[Письмо]").toString())),subject=parsed.subject||"Без темы";
    if(mailbox.direction==="INBOUND"){
      const from=parsed.from?.value[0],email=from?.address?.trim().toLowerCase();
      if(!email||email===own)return false;
      const attachments=await this.storedAttachments(parsed,directory,written);
      return this.communications.receiveEmailMessage({externalMessageId,externalSenderId:email,email,displayName:from?.name||email,content,emailHtml,receivedAt:occurredAt,subject,inReplyTo:parsed.inReplyTo,messageId:parsed.messageId,references:this.references(parsed),rawPath,attachments},{mailbox:mailbox.path,uid,uidValidity,rawPath,sizeBytes:sourceSize})
    }
    const recipients=[...new Set(this.recipients(parsed).filter(address=>address!==own))];
    if(recipients.length!==1){await this.prisma.auditLog.create({data:{action:"EMAIL_SENT_SKIPPED",entityType:"EmailMessage",entityId:createHash("sha256").update(externalMessageId).digest("hex").slice(0,24),after:{channel:"EMAIL",reason:recipients.length?"AMBIGUOUS_RECIPIENTS":"RECIPIENT_MISSING",recipientCount:recipients.length}}});return false}
    const attachments=await this.storedAttachments(parsed,directory,written,true),attachmentFiles=attachments.map(item=>item.url.split("/").pop()).filter((name):name is string=>Boolean(name));
    const outcome=await this.communications.receiveSentEmailMessage({sourceAccountIdentity:shipmentEmailAccountIdentity(settings)||undefined,externalMessageId,recipient:recipients[0]!,content,emailHtml,sentAt:occurredAt,subject,inReplyTo:parsed.inReplyTo,messageId:parsed.messageId,references:this.references(parsed),rawPath,attachments},{mailbox:mailbox.path,uid,uidValidity,rawPath,sizeBytes:sourceSize});
    if(outcome.accepted&&!outcome.retainAttachments)for(const name of attachmentFiles){await unlink(join(directory,name)).catch(()=>undefined);const index=written.indexOf(name);if(index>=0)written.splice(index,1)}
    if(outcome.accepted&&!outcome.retainRaw){await unlink(join(directory,rawPath)).catch(()=>undefined);const index=written.indexOf(rawPath);if(index>=0)written.splice(index,1)}
    return outcome.accepted
  }
  private async syncMailbox(client:ImapFlow,settings:EmailConnection,mailbox:SyncMailbox){
    const lock=await client.getMailboxLock(mailbox.path);
    try{
      const uidValidity=String(client.mailbox&&client.mailbox.uidValidity||"0"),account=settings.username.trim().toLowerCase(),saved=await this.prisma.appSetting.findUnique({where:{section_key:{section:"integration.email.sync",key:mailbox.cursorKey}}}),value=saved?.value&&typeof saved.value==="object"&&!Array.isArray(saved.value)?saved.value as Record<string,unknown>:{};
      let last=mailbox.direction==="INBOUND"?await this.applyRetryMarker(account,uidValidity,value):emailCursorUid(value,account,uidValidity,mailbox.path);
      const recent=last?[]:await client.search({since:new Date(Date.now()-7*86400000)},{uid:true}),range=emailUidRange(last,Number(client.mailbox&&client.mailbox.uidNext||0),Array.isArray(recent)?recent:[]);
      for await(const item of range.length?client.fetch(range,{uid:true,source:true,envelope:true,internalDate:true},{uid:true}):[]){
        if(!item.source){await this.recordFailure(account,mailbox.path,uidValidity,item.uid,undefined,new Error("IMAP_SOURCE_MISSING"));last=Math.max(last,item.uid);await this.saveCursor(mailbox.cursorKey,{account,mailbox:mailbox.path,uidValidity,uid:last});continue}
        const directory=join(uploadsRoot(),"communication-files");await mkdir(directory,{recursive:true});const rawPath=`${randomUUID()}.eml`;await writeFile(join(directory,rawPath),item.source,{flag:"wx"});
        let parsed:ParsedMail;try{parsed=await simpleParser(item.source)}catch(error){const quarantinedPath=mailbox.direction==="INBOUND"?rawPath:undefined;await this.recordFailure(account,mailbox.path,uidValidity,item.uid,quarantinedPath,error);if(!quarantinedPath)await unlink(join(directory,rawPath)).catch(()=>undefined);last=Math.max(last,item.uid);await this.saveCursor(mailbox.cursorKey,{account,mailbox:mailbox.path,uidValidity,uid:last});continue}
        const written=[rawPath];
        try{const persisted=await this.persistParsed(mailbox,settings,parsed,uidValidity,item.uid,item.internalDate,rawPath,item.source.length,directory,written);if(!persisted)for(const name of written)await unlink(join(directory,name)).catch(()=>undefined)}catch(error){for(const name of written)await unlink(join(directory,name)).catch(()=>undefined);throw error}
        last=Math.max(last,item.uid);await this.saveCursor(mailbox.cursorKey,{account,mailbox:mailbox.path,uidValidity,uid:last});
      }
    }finally{lock.release()}
  }
  async tick(){if(recoveryIsolationEnabled())return;
    if(this.running)return;this.running=true;let client:ImapFlow|undefined;
    try{
      await this.communications.retryEmailSentCleanup();
      const settings=await this.transport.settings();if(!settings.enabled||!settings.password)return;this.transport.requireReady(settings);
      client=new ImapFlow({host:settings.imapHost,port:settings.imapPort,secure:true,auth:{user:settings.username,pass:settings.password},logger:false});await client.connect();
      await this.syncMailbox(client,settings,{path:"INBOX",cursorKey:"inboxCursor",direction:"INBOUND"});
      const sent=(await client.list()).find(item=>item.specialUse==="\\Sent");
      if(sent?.path)await this.syncMailbox(client,settings,{path:sent.path,cursorKey:"sentCursor",direction:"OUTBOUND"});
    }catch(error){this.logger.warn(`EMAIL_SYNC_FAILED ${error instanceof Error?error.constructor.name:"Unknown"}`)}finally{if(client)await client.logout().catch(()=>undefined);this.running=false}
  }
}
