import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactChannel, Prisma, type ShipmentNotification, type User } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { CommunicationsService } from '../communications/communications.service';
import { EmailTransportService } from '../communications/email-transport.service';
import { normalizeClientLanguageCode } from '../communications/ai-language';
import { metaRecipientIdForReceivers } from '../communications/meta-send';
import { shipmentEmailAccountIdentity } from '../communications/shipment-email-account';
import { trackingLink, validTrackingLink, trackingLanguageOptions } from './tracking-link';
import type { ShipmentNotificationPreviewDto, ShipmentNotificationScopeDto, ShipmentNotificationSendDto, ShipmentTrackingUrlDto } from './shipment-notification.dto';

type Db = Prisma.TransactionClient;
const channels = ['FACEBOOK','INSTAGRAM','WHATSAPP','CHATWOOT'];
const emailAddress = (value: string | null | undefined) => value && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()) ? value.trim() : undefined;
const languageLabels: Record<string,string> = {en:'Английский',ru:'Русский',uk:'Украинский',de:'Немецкий',fr:'Французский',es:'Испанский',pl:'Польский',it:'Итальянский',nl:'Нидерландский',pt:'Португальский'};
const defaults: Record<string,string> = {
  en:'Your order has been shipped! 📦\n\nYou can track your package using the link below:\n\n{tracking_url}\n\nThank you for choosing Yoleotard! ❤️',
  ru:'Ваш заказ отправлен! 📦\n\nВы можете отследить посылку по ссылке:\n\n{tracking_url}\n\nСпасибо, что выбираете Yoleotard! ❤️',
  uk:'Ваше замовлення відправлено! 📦\n\nВідстежуйте посилку за посиланням:\n\n{tracking_url}\n\nДякуємо, що обираєте Yoleotard! ❤️',
};
export function trackingSubject(language: string, number:string) {
  return language === 'ru' ? `Ваш заказ Yoleotard ${number} отправлен` : language === 'uk' ? `Ваше замовлення Yoleotard ${number} відправлено` : `Your Yoleotard order ${number} has been shipped`;
}
export function notificationAttemptStatus(attempt: {status:string;messageId?:string|null} | null, startedAt:Date|null, now = Date.now()) {
  if (attempt?.status === 'SENT') return 'SENT';
  if (attempt?.status === 'FAILED') return 'FAILED';
  if (attempt?.status === 'UNCERTAIN') return 'UNKNOWN';
  return startedAt && now - startedAt.getTime() > 120_000 ? 'UNKNOWN' : 'SENDING';
}

@Injectable()
export class ShipmentNotificationService {
  constructor(private readonly p:PrismaService,private readonly communications:CommunicationsService,private readonly email:EmailTransportService) {}
  private authorize(actor:User) { if (!['OWNER','ADMIN','MANAGER'].includes(actor.role)) throw new ForbiddenException('Недостаточно прав для отправки уведомления'); }
  private async context(input:ShipmentNotificationScopeDto, db:Db = this.p) {
    const client = await db.client.findFirst({where:{id:input.clientId,archivedAt:null}});
    if (!client) throw new NotFoundException('Клиент не найден');
    // An unselected/unified channel must not implicitly choose another chat.
    const conversation = input.conversationId ? await db.conversation.findFirst({where:{id:input.conversationId,clientId:client.id,archivedAt:null}}) : input.channel && channels.includes(input.channel) ? await db.conversation.findFirst({where:{clientId:client.id,channel:input.channel as ContactChannel,archivedAt:null}}) : null;
    if (input.conversationId && (!conversation || input.channel && input.channel !== conversation.channel)) throw new ConflictException('Переписка не принадлежит клиенту или канал изменился');
    return {client,conversation};
  }
  private async capabilities(input:ShipmentNotificationScopeDto, db:Db = this.p) {
    const {client,conversation} = await this.context(input,db);
    const settings = await db.appSetting.findMany({where:{section:{in:['integration.meta','integration.chatwoot','integration.email']}},orderBy:[{section:'asc'},{key:'asc'}]});
    const values = (section:string) => Object.fromEntries(settings.filter(s=>s.section === section).map(s=>[s.key,s.value]));
    const meta = values('integration.meta'), cw = values('integration.chatwoot');
    let chatAvailable = false, chatReason = 'Выберите активную переписку для отправки в чат';
    if (conversation && channels.includes(conversation.channel)) {
      if (conversation.channel === 'CHATWOOT') {
        // Chatwoot can relay restricted Meta inboxes; do not assume its provider window.
        chatReason = 'Для Chatwoot требуется подтверждённый канал сайта';
        chatAvailable = cw.enabled === true && !!cw.accessTokenEncrypted && await this.communications.shipmentChatwootAvailable(input.clientId,conversation.id,conversation.externalId,db===this.p);
      } else {
        const prefix = conversation.channel === 'WHATSAPP' ? 'whatsapp' : conversation.channel === 'INSTAGRAM' ? 'instagram' : 'page';
        const receiver = meta[prefix === 'page' ? 'pageId' : `${prefix}${prefix === 'whatsapp' ? 'PhoneNumberId':'AccountId'}`];
        const receiverIds = [receiver, ...(conversation.channel==='INSTAGRAM'?[meta.instagramWebhookReceiverId]:[])].filter((value):value is string=>typeof value==='string');
        const connected = meta.enabled === true && !!meta[`${prefix}AccessTokenEncrypted`] && !!metaRecipientIdForReceivers(receiverIds,conversation.externalId);
        const recent = await db.message.findMany({where:{conversationId:conversation.id,direction:'INBOUND'},orderBy:{receivedAt:'desc'},take:30});
        const inbound = recent.find(message => {
          const metadata = message.metadata as Record<string,unknown>|null;
          const engagement = metadata?.engagement as Record<string,unknown>|undefined;
          return !!message.receivedAt && !['comment','reaction'].includes(String(engagement?.kind||'')) && message.messageType!=='social_mention';
        });
        // receivedAt is the provider timestamp; createdAt can be today's backfill.
        const age = inbound?.receivedAt ? Date.now() - inbound.receivedAt.getTime() : Infinity;
        chatAvailable = connected && age >= 0 && age < 24*60*60*1000;
        chatReason = !connected ? 'Канал не подключён' : 'Окно ответа закрыто: нужен одобренный шаблон провайдера. Можно отправить email';
      }
    }
    const mail = await this.email.settings();
    const emailAvailable = mail.enabled && !!mail.smtpHost && !!mail.username && !!mail.password && !!emailAddress(mail.fromAddress);
    return {client,conversation,chatAvailable,chatReason:chatAvailable?undefined:chatReason,emailAvailable,emailAccountIdentity:shipmentEmailAccountIdentity(mail),emailReason:emailAvailable?undefined:'Email-канал не настроен',settingsVersion:settings.map(s=>[s.section,s.key,s.updatedAt.toISOString()])};
  }
  private async templates(db:Db=this.p) {
    return db.messageTemplate.findMany({where:{archivedAt:null,name:'Уведомление об отправке'},orderBy:[{updatedAt:'desc'},{id:'asc'}]});
  }
  async options(input:ShipmentNotificationScopeDto,actor:User) {
    this.authorize(actor);
    const cap = await this.capabilities(input);
    const [orders,templates] = await Promise.all([
      this.p.order.findMany({where:{clientId:input.clientId,archivedAt:null},select:{id:true,number:true,orderShipments:{where:{archivedAt:null,trackingNumber:{not:null}},orderBy:{createdAt:'asc'}}},orderBy:{createdAt:'desc'}}),this.templates(),
    ]);
    return {orders:orders.map(o=>({id:o.id,number:o.number,shipments:o.orderShipments.flatMap(s=>{const url=trackingLink(s);return url?[{id:s.id,carrier:s.carrier,trackingNumber:s.trackingNumber,trackingUrl:url,trackingRevision:s.trackingRevision}]:[];})})).filter(o=>o.shipments.length),chat:{available:cap.chatAvailable,reason:cap.chatReason},email:{available:cap.emailAvailable,recipient:emailAddress(cap.client.email),requiresConfirmation:true,reason:cap.emailReason},languages:[...new Set([...Object.keys(defaults),...templates.map(t=>t.language)])].map(value=>({value,label:languageLabels[value]||value}))};
  }
  private async projection(input:ShipmentNotificationPreviewDto,db:Db=this.p) {
    const cap = await this.capabilities(input,db);
    const shipment = await db.orderShipment.findFirst({where:{id:input.shipmentId,orderId:input.orderId,archivedAt:null,order:{clientId:input.clientId,archivedAt:null}},include:{order:{select:{number:true,deliveryEmail:true}}}});
    const url=shipment && trackingLink(shipment);
    if (!shipment || !url || !shipment.trackingNumber) throw new BadRequestException('Выберите активную посылку с проверенной ссылкой отслеживания');
    const templates=await this.templates(db), requested=normalizeClientLanguageCode(input.language)||normalizeClientLanguageCode(cap.client.language)||'en';
    const template = templates.find(t=>t.language===requested && (!t.channel||t.channel===cap.conversation?.channel)) || (!defaults[requested] ? templates.find(t=>t.language==='en' && !t.channel) : undefined);
    const language=template?.language || (defaults[requested]?requested:'en');
    const substitutions:Record<string,string>={tracking_url:url,tracking_number:shipment.trackingNumber,order_number:shipment.order.number,carrier:shipment.carrier};
    const content=(template?.content||defaults[language]||defaults.en!).replace(/\{\{?(tracking_url|tracking_number|order_number|carrier)\}?\}/g,(_,k:string)=>substitutions[k]!);
    const recipient=emailAddress(shipment.order.deliveryEmail)||emailAddress(cap.client.email);
    const emailRequiresConfirmation=!emailAddress(shipment.order.deliveryEmail) && !!recipient;
    const scopeToken=createHash('sha256').update(JSON.stringify({clientId:input.clientId,orderId:input.orderId,shipmentId:shipment.id,revision:shipment.trackingRevision,url,recipient,emailRequiresConfirmation,language,emailAccountIdentity:cap.emailAccountIdentity,conversation:cap.conversation&&[cap.conversation.id,cap.conversation.externalId,cap.conversation.channel],settings:cap.settingsVersion,template:template&&[template.id,template.updatedAt.toISOString()]})).digest('hex');
    return {...cap,shipment,scopeToken,language,content,subject:trackingSubject(language,shipment.order.number),emailRecipient:recipient,emailRequiresConfirmation};
  }
  async preview(input:ShipmentNotificationPreviewDto,actor:User) {
    this.authorize(actor);
    const p=await this.projection(input);
    const previous=await this.p.shipmentNotification.findUnique({where:{shipmentId_trackingRevision:{shipmentId:p.shipment.id,trackingRevision:p.shipment.trackingRevision}},include:{deliveries:true}});
    if (previous) await this.refresh(previous.id,actor);
    return {scopeToken:p.scopeToken,orderId:input.orderId,orderNumber:p.shipment.order.number,shipmentId:p.shipment.id,carrier:p.shipment.carrier,trackingNumber:p.shipment.trackingNumber,trackingUrl:trackingLink(p.shipment),trackingRevision:p.shipment.trackingRevision,language:previous?.language||p.language,content:previous?.content||p.content,subject:previous?.subject||p.subject,emailRecipient:p.emailRecipient,emailRequiresConfirmation:p.emailRequiresConfirmation,chatAvailable:p.chatAvailable,emailAvailable:p.emailAvailable&&!!p.emailRecipient,chatReason:p.chatReason,emailReason:p.emailRecipient?p.emailReason:'Email получателя не указан. Можно отправить только в чат',previous:previous?await this.p.shipmentNotification.findUnique({where:{id:previous.id},include:{deliveries:true}}):undefined};
  }
  private async history(db:Db, input:ShipmentNotification,actor:User,type:string,metadata:Prisma.InputJsonObject) {
    const snapshot = {notificationId:input.id,orderId:input.orderId,shipmentId:input.shipmentId,conversationId:input.conversationId,carrier:input.carrier,trackingNumber:input.trackingNumber,trackingUrl:input.trackingUrl,content:input.content,subject:input.subject,language:input.language,...metadata};
    await db.activity.create({data:{orderId:input.orderId,clientId:input.clientId,actorId:actor.id,type,summary:'Уведомление об отправке посылки',metadata:snapshot}});
    await db.auditLog.create({data:{actorId:actor.id,action:type,entityType:'ShipmentNotification',entityId:input.id,after:snapshot}});
  }
  async send(input:ShipmentNotificationSendDto,actor:User) {
    this.authorize(actor);
    if (!input.sendChat && !input.sendEmail) throw new BadRequestException('Выберите канал отправки');
    if (!input.content.trim() || !input.subject.trim() || /[\r\n]/.test(input.subject)) throw new BadRequestException('Проверьте текст уведомления и тему письма');
    const projected=await this.projection(input);
    if (input.scopeToken!==projected.scopeToken) throw new ConflictException('Данные изменились. Откройте предпросмотр заново');
    if (!input.content.includes(trackingLink(projected.shipment)!)) throw new BadRequestException('В тексте должна остаться полная ссылка выбранной посылки');
    const prior=await this.p.shipmentNotification.findUnique({where:{shipmentId_trackingRevision:{shipmentId:input.shipmentId,trackingRevision:projected.shipment.trackingRevision}}});
    if (prior) await this.refresh(prior.id,actor);
    const id = await this.p.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'shipment-notification:'+input.shipmentId},0))`;
      await tx.$queryRaw`SELECT "id" FROM "OrderShipment" WHERE "id"=${input.shipmentId} FOR UPDATE`;
      const p=await this.projection(input,tx);
      if (p.scopeToken!==input.scopeToken) throw new ConflictException('Данные посылки или получателя изменились');
      let notification=await tx.shipmentNotification.findUnique({where:{shipmentId_trackingRevision:{shipmentId:input.shipmentId,trackingRevision:p.shipment.trackingRevision}},include:{deliveries:true}});
      if (notification && (notification.content!==input.content || notification.subject!==input.subject || notification.language!==p.language || notification.conversationId!==(p.conversation?.id||null) || notification.conversationExternalId!==(p.conversation?.externalId||null))) throw new ConflictException('Уведомление уже подтверждено. Используйте сохранённый текст и исходную переписку');
      if (!notification) notification=await tx.shipmentNotification.create({data:{shipmentId:input.shipmentId,orderId:input.orderId,clientId:input.clientId,conversationId:p.conversation?.id,conversationExternalId:p.conversation?.externalId,conversationChannel:p.conversation?.channel,trackingRevision:p.shipment.trackingRevision,trackingNumber:p.shipment.trackingNumber!,trackingUrl:trackingLink(p.shipment)!,carrier:p.shipment.carrier,language:p.language,content:input.content,subject:input.subject,actorId:actor.id},include:{deliveries:true}});
      for (const channel of ['CHAT','EMAIL'] as const) {
        if (!(channel==='CHAT'?input.sendChat:input.sendEmail)) continue;
        const existing=notification.deliveries.find(d=>d.channel===channel);
        if (existing && existing.status!=='FAILED') continue;
        if (existing) {
          let original = await tx.messageDeliveryAttempt.findUnique({where:{clientRequestId:existing.clientRequestId},include:{message:{select:{sentAt:true}}}});
          if (original) {
            // Use the same lock as Sent/echo reconciliation. A late success must
            // win over a manual FAILED resolution before a retry UUID is issued.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'message-send:'+original.conversationId},0))`;
            original = await tx.messageDeliveryAttempt.findUnique({where:{clientRequestId:existing.clientRequestId},include:{message:{select:{sentAt:true}}}});
            if (original && original.status!=='FAILED') {
              const status=notificationAttemptStatus(original,existing.startedAt);
              await tx.shipmentNotificationDelivery.update({where:{id:existing.id},data:{status,messageId:original.messageId,sentAt:status==='SENT'?(original.message?.sentAt||new Date()):null,error:status==='SENT'?null:'Исходная попытка ожидает подтверждения'}});
              await this.history(tx,notification,actor,'SHIPMENT_NOTIFICATION_RESULT',{channel,status,clientRequestId:existing.clientRequestId,messageId:original.messageId});
              continue;
            }
          }
        }
        if (channel==='CHAT' && !p.chatAvailable || channel==='EMAIL' && (!p.emailAvailable||!p.emailRecipient)) throw new BadRequestException(channel==='CHAT'?p.chatReason:p.emailReason||'Email получателя не указан');
        if (channel==='EMAIL' && p.emailRequiresConfirmation && !input.confirmClientEmail) throw new BadRequestException('Подтвердите использование email из профиля клиента');
        const recipient=channel==='EMAIL'?p.emailRecipient!:p.conversation!.externalId!;
        if (existing && existing.recipient!==recipient) throw new ConflictException('Получатель изменился. Повтор старого уведомления заблокирован');
        // Each explicit email confirmation freezes its mailbox before dispatch;
        // later adapter reads may not silently switch the sender account.
        if (channel==='EMAIL') notification=await tx.shipmentNotification.update({where:{id:notification.id},data:{emailAccountIdentity:p.emailAccountIdentity},include:{deliveries:true}});
        const clientRequestId=randomUUID();
        const previousClientRequestId=existing?.clientRequestId||null;
        if (existing) await tx.shipmentNotificationDelivery.update({where:{id:existing.id},data:{clientRequestId,status:'PENDING',error:null,startedAt:null,messageId:null}});
        else await tx.shipmentNotificationDelivery.create({data:{notificationId:notification.id,channel,recipient,clientRequestId}});
        await this.history(tx,notification,actor,existing?'SHIPMENT_NOTIFICATION_RETRY':'SHIPMENT_NOTIFICATION_CONFIRMED',{channel,recipient,clientRequestId,previousClientRequestId,emailAccountIdentity:channel==='EMAIL'?p.emailAccountIdentity:null,content:notification.content,subject:notification.subject,language:notification.language,trackingNumber:notification.trackingNumber,trackingUrl:notification.trackingUrl});
      }
      return notification.id;
    });
    const selectedChannels = [...(input.sendChat?['CHAT']:[]),...(input.sendEmail?['EMAIL']:[])];
    const deliveries=await this.p.shipmentNotificationDelivery.findMany({where:{notificationId:id,status:'PENDING',channel:{in:selectedChannels}}});
    await Promise.allSettled(deliveries.map(d=>this.dispatch(d.id,actor)));
    return this.status(id,actor);
  }
  private async dispatch(id:string,actor:User) {
    const claimed=await this.p.shipmentNotificationDelivery.updateMany({where:{id,status:'PENDING'},data:{status:'SENDING',startedAt:new Date()}});
    if (!claimed.count) return;
    const delivery=await this.p.shipmentNotificationDelivery.findUniqueOrThrow({where:{id},include:{notification:true}}),n=delivery.notification;
    let enteredProvider=false;
    try {
      const current=await this.projection({clientId:n.clientId,conversationId:n.conversationId||undefined,channel:n.conversationChannel||undefined,orderId:n.orderId,shipmentId:n.shipmentId,language:n.language});
      if (current.shipment.trackingRevision!==n.trackingRevision || (current.conversation?.externalId||null)!==n.conversationExternalId && n.conversationId || (delivery.channel==='EMAIL' && current.emailRecipient!==delivery.recipient)) throw new ConflictException('Данные отправки изменились; требуется проверка');
      if (delivery.channel==='CHAT' && !current.chatAvailable || delivery.channel==='EMAIL'&&!current.emailAvailable) throw new BadRequestException('Канал отправки сейчас недоступен');
      enteredProvider=true;
      if (delivery.channel==='EMAIL') {
        const result = await this.communications.sendShipmentEmail(n.clientId,{recipient:delivery.recipient,subject:n.subject,content:n.content,clientRequestId:delivery.clientRequestId,orderId:n.orderId,shipmentId:n.shipmentId,notificationId:n.id,accountIdentity:n.emailAccountIdentity||undefined},actor);
        // A different email already owns the conversation lock. The adapter has
        // not reserved this UUID and has not entered SMTP, so a manual retry is safe.
        if (result.status==='PENDING' && !result.attemptId) throw new ConflictException('Другая отправка ещё выполняется');
      }
      else await this.communications.sendShipmentChat(n.clientId,{conversationId:n.conversationId!,externalId:n.conversationExternalId,channel:n.conversationChannel as ContactChannel,content:n.content,clientRequestId:delivery.clientRequestId},actor);
      await this.refresh(n.id,actor);
    } catch (error) {
      // Once handed to a provider, only its persisted authoritative attempt can
      // establish definitive failure; network exceptions never permit a retry.
      const attempt=await this.p.messageDeliveryAttempt.findUnique({where:{clientRequestId:delivery.clientRequestId},include:{message:{select:{sentAt:true}}}});
      const rejectedBeforeReservation = !attempt && (error instanceof BadRequestException || error instanceof ConflictException);
      const status=enteredProvider&&!rejectedBeforeReservation?notificationAttemptStatus(attempt,new Date(0)):'FAILED';
      await this.p.$transaction(async tx=>{
        const changed = await tx.shipmentNotificationDelivery.updateMany({where:{id,clientRequestId:delivery.clientRequestId,status:'SENDING'},data:{status,messageId:attempt?.messageId,sentAt:status==='SENT'?(attempt?.message?.sentAt||new Date()):null,error:status==='SENT'?null:status==='UNKNOWN'?'Результат неизвестен. Повтор заблокирован до сверки':'Отправка не выполнена. Проверьте канал и данные'}});
        if (changed.count) await this.history(tx,n,actor,'SHIPMENT_NOTIFICATION_RESULT',{channel:delivery.channel,status,clientRequestId:delivery.clientRequestId});
      });
    }
  }
  private async refresh(id:string,actor:User) {
    const n=await this.p.shipmentNotification.findUniqueOrThrow({where:{id},include:{deliveries:true}});
    for (const d of n.deliveries) {
      if (d.status==='SENT'||d.status==='PENDING') continue;
      const attempt=await this.p.messageDeliveryAttempt.findUnique({where:{clientRequestId:d.clientRequestId},include:{message:{select:{sentAt:true}}}});
      if (d.status==='FAILED' && !attempt) continue; // Definitive rejection before a reservation/side effect.
      const status=notificationAttemptStatus(attempt,d.startedAt);
      if (d.status==='UNKNOWN' && status!=='SENT' && status!=='FAILED') continue;
      if (status===d.status) continue;
      await this.p.$transaction(async tx=>{
        const changed=await tx.shipmentNotificationDelivery.updateMany({where:{id:d.id,clientRequestId:d.clientRequestId,status:d.status},data:{status,messageId:attempt?.messageId,sentAt:status==='SENT'?(attempt?.message?.sentAt||new Date()):null,error:status==='SENT'?null:status==='UNKNOWN'?'Результат неизвестен. Проверьте отправленные сообщения':'Канал не принял уведомление'}});
        if(changed.count) await this.history(tx,n,actor,'SHIPMENT_NOTIFICATION_RESULT',{channel:d.channel,status,messageId:attempt?.messageId});
      });
    }
  }
  async status(id:string,actor:User) {
    this.authorize(actor);
    const row=await this.p.shipmentNotification.findUnique({where:{id}});
    if(!row) throw new NotFoundException('Уведомление не найдено');
    await this.refresh(id,actor);
    return this.p.shipmentNotification.findUnique({where:{id},include:{deliveries:true}});
  }
  async trackingOptions(orderId:string,shipmentId:string) {
    if(typeof orderId !== 'string' || !orderId.trim() || orderId.length>100 || typeof shipmentId !== 'string' || !shipmentId.trim() || shipmentId.length>100) throw new BadRequestException('Укажите заказ и посылку');
    const shipment=await this.p.orderShipment.findFirst({where:{id:shipmentId,orderId,archivedAt:null,order:{archivedAt:null}}});
    if(!shipment) throw new NotFoundException('Посылка не найдена');
    const options=trackingLanguageOptions(shipment);
    const url=trackingLink(shipment) || options[0]?.url;
    return {options,url,trackingRevision:shipment.trackingRevision,language:options.find(option=>option.url===url)?.language ?? (url?.includes('/en-ua/')?'en':'uk')};
  }
  async clearTracking(input:ShipmentTrackingUrlDto,actor:User) {
    if(!['OWNER','ADMIN'].includes(actor.role)) throw new ForbiddenException('Трек-номер удаляет администратор');
    return this.p.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.orderId}))`;
      const shipment=await tx.orderShipment.findFirst({where:{id:input.shipmentId,orderId:input.orderId,archivedAt:null,order:{archivedAt:null}}});
      if(!shipment||shipment.trackingRevision!==input.trackingRevision) throw new ConflictException('Данные посылки изменились');
      if(!shipment.trackingNumber&&!shipment.trackingUrl) return shipment;
      const changed=await tx.orderShipment.updateMany({where:{id:shipment.id,trackingRevision:input.trackingRevision},data:{trackingNumber:null,trackingUrl:null,updatedAt:new Date()}});
      if(!changed.count) throw new ConflictException('Данные посылки изменились');
      if(shipment.isPrimary && shipment.trackingNumber){
        await tx.shipment.updateMany({where:{orderId:input.orderId,trackingNumber:shipment.trackingNumber},data:{trackingNumber:null}});
        await tx.order.updateMany({where:{id:input.orderId,deliveryTrackingCode:shipment.trackingNumber},data:{deliveryTrackingCode:null}});
      }
      const order=await tx.order.findUniqueOrThrow({where:{id:input.orderId},select:{clientId:true}});
      await tx.activity.create({data:{clientId:order.clientId,orderId:input.orderId,actorId:actor.id,type:'SHIPMENT_TRACKING_CLEARED',summary:'Удалён трек-номер посылки',metadata:{shipmentId:shipment.id,trackingNumber:shipment.trackingNumber}}});
      await tx.auditLog.create({data:{actorId:actor.id,action:'TRACKING_CLEARED',entityType:'OrderShipment',entityId:shipment.id,before:{trackingNumber:shipment.trackingNumber,trackingUrl:shipment.trackingUrl},after:{trackingNumber:null,trackingUrl:null}}});
      return tx.orderShipment.findUniqueOrThrow({where:{id:shipment.id}});
    });
  }
  async saveTrackingUrl(input:ShipmentTrackingUrlDto,actor:User) {
    if (!['OWNER','ADMIN'].includes(actor.role)) throw new ForbiddenException('Ссылку подтверждает администратор');
    return this.p.$transaction(async tx=>{
      const shipment=await tx.orderShipment.findFirst({where:{id:input.shipmentId,orderId:input.orderId,archivedAt:null,order:{archivedAt:null}}});
      if (!shipment||shipment.trackingRevision!==input.trackingRevision) throw new ConflictException('Данные посылки изменились');
      if(input.language !== undefined){
        const option=trackingLanguageOptions(shipment).find(option=>option.language===input.language);
        if(!option || input.trackingUrl !== undefined) throw new BadRequestException('Выберите доступный язык ссылки');
        input={...input,trackingUrl:option.url};
      } else if(input.trackingUrl === undefined) throw new BadRequestException('Выберите язык ссылки');
      if (input.trackingUrl && !validTrackingLink(shipment.carrier,shipment.trackingNumber?.trim()||'',input.trackingUrl)) throw new BadRequestException('Нужна HTTPS-ссылка официального перевозчика с трек-номером этой посылки');
      const changed=await tx.orderShipment.updateMany({where:{id:shipment.id,trackingRevision:input.trackingRevision},data:{trackingUrl:input.trackingUrl||null}});
      if(!changed.count) throw new ConflictException('Данные посылки изменились');
      await tx.auditLog.create({data:{actorId:actor.id,action:'TRACKING_URL_VERIFIED',entityType:'OrderShipment',entityId:shipment.id,before:{trackingUrl:shipment.trackingUrl},after:{trackingUrl:input.trackingUrl||null}}});
      return tx.orderShipment.findUniqueOrThrow({where:{id:shipment.id}});
    });
  }
}
