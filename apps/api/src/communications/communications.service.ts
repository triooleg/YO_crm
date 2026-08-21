import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ContactChannel,
  MessageDirection,
  MessageStatus,
  Prisma,
  type User,
} from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { decryptSecret, encryptSecret } from "../secret-box";
import {
  ALLOWED_AI_MODELS,
  AiRequestDto,
  AiSettingsDto,
  ChatwootIntegrationDto,
  EmailIntegrationDto,
  MessageTemplateDto,
  MetaIntegrationDto,
  SendMessageDto,
} from "./communications.dto";
import { normalizeMetaWebhook, safeTokenEqual, verifyMetaSignature, type MetaInboundMessage } from "./meta-webhook";
import { normalizeChatwootWebhook, verifyChatwootSignature, type ChatwootInboundMessage } from "./chatwoot-webhook";
import { chatwootScopeMatches, uniqueCandidate } from "./inbound-routing";
import { createHmac, randomBytes } from "node:crypto";
import { signMetaOauthState, verifyMetaOauthState } from "./meta-oauth";
import { confirmMetaPageSubscription, isMetaAccessToken, metaDeliveryStatus } from "./meta-delivery";
const AI_RATE_LIMIT_PER_HOUR = 20,
  AI_CONCURRENCY_LIMIT = 2,
  AI_LEASE_MS = 30_000;
class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, 429);
  }
}
@Injectable()
export class CommunicationsService {
  constructor(private p: PrismaService) {}
  list() {
    return this.p.client.findMany({
      where: { archivedAt: null },
      orderBy: [{ lastContactAt: "desc" }, { displayName: "asc" }],
      include: {
        orders: {
          where: { archivedAt: null },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { payments: true },
        },
        conversations: {
          where: { archivedAt: null },
          orderBy: { lastMessageAt: "desc" },
          include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
      },
      take: 100,
    });
  }
  templates() {
    return this.p.messageTemplate.findMany({
      where: { archivedAt: null },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    });
  }
  private templateData(d: MessageTemplateDto) {
    const name = d.name.trim(),
      content = d.content.trim();
    if (!name || !content)
      throw new BadRequestException("Название и текст шаблона обязательны");
    return {
      name,
      content,
      channel: d.channel,
      language: d.language?.trim() || "ru",
    };
  }
  createTemplate(d: MessageTemplateDto, u: User) {
    const data = this.templateData(d);
    return this.p.$transaction(async (tx) => {
      const template = await tx.messageTemplate.create({ data });
      await tx.auditLog.create({
        data: {
          actorId: u.id,
          action: "CREATE",
          entityType: "MessageTemplate",
          entityId: template.id,
          after: template,
        },
      });
      return template;
    });
  }
  async updateTemplate(id: string, d: MessageTemplateDto, u: User) {
    const data = this.templateData(d);
    return this.p.$transaction(async (tx) => {
      const before = await tx.messageTemplate.findFirst({
        where: { id, archivedAt: null },
      });
      if (!before) throw new NotFoundException("Шаблон не найден");
      const template = await tx.messageTemplate.update({
        where: { id },
        data: { ...data, channel: data.channel ?? null },
      });
      await tx.auditLog.create({
        data: {
          actorId: u.id,
          action: "UPDATE",
          entityType: "MessageTemplate",
          entityId: id,
          before,
          after: template,
        },
      });
      return template;
    });
  }
  async archiveTemplate(id: string, u: User) {
    return this.p.$transaction(async (tx) => {
      const before = await tx.messageTemplate.findFirst({
        where: { id, archivedAt: null },
      });
      if (!before) throw new NotFoundException("Шаблон не найден");
      const template = await tx.messageTemplate.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: u.id,
          action: "ARCHIVE",
          entityType: "MessageTemplate",
          entityId: id,
          before,
          after: template,
        },
      });
      return { archived: true, id: template.id };
    });
  }
  private integrationStatus(
    channel: "chatwoot" | "email",
    v: Record<string, unknown>,
  ) {
    if (channel === "chatwoot") {
      const ready = Boolean(
        v.enabled && v.accountId && v.inboxId && this.secretValue(v, "webhookSecretEncrypted"),
      );
      return {
        channel,
        enabled: v.enabled === true,
        status: ready ? "CONFIGURED" : "NOT_CONNECTED",
        baseUrl: typeof v.baseUrl === "string" ? v.baseUrl : "",
        accountId: typeof v.accountId === "string" ? v.accountId : "",
        inboxId: typeof v.inboxId === "string" ? v.inboxId : "",
        accessTokenConfigured: Boolean(this.secretValue(v, "accessTokenEncrypted")),
        webhookSecretConfigured: Boolean(this.secretValue(v, "webhookSecretEncrypted")),
        webhookUrl: this.publicOrigin() + "/api/communications/chatwoot/webhook",
      };
    }
    const ready = Boolean(
      v.enabled &&
        v.smtpHost &&
        v.smtpPort &&
        v.username &&
        this.secretValue(v, "passwordEncrypted") &&
        v.fromAddress,
    );
    return {
      channel,
      enabled: v.enabled === true,
      status: ready ? "CONFIGURED" : "NOT_CONNECTED",
      smtpHost: typeof v.smtpHost === "string" ? v.smtpHost : "",
      smtpPort: typeof v.smtpPort === "number" ? v.smtpPort : 587,
      username: typeof v.username === "string" ? v.username : "",
      fromAddress: typeof v.fromAddress === "string" ? v.fromAddress : "",
      passwordConfigured: Boolean(this.secretValue(v, "passwordEncrypted")),
    };
  }
  async integrations() {
    const rows = await this.p.appSetting.findMany({
      where: { section: { in: ["integration.chatwoot", "integration.email"] } },
    });
    const value = (section: string) =>
      Object.fromEntries(
        rows.filter((x) => x.section === section).map((x) => [x.key, x.value]),
      ) as Record<string, unknown>;
    return {
      meta: await this.metaSettings(),
      chatwoot: this.integrationStatus(
        "chatwoot",
        value("integration.chatwoot"),
      ),
      email: this.integrationStatus("email", value("integration.email")),
      deliveryAvailable: false,
    };
  }
  async saveIntegration(
    channel: string,
    d: ChatwootIntegrationDto | EmailIntegrationDto,
    u: User,
  ) {
    if (channel !== "chatwoot" && channel !== "email")
      throw new BadRequestException("Неизвестный канал интеграции");
    const section = "integration." + channel,
      allowed =
        channel === "chatwoot"
          ? ["enabled", "baseUrl", "accountId", "inboxId"]
          : [
              "enabled",
              "smtpHost",
              "smtpPort",
              "username",
              "fromAddress",
            ],
      entries = Object.entries(d).filter(
        ([key, value]) => allowed.includes(key) && value !== undefined,
      );
    await this.p.$transaction(async (tx) => {
      for (const [key, value] of entries)
        await tx.appSetting.upsert({
          where: { section_key: { section, key } },
          create: { section, key, value: value as Prisma.InputJsonValue },
          update: { value: value as Prisma.InputJsonValue },
        });
      const secrets = channel === "chatwoot"
        ? [{ input: "accessToken", stored: "accessTokenEncrypted", remove: "removeAccessToken" }, { input: "webhookSecret", stored: "webhookSecretEncrypted", remove: "removeWebhookSecret" }] as const
        : [{ input: "password", stored: "passwordEncrypted", remove: "removePassword" }] as const;
      for (const item of secrets) {
        if ((d as any)[item.remove]) await tx.appSetting.deleteMany({ where: { section, key: item.stored } });
        const value = (d as any)[item.input];
        if (typeof value === "string" && value.trim()) {
          const encrypted = encryptSecret(value.trim());
          await tx.appSetting.upsert({ where: { section_key: { section, key: item.stored } }, create: { section, key: item.stored, value: encrypted }, update: { value: encrypted } });
          await tx.appSetting.deleteMany({ where: { section, key: item.input } });
        }
      }
      const safe = Object.fromEntries(entries);
      await tx.auditLog.create({
        data: {
          actorId: u.id,
          action: "UPDATE",
          entityType: "IntegrationSetting",
          entityId: channel,
          after: {
            ...safe,
            secretsUpdated: secrets.filter(item => Boolean((d as any)[item.input])).map(item => item.input),
            secretsRemoved: secrets.filter(item => Boolean((d as any)[item.remove])).map(item => item.input),
          },
        },
      });
    });
    return (await this.integrations())[channel];
  }
  private async sectionValues(section: string) {
    const rows = await this.p.appSetting.findMany({ where: { section } });
    return Object.fromEntries(rows.map((x) => [x.key, x.value])) as Record<string, unknown>;
  }
  private publicOrigin() {
    return (process.env.WEB_ORIGIN || "https://crm.yoleotard.com").split(",")[0]!.trim().replace(/\/$/, "");
  }
  private secretValue(values: Record<string, unknown>, key: string) {
    const encrypted = values[key];
    if (typeof encrypted !== "string" || !encrypted) return undefined;
    try { return decryptSecret(encrypted); } catch { return undefined; }
  }
  private metaOauthSecret() {
    const secret = process.env.SETTINGS_ENCRYPTION_KEY;
    if (!secret || secret.length < 32) throw new BadRequestException("Не настроен ключ шифрования CRM");
    return secret;
  }
  private requireMetaOauthAuth() { if (process.env.AUTH_DISABLED?.toLowerCase() === "true") throw new ForbiddenException("Для подключения Meta включите авторизацию CRM"); }
  private metaGraphVersion() { return process.env.META_GRAPH_VERSION || "v23.0"; }
  private metaOauthRedirect() { return this.publicOrigin() + "/api/communications/meta/oauth/callback"; }
  private async metaGraph<T>(path: string, token: string, params: Record<string, string> = {}, method = "GET", appSecret?: string) {
    const url = new URL("https://graph.facebook.com/" + this.metaGraphVersion() + "/" + path.replace(/^\//, ""));
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    if (appSecret) url.searchParams.set("appsecret_proof", createHmac("sha256", appSecret).update(token).digest("hex"));
    const response = await fetch(url, { method, headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok || body.error) throw new BadGatewayException("Meta не выполнила запрос");
    return body;
  }
  private async metaTokenExchange(params: Record<string,string>) {
    const response = await fetch("https://graph.facebook.com/" + this.metaGraphVersion() + "/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!response.ok || body.error || !body.access_token) throw new BadGatewayException("Meta не выдала токен доступа");
    return body;
  }
  async metaOauthStart(u: User, sessionHash: string) {
    this.requireMetaOauthAuth();
    const values = await this.sectionValues("integration.meta"), appId = typeof values.appId === "string" ? values.appId : "";
    if (!appId || !this.secretValue(values, "appSecretEncrypted")) throw new BadRequestException("Сначала сохраните ID и секрет приложения Meta");
    const nonce = randomBytes(16).toString("hex");
    await this.p.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"meta-oauth-session:" + sessionHash},0))`;
      const oldPointer=await tx.appSetting.findUnique({where:{section_key:{section:"integration.meta.oauth.pointer",key:sessionHash}}});
      if(oldPointer&&typeof oldPointer.value==="string")await tx.appSetting.deleteMany({where:{section:"integration.meta.oauth",key:oldPointer.value}});
      await tx.appSetting.deleteMany({where:{section:"integration.meta.oauth.pointer",key:sessionHash}});
      await tx.appSetting.upsert({ where: { section_key: { section: "integration.meta.oauth.attempt", key: sessionHash } }, create: { section: "integration.meta.oauth.attempt", key: sessionHash, value: nonce }, update: { value: nonce } });
    });
    const state = signMetaOauthState({ userId: u.id, sessionHash, expiresAt: Date.now() + 10 * 60_000, nonce }, this.metaOauthSecret());
    const url = new URL("https://www.facebook.com/" + this.metaGraphVersion() + "/dialog/oauth");
    url.searchParams.set("client_id", appId); url.searchParams.set("redirect_uri", this.metaOauthRedirect()); url.searchParams.set("state", state); url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "pages_show_list,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages");
    return { url: url.toString() };
  }
  async metaOauthCallback(code: string, signedState: string, u: User, sessionHash: string) {
    this.requireMetaOauthAuth();
    if (!code || !signedState || code.length > 2048 || signedState.length > 4096) throw new BadRequestException("Meta не вернула корректный код авторизации");
    let state; try { state = verifyMetaOauthState(signedState, this.metaOauthSecret()); } catch { throw new ForbiddenException("Сеанс подключения Meta недействителен или истёк"); }
    if (state.userId !== u.id || state.sessionHash !== sessionHash) throw new ForbiddenException("Сеанс подключения принадлежит другой сессии");
    const attempt = await this.p.appSetting.findUnique({ where: { section_key: { section: "integration.meta.oauth.attempt", key: sessionHash } } });
    if (!attempt || attempt.value !== state.nonce) throw new ForbiddenException("Эта попытка подключения Facebook уже заменена новой");
    const values = await this.sectionValues("integration.meta"), appId = String(values.appId || ""), appSecret = this.secretValue(values, "appSecretEncrypted");
    if (!appId || !appSecret) throw new BadRequestException("Приложение Meta не настроено");
    const short = await this.metaTokenExchange({ client_id: appId, client_secret: appSecret, redirect_uri: this.metaOauthRedirect(), code });
    const token = await this.metaTokenExchange({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: short.access_token! });
    const permissions = await this.metaGraph<{ data: Array<{ permission: string; status: string }> }>("me/permissions", token.access_token!, {}, "GET", appSecret);
    const granted = new Set((permissions.data || []).filter(x => x.status === "granted").map(x => x.permission));
    for (const required of ["pages_show_list","pages_manage_metadata","pages_messaging"]) if (!granted.has(required)) throw new ForbiddenException("Facebook не предоставил обязательное разрешение: " + required);
    const result = await this.metaGraph<{ data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }> }>("me/accounts", token.access_token!, { fields: "id,name,access_token,instagram_business_account{id,username}" }, "GET", appSecret);
    const pages = (result.data || []).filter(page => page.id && page.name && page.access_token).slice(0, 100);
    if (!pages.length) throw new BadRequestException("В доступе Facebook не найдено ни одной публичной страницы");
    const pending = encryptSecret(JSON.stringify({ userId:u.id, sessionHash, expiresAt: Date.now() + 15 * 60_000, tokenExpiresAt: token.expires_in ? Date.now()+token.expires_in*1000 : null, permissions:[...granted], pages }));
    await this.p.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"meta-oauth-session:" + sessionHash},0))`;
      const current = await tx.appSetting.findUnique({ where: { section_key: { section: "integration.meta.oauth.attempt", key: sessionHash } } });
      if (!current || current.value !== state.nonce) throw new ForbiddenException("Эта попытка подключения Facebook уже заменена новой");
      await tx.appSetting.upsert({ where: { section_key: { section: "integration.meta.oauth", key: state.nonce } }, create: { section: "integration.meta.oauth", key: state.nonce, value: pending }, update: { value: pending } });
      await tx.appSetting.upsert({ where: { section_key: { section: "integration.meta.oauth.pointer", key: sessionHash } }, create: { section: "integration.meta.oauth.pointer", key: sessionHash, value: state.nonce }, update: { value: state.nonce } });
      await tx.appSetting.delete({ where: { section_key: { section: "integration.meta.oauth.attempt", key: sessionHash } } });
    });
    return { accepted: true };
  }
  metaOauthResultHtml(ok: boolean) {
    return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Подключение Meta</title><body><h1>${ok?"Авторизация завершена":"Авторизация не завершена"}</h1><p>${ok?"Вернитесь в CRM и выберите страницу Facebook.":"Закройте окно и повторите подключение из CRM."}</p></body></html>`;
  }
  private decodeMetaOauthPending(encrypted:string,u:User,sessionHash:string){
    let pending: { userId:string;sessionHash:string;expiresAt: number; tokenExpiresAt:number|null;permissions:string[];pages: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }> };
    try { pending = JSON.parse(decryptSecret(encrypted)); } catch { throw new BadRequestException("Не удалось прочитать авторизацию Facebook"); }
    if (pending.userId!==u.id||pending.sessionHash!==sessionHash)throw new ForbiddenException("Авторизация Facebook принадлежит другой сессии");
    return pending;
  }
  private async metaOauthPending(flowId:string,u: User,sessionHash:string) {
    const row = await this.p.appSetting.findUnique({ where: { section_key: { section: "integration.meta.oauth", key: flowId } } });
    if (!row || typeof row.value !== "string") throw new NotFoundException("Авторизация Facebook не найдена или истекла");
    const pending=this.decodeMetaOauthPending(row.value,u,sessionHash);
    if (!pending.expiresAt || pending.expiresAt < Date.now()) { await this.p.appSetting.delete({ where: { section_key: { section: "integration.meta.oauth", key: flowId } } }); throw new BadRequestException("Авторизация Facebook истекла, подключитесь повторно"); }
    return pending;
  }
  async metaOauthPages(u: User,sessionHash:string) {
    this.requireMetaOauthAuth();
    const pointer=await this.p.appSetting.findUnique({where:{section_key:{section:"integration.meta.oauth.pointer",key:sessionHash}}});
    if(!pointer||typeof pointer.value!=="string")throw new NotFoundException("Авторизация Facebook ещё не завершена");
    const pending = await this.metaOauthPending(pointer.value,u,sessionHash);
    return { flowId:pointer.value,pages: pending.pages.map(page => ({ id: page.id, name: page.name, instagramAccountId: page.instagram_business_account?.id || "", instagramUsername: page.instagram_business_account?.username || "" })) };
  }
  async metaOauthConnect(flowId:string,pageId: string, u: User,sessionHash:string) {
    this.requireMetaOauthAuth();
    const pending=await this.metaOauthPending(flowId,u,sessionHash),page=pending.pages.find(item=>item.id===pageId);
    if (!page) throw new BadRequestException("Выбранная страница отсутствует в авторизации Facebook");
    if(page.instagram_business_account&&(!pending.permissions.includes("instagram_basic")||!pending.permissions.includes("instagram_manage_messages")))throw new ForbiddenException("Facebook не предоставил разрешения для сообщений Instagram");
    const encrypted=await this.p.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"meta-oauth-session:"+sessionHash},0))`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"meta-oauth:"+flowId},0))`;const pointer=await tx.appSetting.findUnique({where:{section_key:{section:"integration.meta.oauth.pointer",key:sessionHash}}});if(!pointer||pointer.value!==flowId)throw new NotFoundException("Подключение Facebook уже заменено новой попыткой");const row=await tx.appSetting.findUnique({where:{section_key:{section:"integration.meta.oauth",key:flowId}}});if(!row||typeof row.value!=="string")throw new NotFoundException("Подключение Facebook уже обработано");await tx.appSetting.delete({where:{section_key:{section:"integration.meta.oauth",key:flowId}}});await tx.appSetting.delete({where:{section_key:{section:"integration.meta.oauth.pointer",key:sessionHash}}});return row.value});
    const values=await this.sectionValues("integration.meta"),appSecret=this.secretValue(values,"appSecretEncrypted");
    const section = "integration.meta";
    try {
      await this.metaGraph(page.id + "/subscribed_apps", page.access_token, { subscribed_fields: "messages,messaging_postbacks,message_reads,messaging_optins" }, "POST", appSecret);
      await this.p.$transaction(async tx => {
        const values: Record<string, Prisma.InputJsonValue> = { enabled: true, pageId: page.id, pageName: page.name, instagramAccountId: page.instagram_business_account?.id || "", pageAccessTokenEncrypted: encryptSecret(page.access_token), subscriptionVerifiedAt: new Date().toISOString() };
        for (const [key, value] of Object.entries(values)) await tx.appSetting.upsert({ where: { section_key: { section, key } }, create: { section, key, value }, update: { value } });
        await tx.appSetting.upsert({where:{section_key:{section,key:"tokenExpiresAt"}},create:{section,key:"tokenExpiresAt",value:pending.tokenExpiresAt??0},update:{value:pending.tokenExpiresAt??0}});
        await tx.auditLog.create({ data: { actorId: u.id, action: "UPDATE", entityType: "MetaIntegrationSetting", entityId: "meta", after: { oauthConnected: true, pageId: page.id, instagramAccountId: page.instagram_business_account?.id || null } } });
      });
    } catch (error) {
      await this.p.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"meta-oauth-session:"+sessionHash},0))`;
        const [attempt,currentPointer]=await Promise.all([
          tx.appSetting.findUnique({where:{section_key:{section:"integration.meta.oauth.attempt",key:sessionHash}}}),
          tx.appSetting.findUnique({where:{section_key:{section:"integration.meta.oauth.pointer",key:sessionHash}}})
        ]);
        if(!attempt&&!currentPointer){
          await tx.appSetting.upsert({where:{section_key:{section:"integration.meta.oauth",key:flowId}},create:{section:"integration.meta.oauth",key:flowId,value:encrypted},update:{value:encrypted}});
          await tx.appSetting.create({data:{section:"integration.meta.oauth.pointer",key:sessionHash,value:flowId}});
        }
      });
      throw error;
    }
    return this.metaSettings();
  }
  async metaSettings() {
    const v = await this.sectionValues("integration.meta"), origin = this.publicOrigin();
    const verifyToken = this.secretValue(v, "verifyTokenEncrypted"), verifyTokenUnsafe = isMetaAccessToken(verifyToken);
    const appSecretConfigured = Boolean(this.secretValue(v, "appSecretEncrypted")), verifyTokenConfigured = Boolean(verifyToken) && !verifyTokenUnsafe, pageAccessTokenConfigured = Boolean(this.secretValue(v, "pageAccessTokenEncrypted")), whatsappAccessTokenConfigured = Boolean(this.secretValue(v, "whatsappAccessTokenEncrypted"));
    const hasConfiguredChannel = Boolean((v.pageId || v.instagramAccountId) && pageAccessTokenConfigured) || Boolean(v.whatsappPhoneNumberId && whatsappAccessTokenConfigured);
    const ready = v.enabled === true && Boolean(v.appId) && appSecretConfigured && verifyTokenConfigured && hasConfiguredChannel, verified = typeof v.subscriptionVerifiedAt === "string" && Boolean(v.subscriptionVerifiedAt), receiving = typeof v.lastWebhookAt === "string" && Boolean(v.lastWebhookAt);
    return { enabled: v.enabled === true, status: metaDeliveryStatus({ enabled: v.enabled === true, ready, verified, receiving, verifyTokenUnsafe }), subscriptionVerifiedAt: verified ? v.subscriptionVerifiedAt : null, lastWebhookAt: receiving ? v.lastWebhookAt : null, appId: typeof v.appId === "string" ? v.appId : "", pageId: typeof v.pageId === "string" ? v.pageId : "", pageName: typeof v.pageName === "string" ? v.pageName : "", instagramAccountId: typeof v.instagramAccountId === "string" ? v.instagramAccountId : "", whatsappPhoneNumberId: typeof v.whatsappPhoneNumberId === "string" ? v.whatsappPhoneNumberId : "", appSecretConfigured, verifyTokenConfigured, verifyTokenUnsafe, pageAccessTokenConfigured, whatsappAccessTokenConfigured, webhookUrl: origin + "/api/communications/meta/webhook" };
  }
  async saveMetaSettings(d: MetaIntegrationDto, u: User) {
    const section = "integration.meta", publicKeys = ["enabled", "appId", "pageId", "instagramAccountId", "whatsappPhoneNumberId"] as const;
    const secrets = [{ input: "appSecret", stored: "appSecretEncrypted", remove: "removeAppSecret" }, { input: "verifyToken", stored: "verifyTokenEncrypted", remove: "removeVerifyToken" }, { input: "pageAccessToken", stored: "pageAccessTokenEncrypted", remove: "removePageAccessToken" }, { input: "whatsappAccessToken", stored: "whatsappAccessTokenEncrypted", remove: "removeWhatsappAccessToken" }] as const;
    if (typeof d.verifyToken === "string" && isMetaAccessToken(d.verifyToken)) throw new BadRequestException("Проверочный токен webhook не должен быть токеном доступа Meta");
    const current = await this.sectionValues(section), deliveryChanged = (d.appId !== undefined && d.appId !== current.appId) || (d.pageId !== undefined && d.pageId !== current.pageId) || Boolean(d.appSecret || d.removeAppSecret || d.pageAccessToken || d.removePageAccessToken);
    await this.p.$transaction(async (tx) => {
      for (const key of publicKeys) if (d[key] !== undefined) await tx.appSetting.upsert({ where: { section_key: { section, key } }, create: { section, key, value: d[key] as Prisma.InputJsonValue }, update: { value: d[key] as Prisma.InputJsonValue } });
      for (const item of secrets) {
        if (d[item.remove]) await tx.appSetting.deleteMany({ where: { section, key: item.stored } });
        const value = d[item.input];
        if (typeof value === "string" && value.trim()) { const encrypted = encryptSecret(value.trim()); await tx.appSetting.upsert({ where: { section_key: { section, key: item.stored } }, create: { section, key: item.stored, value: encrypted }, update: { value: encrypted } }); }
      }
      if (deliveryChanged) await tx.appSetting.deleteMany({ where: { section, key: { in: ["subscriptionVerifiedAt", "lastWebhookAt"] } } });
      await tx.auditLog.create({ data: { actorId: u.id, action: "UPDATE", entityType: "MetaIntegrationSetting", entityId: "meta", after: { enabled: d.enabled, appId: d.appId, pageId: d.pageId, instagramAccountId: d.instagramAccountId, whatsappPhoneNumberId: d.whatsappPhoneNumberId, secretsUpdated: secrets.filter(x => Boolean(d[x.input])).map(x => x.input), secretsRemoved: secrets.filter(x => d[x.remove]).map(x => x.input) } } });
    });
    return this.metaSettings();
  }
  async verifyMetaDelivery(u: User) {
    const section = "integration.meta", values = await this.sectionValues(section), pageId = typeof values.pageId === "string" ? values.pageId : "", appId = typeof values.appId === "string" ? values.appId : "", appSecret = this.secretValue(values, "appSecretEncrypted"), pageToken = this.secretValue(values, "pageAccessTokenEncrypted");
    if (values.enabled !== true || !pageId || !appId || !appSecret || !pageToken) throw new BadRequestException("Сначала заполните и сохраните настройки страницы Facebook");
    try {
      const page = await this.metaGraph<{ id: string; name?: string }>(pageId, pageToken, { fields: "id,name" }, "GET", appSecret);
      if (page.id !== pageId) throw new BadRequestException("Токен доступа принадлежит другой странице Facebook");
      const fields = "messages,messaging_postbacks,message_reads,messaging_optins";
      await this.metaGraph(pageId + "/subscribed_apps", pageToken, { subscribed_fields: fields }, "POST", appSecret);
      const subscriptions = await this.metaGraph<{ data: Array<{ id: string; subscribed_fields?: string[] }> }>(pageId + "/subscribed_apps", pageToken, { fields: "id,subscribed_fields" }, "GET", appSecret);
      const verifiedAt = new Date().toISOString();
      const confirmed = confirmMetaPageSubscription({ pageId, appId, page, subscriptions: subscriptions.data || [], verifiedAt });
      await this.p.$transaction(async tx => {
        for (const [key, value] of Object.entries(confirmed.settings)) await tx.appSetting.upsert({ where: { section_key: { section, key } }, create: { section, key, value }, update: { value } });
        await tx.auditLog.create({ data: { actorId: u.id, action: "UPDATE", entityType: "MetaIntegrationSetting", entityId: "meta", after: confirmed.auditAfter } });
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("Meta не разрешила подписать страницу. Переподключите Facebook и предоставьте разрешение pages_manage_metadata");
    }
    return this.metaSettings();
  }
  async verifyMetaWebhook(mode?: string, token?: string, challenge?: string) {
    const values = await this.sectionValues("integration.meta"), saved = this.secretValue(values, "verifyTokenEncrypted");
    if (isMetaAccessToken(saved) || mode !== "subscribe" || !safeTokenEqual(token, saved) || challenge === undefined) throw new ForbiddenException("Проверка Meta webhook не пройдена");
    return challenge;
  }
  async receiveMetaWebhook(rawBody: Buffer, signature: string | undefined, payload: unknown) {
    const values = await this.sectionValues("integration.meta"), secret = this.secretValue(values, "appSecretEncrypted");
    if (values.enabled !== true || !secret || !verifyMetaSignature(rawBody, signature, secret)) throw new ForbiddenException("Подпись Meta webhook недействительна");
    const events = normalizeMetaWebhook(payload).slice(0, 100).filter(event => {
      const expected = event.channel === "FACEBOOK" ? values.pageId : event.channel === "INSTAGRAM" ? values.instagramAccountId : values.whatsappPhoneNumberId;
      return typeof expected === "string" && expected !== "" && event.receiverId === expected;
    });
    let accepted = 0;
    for (const event of events) if (await this.persistInbound(event)) accepted++;
    if (events.length) { const section = "integration.meta", key = "lastWebhookAt", value = new Date().toISOString(); await this.p.appSetting.upsert({ where: { section_key: { section, key } }, create: { section, key, value }, update: { value } }); }
    return { received: true, accepted, ignored: events.length - accepted };
  }
  async receiveChatwootWebhook(rawBody: Buffer, signature: string | undefined, token: string | undefined, payload: unknown) {
    const values = await this.sectionValues("integration.chatwoot"), secret = this.secretValue(values, "webhookSecretEncrypted");
    if (values.enabled !== true || !secret || (!verifyChatwootSignature(rawBody, signature, secret) && !safeTokenEqual(token, secret))) throw new ForbiddenException("Проверка Chatwoot webhook не пройдена");
    const events = normalizeChatwootWebhook(payload).filter(event => chatwootScopeMatches(values, event));
    let accepted = 0;
    for (const event of events) if (await this.persistInbound(event)) accepted++;
    return { received: true, accepted, ignored: events.length - accepted };
  }
  private async persistInbound(event: MetaInboundMessage | ChatwootInboundMessage) {
    return this.p.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"inbound:" + event.channel + ":" + event.externalSenderId}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"inbound-message:" + event.channel + ":" + event.externalMessageId}, 0))`;
      const channel = event.channel as ContactChannel;
      let conversation = await tx.conversation.findUnique({ where: { externalId_channel: { externalId: event.externalSenderId, channel } } });
      const duplicate = await tx.message.findFirst({ where: { externalId: event.externalMessageId, conversation: { channel } }, select: { id: true } });
      if (duplicate) return false;
      let clientId = conversation?.clientId, linkedByContact = false, client = clientId ? await tx.client.findUnique({ where: { id: clientId }, select: { id: true, archivedAt: true, lastContactAt: true } }) : null;
      let ambiguousMatches = 0;
      const match: Prisma.ClientWhereInput[] = [];
      if (event.email) match.push({ email: { equals: event.email, mode: "insensitive" } });
      const phone = event.phone || (channel === ContactChannel.WHATSAPP ? event.externalSenderId : undefined);
      if (phone) match.push({ phone: { in: [phone, phone.replace(/^\+/, ""), "+" + phone.replace(/^\+/, "")] } }, { whatsapp: { in: [phone, phone.replace(/^\+/, ""), "+" + phone.replace(/^\+/, "")] } });
      if (channel === ContactChannel.FACEBOOK) match.push({ facebook: event.externalSenderId });
      if (channel === ContactChannel.INSTAGRAM) match.push({ instagram: event.externalSenderId });
      if (!client && match.length) {
        const active = await tx.client.findMany({ where: { archivedAt: null, OR: match }, select: { id: true, archivedAt: true, lastContactAt: true }, take: 2 });
        const archived = active.length ? [] : await tx.client.findMany({ where: { archivedAt: { not: null }, OR: match }, select: { id: true, archivedAt: true, lastContactAt: true }, take: 2 });
        const candidates = active.length ? active : archived;
        ambiguousMatches = candidates.length > 1 ? candidates.length : 0;
        client = uniqueCandidate(candidates);
        clientId = client?.id;
        linkedByContact = Boolean(client);
      }
      if (client?.archivedAt) {
        const before = client;
        client = await tx.client.update({ where: { id: client.id }, data: { archivedAt: null }, select: { id: true, archivedAt: true, lastContactAt: true } });
        await tx.auditLog.create({ data: { action: "REACTIVATE", entityType: "Client", entityId: client.id, before: { archived: true }, after: { archived: false, source: event.channel } } });
        await tx.activity.create({ data: { clientId: client.id, type: "CLIENT_REACTIVATED_BY_INBOUND", summary: "Клиент возвращён из архива новым входящим сообщением", metadata: { channel: event.channel, previousArchivedAt: before.archivedAt } } });
      }
      if (!clientId) {
        const fallback = event.channel === "WHATSAPP" ? "WhatsApp" : event.channel === "INSTAGRAM" ? "Instagram" : event.channel === "FACEBOOK" ? "Facebook" : event.channel === "EMAIL" ? "E-mail" : "Chatwoot", displayName = event.displayName?.trim() || fallback + " " + event.externalSenderId.slice(-6);
        const created = await tx.client.create({ data: { firstName: displayName, displayName, source: channel, preferredChannel: channel, status: "LEAD", firstContactAt: event.receivedAt, lastContactAt: event.receivedAt, email: event.email, ...(phone ? { phone } : {}), ...(channel === ContactChannel.WHATSAPP ? { whatsapp: phone || event.externalSenderId } : channel === ContactChannel.INSTAGRAM ? { instagram: event.externalSenderId } : channel === ContactChannel.FACEBOOK ? { facebook: event.externalSenderId } : {}) } });
        clientId = created.id;
        client = { id: created.id, archivedAt: null, lastContactAt: created.lastContactAt };
        await tx.auditLog.create({ data: { action: "CREATE", entityType: "Client", entityId: created.id, after: { source: event.channel, createdFromInbound: true } } });
        if (ambiguousMatches) await tx.auditLog.create({ data: { action: "AMBIGUOUS", entityType: "InboundIdentity", entityId: created.id, after: { channel: event.channel, candidateCount: ambiguousMatches, resolution: "newLead" } } });
        await tx.activity.create({ data: { clientId: created.id, type: "CLIENT_CREATED_FROM_INBOUND", summary: "Клиент создан из входящего сообщения", metadata: { channel: event.channel } } });
      }
      if (!conversation) {
        conversation = await tx.conversation.upsert({ where: { clientId_channel: { clientId, channel } }, create: { clientId, channel, externalId: event.externalSenderId }, update: { externalId: event.externalSenderId, archivedAt: null } });
        await tx.auditLog.create({ data: { action: "CREATE", entityType: "Conversation", entityId: conversation.id, after: { clientId, channel, createdFromInbound: true } } });
        if (linkedByContact) await tx.auditLog.create({ data: { action: "LINK", entityType: "InboundIdentity", entityId: conversation.id, after: { clientId, channel, matchedBy: event.email ? "email" : event.phone ? "phone" : "channelIdentifier" } } });
      } else if (conversation.archivedAt) {
        conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { archivedAt: null } });
        await tx.auditLog.create({ data: { action: "REACTIVATE", entityType: "Conversation", entityId: conversation.id, after: { clientId, channel, archived: false } } });
      }
      const receivedAt = Number.isFinite(event.receivedAt.getTime()) ? event.receivedAt : new Date();
      const message = await tx.message.create({ data: { conversationId: conversation.id, direction: MessageDirection.INBOUND, status: MessageStatus.RECEIVED, content: event.content, externalId: event.externalMessageId, createdAt: receivedAt, metadata: { ...event.metadata, receiverId: event.receiverId, accountId: "accountId" in event ? event.accountId : undefined, inboxId: "inboxId" in event ? event.inboxId : undefined } as Prisma.InputJsonValue } });
      const conversationTime = conversation.lastMessageAt && conversation.lastMessageAt.getTime() > receivedAt.getTime() ? conversation.lastMessageAt : receivedAt;
      const contactTime = client?.lastContactAt && client.lastContactAt.getTime() > receivedAt.getTime() ? client.lastContactAt : receivedAt;
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: conversationTime, unreadCount: { increment: 1 } } });
      await tx.client.update({ where: { id: clientId }, data: { lastContactAt: contactTime } });
      await tx.activity.create({ data: { clientId, type: "INBOUND_MESSAGE_RECEIVED", summary: "Получено входящее сообщение: " + event.channel, metadata: { messageId: message.id, channel: event.channel } } });
      await tx.auditLog.create({ data: { action: "CREATE", entityType: "InboundMessage", entityId: message.id, after: { channel: event.channel, externalMessageId: event.externalMessageId } } });
      return true;
    });
  }
  async detail(clientId: string, channel?: ContactChannel) {
    const client = await this.p.client.findFirst({
      where: { id: clientId, archivedAt: null },
      select: { id: true, source: true, preferredChannel: true },
    });
    if (!client) throw new NotFoundException("Клиент не найден");
    if (!channel) {
      const conversations = await this.p.conversation.findMany({ where: { clientId, archivedAt: null }, include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } } });
      const messages = conversations.flatMap(conversation => conversation.messages.map(message => ({ ...message, channel: conversation.channel }))).sort((a,b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(-300);
      return { id: null, clientId, channel: null, unreadCount: conversations.reduce((sum,x) => sum + x.unreadCount, 0), lastMessageAt: messages.at(-1)?.createdAt ?? null, messages };
    }
    const selected = channel;
    const c = await this.p.conversation.findUnique({
      where: { clientId_channel: { clientId, channel: selected } },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } },
    });
    return c ? { ...c, messages: c.messages.map(message => ({ ...message, channel: c.channel })) } : (
      {
        id: null,
        clientId,
        channel: selected,
        unreadCount: 0,
        lastMessageAt: null,
        messages: [],
      }
    );
  }
  async send(clientId: string, d: SendMessageDto, u: User) {
    const selected = await this.p.client.findFirst({
      where: { id: clientId, archivedAt: null },
      select: { source: true, preferredChannel: true },
    });
    if (!selected) throw new NotFoundException("Клиент не найден");
    const channel =
      d.channel ||
      selected.preferredChannel ||
      selected.source ||
      ContactChannel.MANUAL;
    const content = d.content.trim();
    if (!content)
      throw new BadRequestException("Сообщение не может быть пустым");
    return this.p.$transaction(async (tx) => {
      const c = await tx.conversation.upsert({
        where: { clientId_channel: { clientId, channel } },
        create: { clientId, channel },
        update: {},
      });
      const m = await tx.message.create({
        data: {
          conversationId: c.id,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.DRAFT,
          content,
          authorId: u.id,
        },
      });
      await tx.conversation.update({
        where: { id: c.id },
        data: { lastMessageAt: m.createdAt },
      });
      await tx.activity.create({
        data: {
          clientId,
          type: "MESSAGE_DRAFTED",
          summary: "Создан исходящий черновик сообщения",
          metadata: { messageId: m.id, channel: c.channel },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: u.id,
          action: "CREATE",
          entityType: "Message",
          entityId: m.id,
          after: m,
        },
      });
      return m;
    });
  }
}
@Injectable()
export class AiAssistantService {
  constructor(private p: PrismaService) {}
  private async values() {
    const rows = await this.p.appSetting.findMany({ where: { section: "ai" } });
    return Object.fromEntries(rows.map((x) => [x.key, x.value])) as Record<
      string,
      unknown
    >;
  }
  private resolveApiKey(v: Record<string, unknown>) {
    if (v.apiKeyDisabled === true) return undefined;
    if (typeof v.apiKeyEncrypted === "string") {
      try {
        return decryptSecret(v.apiKeyEncrypted);
      } catch {
        return undefined;
      }
    }
    return process.env.OPENAI_API_KEY?.trim() || undefined;
  }
  private publicSettings(v: Record<string, unknown>) {
    const connected = Boolean(this.resolveApiKey(v));
    return {
      enabled: v.enabled === true,
      allowClientContext: v.allowClientContext === true,
      model:
        typeof v.model === "string" &&
        ALLOWED_AI_MODELS.includes(v.model as any)
          ? v.model
          : "gpt-4.1-mini",
      defaultLanguage:
        typeof v.defaultLanguage === "string" ? v.defaultLanguage : "Русский",
      tone:
        typeof v.tone === "string"
          ? v.tone
          : "Доброжелательный и профессиональный",
      systemPrompt: typeof v.systemPrompt === "string" ? v.systemPrompt : "",
      connected,
      apiKeySource: connected
        ? typeof v.apiKeyEncrypted === "string"
          ? "settings"
          : "environment"
        : "none",
    };
  }
  private reserve(u: User) {
    return this.p.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        "ai:" + u.id,
      );
      const now = new Date(),
        hourAgo = new Date(now.getTime() - 3_600_000),
        leaseAgo = new Date(now.getTime() - AI_LEASE_MS),
        used = await tx.auditLog.count({
          where: {
            actorId: u.id,
            entityType: "AI_GENERATION_ATTEMPT",
            createdAt: { gte: hourAgo },
          },
        }),
        active = await tx.auditLog.count({
          where: {
            actorId: u.id,
            entityType: "AI_GENERATION_ATTEMPT",
            action: "START",
            createdAt: { gte: leaseAgo },
          },
        });
      if (used >= AI_RATE_LIMIT_PER_HOUR)
        throw new TooManyRequestsException(
          "Лимит AI-запросов исчерпан. Повторите позже",
        );
      if (active >= AI_CONCURRENCY_LIMIT)
        throw new TooManyRequestsException(
          "Слишком много одновременных AI-запросов",
        );
      return tx.auditLog.create({
        data: {
          actorId: u.id,
          action: "START",
          entityType: "AI_GENERATION_ATTEMPT",
          after: { windowMinutes: 60, limit: AI_RATE_LIMIT_PER_HOUR },
        },
      });
    });
  }
  private release(id: string) {
    return this.p.auditLog
      .update({ where: { id }, data: { action: "COMPLETE" } })
      .catch(() => undefined);
  }
  async generateLimited(d: AiRequestDto, u: User) {
    const lease = await this.reserve(u);
    try {
      return await this.generate(d, u);
    } finally {
      await this.release(lease.id);
    }
  }
  async settings() {
    return this.publicSettings(await this.values());
  }
  async save(d: AiSettingsDto, u: User) {
    if (d.apiKey && d.removeApiKey)
      throw new BadRequestException(
        "Нельзя одновременно сохранить и удалить токен",
      );
    const allowed = [
      "enabled",
      "allowClientContext",
      "model",
      "defaultLanguage",
      "tone",
      "systemPrompt",
    ] as const;
    return this.p.$transaction(async (tx) => {
      for (const key of allowed)
        if (d[key] !== undefined)
          await tx.appSetting.upsert({
            where: { section_key: { section: "ai", key } },
            create: {
              section: "ai",
              key,
              value: d[key] as Prisma.InputJsonValue,
            },
            update: { value: d[key] as Prisma.InputJsonValue },
          });
      if (d.apiKey) {
        const encrypted = encryptSecret(d.apiKey.trim());
        await tx.appSetting.upsert({
          where: { section_key: { section: "ai", key: "apiKeyEncrypted" } },
          create: { section: "ai", key: "apiKeyEncrypted", value: encrypted },
          update: { value: encrypted },
        });
        await tx.appSetting.upsert({
          where: { section_key: { section: "ai", key: "apiKeyDisabled" } },
          create: { section: "ai", key: "apiKeyDisabled", value: false },
          update: { value: false },
        });
      }
      if (d.removeApiKey) {
        await tx.appSetting.deleteMany({
          where: { section: "ai", key: "apiKeyEncrypted" },
        });
        await tx.appSetting.upsert({
          where: { section_key: { section: "ai", key: "apiKeyDisabled" } },
          create: { section: "ai", key: "apiKeyDisabled", value: true },
          update: { value: true },
        });
      }
      const safeAfter = {
        ...Object.fromEntries(
          allowed
            .filter((key) => d[key] !== undefined)
            .map((key) => [key, d[key]]),
        ),
        apiKeyUpdated: Boolean(d.apiKey),
        apiKeyRemoved: d.removeApiKey === true,
      };
      await tx.auditLog.create({
        data: {
          actorId: u.id,
          action: "UPDATE",
          entityType: "AppSetting",
          entityId: "ai",
          after: safeAfter as Prisma.InputJsonValue,
        },
      });
      const rows = await tx.appSetting.findMany({ where: { section: "ai" } });
      return this.publicSettings(
        Object.fromEntries(rows.map((x) => [x.key, x.value])) as Record<
          string,
          unknown
        >,
      );
    });
  }
  async generate(d: AiRequestDto, u: User) {
    const values = await this.values();
    const cfg = this.publicSettings(values);
    if (!cfg.enabled) throw new BadRequestException("AI-помощник отключён");
    const key = this.resolveApiKey(values);
    if (!key) throw new BadRequestException("OpenAI API не подключён");
    let context = "";
    if (
      cfg.allowClientContext &&
      d.clientId &&
      (d.action === "REPLY" || d.action === "TEMPLATE")
    ) {
      const c = await this.p.client.findFirst({
        where: { id: d.clientId, archivedAt: null },
        select: {
          displayName: true,
          language: true,
          country: true,
          orders: {
            where: { archivedAt: null },
            take: 5,
            orderBy: { createdAt: "desc" },
            select: {
              number: true,
              salesStatus: true,
              productionStatus: true,
              requiredDeliveryAt: true,
            },
          },
        },
      });
      if (c)
        context = JSON.stringify({
          client: {
            name: c.displayName,
            language: c.language,
            country: c.country,
          },
          orders: c.orders.map((o) => ({
            number: o.number,
            status: o.salesStatus,
            production: o.productionStatus,
            deadline: o.requiredDeliveryAt,
          })),
        });
    }
    const task = {
      REPLY: "Предложи готовый ответ клиенту",
      TRANSLATE: "Переведи текст без дополнительных комментариев",
      IMPROVE: "Улучши черновик, сохранив смысл",
      TEMPLATE: "Создай краткий шаблонный ответ",
    }[d.action];
    const prompt =
      "Ты помощник CRM Yoleotard. " +
      cfg.tone +
      ". Язык результата: " +
      (d.targetLanguage || cfg.defaultLanguage) +
      ". Не выдумывай факты о сроках, оплате и заказе. Если данных недостаточно, явно укажи это. " +
      cfg.systemPrompt +
      "\nЗадача: " +
      task +
      "\nКонтекст: " +
      context +
      "\nТекст: " +
      d.text +
      "\nУточнение: " +
      (d.instructions || "");
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: cfg.model,
        input: prompt,
        max_output_tokens: 800,
      }),
    });
    if (!r.ok)
      throw new BadGatewayException("OpenAI не смог подготовить ответ");
    const x = (await r.json()) as any;
    const text =
      x.output_text ||
      x.output
        ?.flatMap((o: any) => o.content || [])
        .find((z: any) => z.type === "output_text")?.text;
    if (!text) throw new BadGatewayException("OpenAI вернул пустой ответ");
    await this.p.auditLog.create({
      data: {
        actorId: u.id,
        action: "GENERATE",
        entityType: "AiAssistantGeneration",
        entityId: d.clientId,
        after: {
          action: d.action,
          model: cfg.model,
          clientContextIncluded: Boolean(context),
          inputCharacters: d.text.length,
          outputCharacters: text.length,
        },
      },
    });
    return { text };
  }
}
