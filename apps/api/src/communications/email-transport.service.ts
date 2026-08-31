import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import { createTransport } from "nodemailer";
import { ImapFlow } from "imapflow";
import { PrismaService } from "../prisma.service";
import { decryptSecret } from "../secret-box";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { uploadsRoot } from "../uploads";

export type EmailConnection = { enabled: boolean; smtpHost: string; smtpPort: number; imapHost: string; imapPort: number; username: string; fromAddress: string; password: string };
export class EmailDeliveryUncertainError extends Error { constructor(){super("Результат отправки Gmail неизвестен");this.name="EmailDeliveryUncertainError"} }

@Injectable()
export class EmailTransportService {
  constructor(private readonly prisma: PrismaService) {}
  async settings(): Promise<EmailConnection> {
    const rows=await this.prisma.appSetting.findMany({where:{section:"integration.email"}}),v=Object.fromEntries(rows.map(row=>[row.key,row.value])) as Record<string,unknown>;
    let password=""; const encrypted=typeof v.passwordEncrypted==="string"?v.passwordEncrypted:"";
    if(encrypted){try{password=decryptSecret(encrypted)}catch{password=""}}
    return {enabled:v.enabled===true,smtpHost:String(v.smtpHost||"smtp.gmail.com"),smtpPort:Number(v.smtpPort||465),imapHost:String(v.imapHost||"imap.gmail.com"),imapPort:Number(v.imapPort||993),username:String(v.username||""),fromAddress:String(v.fromAddress||""),password};
  }
  requireReady(v:EmailConnection){
    if(!v.enabled||!v.username||!v.fromAddress||!v.password)throw new BadRequestException("Канал Gmail не подключён");
    if(v.smtpHost!=="smtp.gmail.com"||![465,587].includes(v.smtpPort)||v.imapHost!=="imap.gmail.com"||v.imapPort!==993)throw new BadRequestException("Для защиты пароля разрешены только официальные серверы Gmail");
  }
  async verify(){const v=await this.settings();this.requireReady(v);const smtp=createTransport({host:v.smtpHost,port:v.smtpPort,secure:v.smtpPort===465,auth:{user:v.username,pass:v.password}});await smtp.verify().catch(()=>{throw new BadGatewayException("Gmail отклонил SMTP-подключение. Проверьте пароль приложения")});const imap=new ImapFlow({host:v.imapHost,port:v.imapPort,secure:true,auth:{user:v.username,pass:v.password},logger:false});try{await imap.connect();await imap.mailboxOpen("INBOX");}catch{throw new BadGatewayException("Gmail отклонил IMAP-подключение. Проверьте пароль приложения")}finally{await imap.logout().catch(()=>undefined)}return {verified:true};}
  async send(input:{to:string;subject:string;text:string;inReplyTo?:string;references?:string[];attachment?:{path:string;name:string;mimeType:string}}){const v=await this.settings();this.requireReady(v);const smtp=createTransport({host:v.smtpHost,port:v.smtpPort,secure:v.smtpPort===465,auth:{user:v.username,pass:v.password}});let result;try{result=await smtp.sendMail({from:v.fromAddress,to:input.to,subject:input.subject,text:input.text,inReplyTo:input.inReplyTo,references:input.references,attachments:input.attachment?[{filename:input.attachment.name,content:await readFile(join(uploadsRoot(),"communication-files",input.attachment.path)),contentType:input.attachment.mimeType}]:undefined})}catch(error){const responseCode=Number((error as {responseCode?:unknown})?.responseCode);if(responseCode>=400)throw new BadGatewayException("Gmail отклонил исходящее письмо");throw new EmailDeliveryUncertainError()}if(!result.messageId)throw new EmailDeliveryUncertainError();return {messageId:result.messageId};}
}
