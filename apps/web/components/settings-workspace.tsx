"use client";
import { FormEvent, useEffect, useRef, useState, type Ref } from "react";
import { settingsUi } from "../lib/i18n";
const AI_MODEL_OPTIONS = ["gpt-4.1-mini", "gpt-4.1", "gpt-5-mini"] as const;
type Setting = { key: string; section: string; value: unknown };
type AiData = {
  enabled: boolean;
  allowClientContext: boolean;
  model: string;
  defaultLanguage: string;
  tone: string;
  systemPrompt: string;
  connected: boolean;
  apiKeySource: "settings" | "environment" | "none";
};
type AiControlData={serverPolicy:{aiEnabled:boolean;provider:string;analysisModel:string;replyModel:string;embeddingModel:string};effective:Record<string,unknown>&{masterEnabled:boolean;mode:string;autoReplies:boolean;serverBlocked:boolean};settings:Array<{key:string;value:unknown;scope:string;scopeId:string}>;worker:{running:boolean};outbox:{status:string;queued:number};lastSuccessfulRun:string|null;statistics24h:{messagesQueued:number;analysesCompleted:number;failed:number;retryCount:number;averageLatencyMs:number;inputTokens:number;outputTokens:number;estimatedCostMinor:number;automaticRepliesSent:number}};
type IntegrationData = {
  deliveryAvailable: boolean;
  meta: {
    enabled: boolean;
    status: string;
    appId: string;
    pageId: string;
    pageName: string;
    instagramAccountId: string;
    instagramAppId: string;
    instagramStatus: string;
    instagramSubscriptionVerifiedAt: string | null;
    lastInstagramWebhookAt: string | null;
    whatsappPhoneNumberId: string;
    appSecretConfigured: boolean;
    instagramAppSecretConfigured: boolean;
    verifyTokenConfigured: boolean;
    verifyTokenUnsafe: boolean;
    pageAccessTokenConfigured: boolean;
    whatsappAccessTokenConfigured: boolean;
    subscriptionVerifiedAt: string | null;
    lastWebhookAt: string | null;
    webhookUrl: string;
  };
  chatwoot: {
    enabled: boolean;
    status: string;
    baseUrl: string;
    accountId: string;
    inboxId: string;
    accessTokenConfigured: boolean;
    webhookSecretConfigured: boolean;
    webhookUrl: string;
  };
  email: {
    enabled: boolean;
    status: string;
    smtpHost: string;
    smtpPort: number;
    imapHost: string;
    imapPort: number;
    username: string;
    fromAddress: string;
    signature: string;
    passwordConfigured: boolean;
  };
};
function Secret({ name, label, saved, inputRef }: { name: string; label: string; saved: boolean; inputRef?: Ref<HTMLInputElement> }) {
  return <label>{label}<input ref={inputRef} name={name} type="password" autoComplete="new-password" placeholder={saved ? settingsUi.secretSaved : settingsUi.secretNotSaved}/></label>;
}
function CommunicationsSettings() {
  const instagramAdvancedRef = useRef<HTMLDetailsElement>(null);
  const instagramAppIdRef = useRef<HTMLInputElement>(null);
  const instagramAppSecretRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<IntegrationData>(),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<"meta" | "chatwoot" | "email" | null>(null),
    [saving, setSaving] = useState(false),
    [oauthLoading,setOauthLoading]=useState(false),
    [metaFlowId,setMetaFlowId]=useState(""),
    [metaPages,setMetaPages]=useState<Array<{id:string;name:string;instagramAccountId:string;instagramUsername:string}>>([]);
  async function load() {
    const r = await fetch("/api/communications/integrations", {
      credentials: "include",
    });
    if (!r.ok) throw new Error(settingsUi.channelsLoadError);
    const result = (await r.json()) as IntegrationData;
    setData(result);
    return result;
  }
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);
  async function submit(
    channel: "chatwoot" | "email",
    e: FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();
    setSaving(true);
    setSaved(null);
    setError("");
    const f = new FormData(e.currentTarget),
      body =
        channel === "chatwoot"
          ? {
              enabled: f.get("enabled") === "on",
              baseUrl: f.get("baseUrl"),
              accountId: f.get("accountId"),
              inboxId: f.get("inboxId"),
              accessToken: f.get("accessToken"),
              webhookSecret: f.get("webhookSecret"),
            }
          : {
              enabled: f.get("enabled") === "on",
              smtpHost: f.get("smtpHost"),
              smtpPort: Number(f.get("smtpPort")),
              imapHost: f.get("imapHost"),
              imapPort: Number(f.get("imapPort")),
              username: f.get("username"),
              password: f.get("password"),
              fromAddress: f.get("fromAddress"),
              signature: f.get("signature"),
            };
    try {
      const r = await fetch("/api/communications/integrations/" + channel, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(settingsUi.channelsSaveError);
      await load();
      setSaved(channel);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function submitMeta(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();setSaving(true);setSaved(null);setError("");
    const f=new FormData(e.currentTarget),body={enabled:f.get("enabled")==="on",appId:f.get("appId"),pageId:f.get("pageId"),instagramAccountId:f.get("instagramAccountId"),instagramAppId:f.get("instagramAppId"),whatsappPhoneNumberId:f.get("whatsappPhoneNumberId"),appSecret:f.get("appSecret"),instagramAppSecret:f.get("instagramAppSecret"),verifyToken:f.get("verifyToken"),pageAccessToken:f.get("pageAccessToken"),whatsappAccessToken:f.get("whatsappAccessToken")};
    try{const r=await fetch("/api/communications/meta/settings",{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error(settingsUi.channelsSaveError);await load();setSaved("meta")}catch(x){setError((x as Error).message)}finally{setSaving(false)}
  }
  async function fetchMetaPages(){const r=await fetch("/api/communications/meta/oauth/pages",{credentials:"include"});if(!r.ok)return false;const result=await r.json();setMetaFlowId(result.flowId||"");setMetaPages(result.pages||[]);return true}
  async function connectFacebook(){setError("");setOauthLoading(true);try{const r=await fetch("/api/communications/meta/oauth/start",{credentials:"include"});if(!r.ok){const x=await r.json().catch(()=>({}));throw new Error(x.message||settingsUi.metaOauthStartError)}const {url}=await r.json();const popup=window.open(url,"yoleotard-meta-oauth","popup,width=620,height=760");if(!popup)throw new Error(settingsUi.metaPopupBlocked);for(let i=0;i<120;i++){await new Promise(resolve=>setTimeout(resolve,1000));if(await fetchMetaPages())break;if(popup.closed)throw new Error(settingsUi.metaOauthNotFinished)}}catch(x){setError((x as Error).message)}finally{setOauthLoading(false)}}
  function showInstagramCredentials(){
    setError(settingsUi.metaInstagramCredentialsHelp);
    if(instagramAdvancedRef.current)instagramAdvancedRef.current.open=true;
    if(!data?.meta.instagramAppId)instagramAppIdRef.current?.focus();
    else instagramAppSecretRef.current?.focus();
  }
  async function connectInstagram(){setError("");if(!data?.meta.instagramAppId||!data.meta.instagramAppSecretConfigured){showInstagramCredentials();return}const subscriptionBaseline=data.meta.instagramSubscriptionVerifiedAt;const popup=window.open("about:blank","yoleotard-instagram-oauth","popup,width=620,height=760");if(!popup){setError(settingsUi.metaPopupBlocked);return}popup.opener=null;setOauthLoading(true);try{const r=await fetch("/api/communications/meta/instagram/oauth/start",{credentials:"include"});if(!r.ok){const x=await r.json().catch(()=>({}));throw new Error(x.message||settingsUi.metaOauthStartError)}const {url}=await r.json();popup.location.href=url;let connected=false;for(let i=0;i<120;i++){await new Promise(resolve=>setTimeout(resolve,1000));const latest=await load();if((latest.meta.instagramStatus==="SUBSCRIBED"||latest.meta.instagramStatus==="RECEIVING")&&latest.meta.instagramSubscriptionVerifiedAt!==subscriptionBaseline){connected=true;break}if(popup.closed)throw new Error(settingsUi.metaOauthNotFinished)}if(!connected)throw new Error(settingsUi.metaOauthNotFinished);popup.close()}catch(x){if(!popup.closed)popup.close();setError((x as Error).message)}finally{setOauthLoading(false)}}
  async function selectMetaPage(pageId:string){setSaving(true);setError("");try{const r=await fetch("/api/communications/meta/oauth/connect",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({flowId:metaFlowId,pageId})});if(!r.ok){const x=await r.json().catch(()=>({}));throw new Error(x.message||settingsUi.channelsSaveError)}await load();setMetaFlowId("");setMetaPages([]);setSaved("meta")}catch(x){setError((x as Error).message)}finally{setSaving(false)}}
  async function verifyMetaDelivery(){setSaving(true);setSaved(null);setError("");try{const r=await fetch("/api/communications/meta/delivery/verify",{method:"POST",credentials:"include"});if(!r.ok){const x=await r.json().catch(()=>({}));throw new Error(x.message||settingsUi.metaVerifyDeliveryError)}await load();setSaved("meta")}catch(x){setError((x as Error).message)}finally{setSaving(false)}}
  async function verifyEmail(){setSaving(true);setError("");try{const r=await fetch("/api/communications/email/verify",{method:"POST",credentials:"include"});if(!r.ok){const x=await r.json().catch(()=>({}));throw new Error(x.message||settingsUi.emailVerifyError)}setSaved("email");await load()}catch(x){setError((x as Error).message)}finally{setSaving(false)}}
  if (!data)
    return (
      <section
        id="settings-communications-panel"
        role="tabpanel"
        className="settings-card"
        aria-busy={!error}
      >
        {error ? (
          <div className="phase2-error" role="alert">
            {error}
          </div>
        ) : (
          settingsUi.channelsLoading
        )}
      </section>
    );
  const status = (value: string) =>
    value === "VERIFIED" ? settingsUi.connected : value === "CONFIGURED" ? settingsUi.configured : settingsUi.notConnected;
  const metaStatus = (value: string) => value === "VERIFY_TOKEN_UNSAFE" ? settingsUi.metaVerifyTokenUnsafe : value === "RECEIVING" ? settingsUi.metaDeliveryReceiving : value === "VERIFIED" || value === "SUBSCRIBED" ? settingsUi.metaDeliveryVerified : value === "NOT_VERIFIED" ? settingsUi.metaDeliveryNotVerified : settingsUi.notConnected;
  const instagramConnected = data.meta.instagramStatus === "SUBSCRIBED" || data.meta.instagramStatus === "RECEIVING";
  return (
    <section id="settings-communications-panel" role="tabpanel">
      <div className="settings-card">
        <h2>{settingsUi.channelsTitle}</h2>
        <p>{settingsUi.channelsHint}</p>
        {!data.deliveryAvailable && (
          <div className="phase2-warning" role="status">
            {settingsUi.draftOnly}
          </div>
        )}
      </div>
      {error && (
        <div className="phase2-error" role="alert">
          {error}
        </div>
      )}
      <form className="settings-card settings-meta-card" onSubmit={submitMeta}>
        <h2>{settingsUi.metaTitle}</h2>
        <p>{settingsUi.metaHint}</p>
        {(data.meta.pageId||instagramConnected)&&<div className="settings-meta-current"><b>{data.meta.pageName||settingsUi.metaConnectedPage}</b><span>{data.meta.pageId?`ID ${data.meta.pageId}`:""}{instagramConnected&&data.meta.instagramAccountId?`${data.meta.pageId?" · ":""}Instagram ${data.meta.instagramAccountId}`:""}</span>{data.meta.pageId&&<small>{settingsUi.metaFacebookStatus}: {metaStatus(data.meta.status)}</small>}{data.meta.instagramAccountId&&<small>{settingsUi.metaInstagramStatus}: {metaStatus(data.meta.instagramStatus)}</small>}</div>}
        <div className="settings-meta-actions">
          <button type="button" className="settings-facebook-button" onClick={connectFacebook} disabled={oauthLoading||saving}>{oauthLoading?settingsUi.metaConnecting:(data.meta.pageId?settingsUi.metaReconnect:settingsUi.metaContinue)}</button>
          <button type="button" className="phase2-primary" onClick={connectInstagram} disabled={oauthLoading||saving} title={!data.meta.instagramAppId||!data.meta.instagramAppSecretConfigured?settingsUi.metaInstagramCredentialsNeeded:undefined}>{settingsUi.metaConnectInstagram}</button>
          {data.meta.pageId&&data.meta.pageAccessTokenConfigured&&<button type="button" className="phase2-primary" onClick={verifyMetaDelivery} disabled={saving}>{settingsUi.metaVerifyDelivery}</button>}
        </div>
        {data.meta.instagramAccountId&&<div className="settings-instagram-routing"><a href="https://www.facebook.com/settings/?tab=ig_conversation_routing" target="_blank" rel="noreferrer">{settingsUi.metaInstagramRouting} ↗</a><small>{settingsUi.metaInstagramRoutingHint}</small></div>}
        {metaPages.length>0&&<div className="settings-meta-pages" role="group" aria-label={settingsUi.metaChoosePage}><h3>{settingsUi.metaChoosePage}</h3>{metaPages.map(page=><button type="button" key={page.id} onClick={()=>selectMetaPage(page.id)} disabled={saving}><span><b>{page.name}</b><small>ID {page.id}{page.instagramUsername?` · @${page.instagramUsername}`:""}</small></span><span>{settingsUi.metaSelect}</span></button>)}</div>}
        {(!data.meta.instagramAppId||!data.meta.instagramAppSecretConfigured)&&<div className="phase2-warning" role="status">{settingsUi.metaInstagramCredentialsHelp} <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">{settingsUi.metaOpenMetaDevelopers}</a></div>}
        <details ref={instagramAdvancedRef} className="settings-meta-advanced">
          <summary>{settingsUi.metaAdvanced}</summary>
          <p>{settingsUi.metaAdvancedHint}</p>
          <label className="settings-channel-toggle"><input name="enabled" type="checkbox" defaultChecked={data.meta.enabled}/>{settingsUi.channelEnabled}</label>
          <div className="settings-grid">
            <label>{settingsUi.metaWebhook}<input value={data.meta.webhookUrl} readOnly/></label>
            <label>{settingsUi.metaAppId}<input name="appId" defaultValue={data.meta.appId}/></label>
            <label>{settingsUi.metaPageId}<input name="pageId" defaultValue={data.meta.pageId}/></label>
            <label>{settingsUi.metaInstagramId}<input name="instagramAccountId" defaultValue={data.meta.instagramAccountId} readOnly/></label>
            <label>{settingsUi.metaInstagramAppId}<input ref={instagramAppIdRef} name="instagramAppId" defaultValue={data.meta.instagramAppId}/></label>
            <label>{settingsUi.metaWhatsappId}<input name="whatsappPhoneNumberId" defaultValue={data.meta.whatsappPhoneNumberId}/></label>
            <Secret name="appSecret" label={settingsUi.metaAppSecret} saved={data.meta.appSecretConfigured}/>
            <Secret inputRef={instagramAppSecretRef} name="instagramAppSecret" label={settingsUi.metaInstagramAppSecret} saved={data.meta.instagramAppSecretConfigured}/>
            <Secret name="verifyToken" label={settingsUi.metaVerifyToken} saved={data.meta.verifyTokenConfigured}/>
            <Secret name="pageAccessToken" label={settingsUi.metaPageToken} saved={data.meta.pageAccessTokenConfigured}/>
            <Secret name="whatsappAccessToken" label={settingsUi.metaWhatsappToken} saved={data.meta.whatsappAccessTokenConfigured}/>
          </div>
          <button className="phase2-primary" disabled={saving}>{settingsUi.saveAdvanced}</button>
        </details>
        {saved==="meta"&&<div className="settings-success" role="status">{settingsUi.saved}</div>}
      </form>
      <form className="settings-card" onSubmit={(e) => submit("chatwoot", e)}>
        <h2>
          {settingsUi.chatwootTitle} {"\u00b7"} {status(data.chatwoot.status)}
        </h2>
        <div className="settings-grid">
          <label>{settingsUi.chatwootWebhook}<input value={data.chatwoot.webhookUrl} readOnly/></label>
          <label className="settings-channel-toggle">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={data.chatwoot.enabled}
            />
            {settingsUi.channelEnabled}
          </label>
          <label>
            {settingsUi.baseUrl}
            <input
              name="baseUrl"
              type="url"
              defaultValue={data.chatwoot.baseUrl}
            />
          </label>
          <label>
            {settingsUi.accountId}
            <input name="accountId" defaultValue={data.chatwoot.accountId} />
          </label>
          <label>
            {settingsUi.inboxId}
            <input name="inboxId" defaultValue={data.chatwoot.inboxId} />
          </label>
          <label>
            {settingsUi.accessToken}
            <input
              name="accessToken"
              type="password"
              autoComplete="new-password"
              placeholder={
                data.chatwoot.accessTokenConfigured
                  ? settingsUi.secretSaved
                  : settingsUi.secretNotSaved
              }
            />
          </label>
          <Secret name="webhookSecret" label={settingsUi.chatwootWebhookSecret} saved={data.chatwoot.webhookSecretConfigured}/>
        </div>
        <p>{settingsUi.chatwootEmailHint}</p>
        {saved==="chatwoot"&&<div className="settings-success" role="status">{settingsUi.saved}</div>}
        <button className="phase2-primary" disabled={saving}>
          {settingsUi.save}
        </button>
      </form>
      <form className="settings-card" onSubmit={(e) => submit("email", e)}>
        <h2>
          {settingsUi.emailTitle} {"\u00b7"} {status(data.email.status)}
        </h2>
        <div className="settings-grid">
          <label className="settings-channel-toggle">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={data.email.enabled}
            />
            {settingsUi.channelEnabled}
          </label>
          <label>
            {settingsUi.smtpHost}
            <input name="smtpHost" defaultValue={data.email.smtpHost} />
          </label>
          <label>
            {settingsUi.smtpPort}
            <input
              name="smtpPort"
              type="number"
              min="1"
              max="65535"
              defaultValue={data.email.smtpPort||465}
            />
          </label>
          <label>{settingsUi.imapHost}<input name="imapHost" defaultValue={data.email.imapHost||"imap.gmail.com"}/></label>
          <label>{settingsUi.imapPort}<input name="imapPort" type="number" min="1" max="65535" defaultValue={data.email.imapPort||993}/></label>
          <label>
            {settingsUi.username}
            <input name="username" type="email" defaultValue={data.email.username||"yoleotard@gmail.com"} />
          </label>
          <label>
            {settingsUi.password}
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              aria-describedby="email-app-password-hint"
              placeholder={
                data.email.passwordConfigured
                  ? settingsUi.secretSaved
                  : settingsUi.secretNotSaved
              }
            />
          </label>
          <label>
            {settingsUi.fromAddress}
            <input
              name="fromAddress"
              type="email"
              defaultValue={data.email.fromAddress||"yoleotard@gmail.com"}
            />
          </label>
          <label className="settings-span-all">
            {settingsUi.emailSignature}
            <textarea
              name="signature"
              rows={5}
              maxLength={5000}
              defaultValue={data.email.signature||""}
              placeholder={settingsUi.emailSignaturePlaceholder}
            />
          </label>
        </div>
        <p className="settings-inline-note">{settingsUi.emailSignatureHint}</p>
        <p id="email-app-password-hint">{settingsUi.emailAppPasswordHint}</p>
        {saved === "email" && (
          <div className="settings-success" role="status">
            {settingsUi.saved}
          </div>
        )}
        {!data.email.passwordConfigured&&<p className="settings-inline-note">{settingsUi.emailSaveBeforeVerify}</p>}
        <div className="settings-actions">
          <button className="phase2-primary" disabled={saving}>{settingsUi.save}</button>
          <button className="settings-secondary" type="button" disabled={saving||!data.email.passwordConfigured} onClick={()=>void verifyEmail()}>{settingsUi.emailVerify}</button>
        </div>
      </form>
    </section>
  );
}
export function SettingsWorkspace({role}:{role:string}) {
  const [section, setSection] = useState<"account" | "finance" | "communications" | "ai" | "production">(
    role==="OWNER"?"account":"finance",
  );
  return (
    <div className="settings-page">
      <header className="phase2-header">
        <div>
          <p>{settingsUi.eyebrow}</p>
          <h1>{settingsUi.title}</h1>
          <span>{settingsUi.subtitle}</span>
        </div>
      </header>
      <nav
        className="settings-tabs"
        aria-label={settingsUi.title}
        role="tablist"
      >
        {role==="OWNER"&&<button type="button" role="tab" aria-selected={section === "account"} aria-controls="settings-account-panel" className={section === "account" ? "active" : ""} onClick={() => setSection("account")}>{settingsUi.accountTab}</button>}
        <button
          type="button"
          role="tab"
          aria-selected={section === "finance"}
          aria-controls="settings-finance-panel"
          className={section === "finance" ? "active" : ""}
          onClick={() => setSection("finance")}
        >
          {settingsUi.finance}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "communications"}
          aria-controls="settings-communications-panel"
          className={section === "communications" ? "active" : ""}
          onClick={() => setSection("communications")}
        >
          {settingsUi.communications}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "ai"}
          aria-controls="settings-ai-panel"
          className={section === "ai" ? "active" : ""}
          onClick={() => setSection("ai")}
        >
          {settingsUi.aiTab}
        </button>
        {(role==="OWNER"||role==="ADMIN")&&<button type="button" role="tab" aria-selected={section === "production"} aria-controls="settings-production-panel" className={section === "production" ? "active" : ""} onClick={() => setSection("production")}>{settingsUi.production}</button>}
        {(["orders", "shipping", "interface"] as const).map(
          (key) => (
            <button
              type="button"
              key={key}
              disabled
              title={settingsUi.comingSoon}
            >
              {settingsUi[key]}
            </button>
          ),
        )}
      </nav>
      {section === "account"&&role==="OWNER" ? (
        <AccountSettings />
      ) : section === "finance" ? (
        <FinanceSettings />
      ) : section === "communications" ? (
        <CommunicationsSettings />
      ) : section === "production" ? (
        <ProductionSettings />
      ) : (
        <AiSettings />
      )}
    </div>
  );
}

function ProductionSettings() {
  const [settings,setSettings]=useState<Setting[]>([]),[loaded,setLoaded]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  async function request(init?:RequestInit,path="/api/finance/settings"){const r=await fetch(path,{credentials:"include",...init,headers:{"Content-Type":"application/json"}});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(Array.isArray(body.message)?body.message.join(", "):body.message||settingsUi.saveError);return body}
  useEffect(()=>{request().then(x=>{setSettings(x);setLoaded(true)}).catch(e=>setError((e as Error).message))},[]);
  const value=(key:string,fallback:number)=>{const current=settings.find(item=>item.section==="production"&&item.key===key)?.value;return typeof current==="number"?current:fallback};
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setError("");setMessage("");try{const form=new FormData(e.currentTarget),updated=await request({method:"PATCH",body:JSON.stringify({defaultDurationDays:Number(form.get("defaultDurationDays")),shippingLeadDays:Number(form.get("shippingLeadDays"))})},"/api/finance/settings/production");setSettings(updated);setMessage(settingsUi.saved)}catch(x){setError((x as Error).message)}finally{setSaving(false)}}
  return <section id="settings-production-panel" role="tabpanel" className="settings-card"><h2>{settingsUi.productionSettingsTitle}</h2><p>{settingsUi.productionSettingsHint}</p><form key={JSON.stringify(settings)} className="settings-grid" onSubmit={save}><label>{settingsUi.productionDuration}<input name="defaultDurationDays" type="number" min="1" max="90" defaultValue={value("defaultDurationDays",7)} disabled={!loaded} required/><small>{settingsUi.productionDurationHint}</small></label><label>{settingsUi.shippingLeadDays}<input name="shippingLeadDays" type="number" min="0" max="30" defaultValue={value("shippingLeadDays",2)} disabled={!loaded} required/><small>{settingsUi.shippingLeadDaysHint}</small></label>{error&&<div className="phase2-error" role="alert">{error}</div>}{message&&<div className="settings-success" role="status">{message}</div>}<button className="phase2-primary" disabled={saving||!loaded}>{saving?settingsUi.accountSaving:settingsUi.save}</button></form></section>
}

function AccountSettings(){
  const[currentEmail,setCurrentEmail]=useState(""),[newEmail,setNewEmail]=useState(""),[error,setError]=useState(""),[message,setMessage]=useState(""),[saving,setSaving]=useState(false);
  useEffect(()=>{fetch("/api/auth/me",{credentials:"include"}).then(async r=>{if(!r.ok)throw new Error();const x=await r.json();setCurrentEmail(x.user.email);setNewEmail(x.user.email)}).catch(()=>setError(settingsUi.accountLoadError))},[]);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setError("");setMessage("");const form=e.currentTarget,f=new FormData(form),newPassword=String(f.get("newPassword")||""),confirmPassword=String(f.get("confirmPassword")||"");if(newPassword!==confirmPassword){setError(settingsUi.accountMismatch);return}setSaving(true);try{const body:{currentPassword:string;email:string;newPassword?:string}={currentPassword:String(f.get("currentPassword")||""),email:String(f.get("email")||"")};if(newPassword)body.newPassword=newPassword;const r=await fetch("/api/auth/account",{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(Array.isArray(x.message)?x.message.join(", "):x.message||settingsUi.saveError);setCurrentEmail(x.user.email);setNewEmail(x.user.email);form.reset();setMessage(settingsUi.accountSaved);window.dispatchEvent(new Event("yoleotard-auth-changed"))}catch(x){setError((x as Error).message)}finally{setSaving(false)}}
  return <section id="settings-account-panel" role="tabpanel" className="settings-card">
    <h2>{settingsUi.accountTitle}</h2><p>{settingsUi.accountHint}</p>
    <form className="settings-grid" onSubmit={submit}>
      <label>{settingsUi.currentLogin}<input value={currentEmail} readOnly/></label>
      <label>{settingsUi.newLogin}<input name="email" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} autoComplete="username" required/></label>
      <label>{settingsUi.currentPassword}<input name="currentPassword" type="password" autoComplete="current-password" minLength={8} required/></label>
      <label>{settingsUi.newPassword}<input name="newPassword" type="password" autoComplete="new-password" minLength={8}/></label>
      <label>{settingsUi.confirmPassword}<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8}/><small>{settingsUi.accountPasswordHint}</small></label>
      {error&&<div className="phase2-error" role="alert">{error}</div>}{message&&<div className="settings-success" role="status">{message}</div>}
      <button className="phase2-primary" disabled={saving}>{saving?settingsUi.accountSaving:settingsUi.accountSave}</button>
    </form>
  </section>
}
function FinanceSettings() {
  const [settings, setSettings] = useState<Setting[]>([]),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  async function request(path: string, init?: RequestInit) {
    const r = await fetch("/api" + path, {
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error(settingsUi.saveError);
    return r.json();
  }
  useEffect(() => {
    request("/finance/settings")
      .then((x) => {
        setSettings(x);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  function value(key: string, fallback: string) {
    const x = settings.find((s) => s.key === key)?.value;
    return typeof x === "string" || typeof x === "number"
      ? String(x)
      : fallback;
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const f = new FormData(e.currentTarget),
        items = [
          ["finance", "invoicePrefix", f.get("invoicePrefix")],
          ["finance", "sellerName", f.get("sellerName")],
          ["finance", "sellerAddress", f.get("sellerAddress")],
          ["finance", "defaultCurrency", f.get("defaultCurrency")],
          ["orders", "depositPercent", Number(f.get("depositPercent"))],
        ];
      for (const [section, key, v] of items)
        await request("/finance/settings", {
          method: "PATCH",
          body: JSON.stringify({ section, key, value: v }),
        });
      setMessage(settingsUi.saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div id="settings-finance-panel" role="tabpanel">
      <form
        key={JSON.stringify(settings)}
        className="settings-card"
        onSubmit={save}
        aria-busy={saving}
      >
        <h2>{settingsUi.financeInvoices}</h2>
        <p>{settingsUi.financeHint}</p>
        <div className="settings-grid">
          <label>
            {settingsUi.invoicePrefix}
            <input
              name="invoicePrefix"
              defaultValue={value("invoicePrefix", "INV-YO")}
            />
          </label>
          <label>
            {settingsUi.defaultCurrency}
            <select
              name="defaultCurrency"
              defaultValue={value("defaultCurrency", "EUR")}
            >
              <option>EUR</option>
              <option>USD</option>
              <option>UAH</option>
            </select>
          </label>
          <label>
            {settingsUi.sellerName}
            <input
              name="sellerName"
              defaultValue={value("sellerName", "Yoleotard")}
            />
          </label>
          <label>
            {settingsUi.sellerDetails}
            <textarea
              name="sellerAddress"
              defaultValue={value("sellerAddress", settingsUi.defaultCountry)}
            />
          </label>
          <label>
            {settingsUi.defaultDeposit}
            <input
              name="depositPercent"
              type="number"
              min="0"
              max="100"
              defaultValue={value("depositPercent", "50")}
            />
          </label>
        </div>
        {error && (
          <div className="phase2-error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="settings-success" role="status">
            {message}
          </div>
        )}
        <button className="phase2-primary" disabled={saving}>
          {settingsUi.save}
        </button>
      </form>
      <section className="settings-card muted-card">
        <h2>{settingsUi.otherSections}</h2>
        <p>{settingsUi.otherHint}</p>
      </section>
    </div>
  );
}
const AI_CONTROL_GROUPS=[
  ["conversation",["analyzeIncoming","detectLanguage","detectIntent","detectUrgency","detectReplyRequired","extractEntities","extractCandidateFacts","extractCustomerRequests","extractDesignRequirements","detectPaymentClaims","detectShippingQuestions","detectProductionQuestions"]],
  ["memory",["extractMemoryCandidates","storeMemoryCandidates","autoPromoteMemories","useCustomerMemory","showMemoryInCustomerCard"]],
  ["facts",["extractConversationFacts","detectAgreements","storeAgreementCandidates","autoConfirmAgreements","useConfirmedAgreements"]],
  ["knowledge",["knowledgeRetrieval","semanticSearch","generalKnowledge","pricingKnowledge","deliveryKnowledge","productionKnowledge","sportsKnowledge"]],
  ["replies",["draftReplies","showDrafts","employeeEditing","saveDraftFeedback","autoReplies"]],
] as const;
function AiControlCenter(){
  const [data,setData]=useState<AiControlData>(),[error,setError]=useState(""),[saved,setSaved]=useState(""),[channel,setChannel]=useState("");
  async function load(){const suffix=channel?`?channel=${encodeURIComponent(channel)}`:"",response=await fetch(`/api/ai-control/status${suffix}`,{credentials:"include"});if(!response.ok)throw new Error(settingsUi.aiControl.saveError);setData(await response.json())}
  useEffect(()=>{load().catch(e=>setError((e as Error).message))},[channel]);
  async function update(key:string,value:unknown){setError("");setSaved("");const response=await fetch("/api/ai-control/settings",{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({key,value,scope:channel?"CHANNEL":"GLOBAL",...(channel?{scopeId:channel}:{})})});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||settingsUi.aiControl.saveError)}await load();setSaved(settingsUi.aiControl.saved)}
  if(!data)return <section className="settings-card" aria-busy={!error}><h2>{settingsUi.aiControl.title}</h2>{error?<div className="phase2-error" role="alert">{error}</div>:<p>{settingsUi.aiLoading}</p>}</section>;
  const labels=settingsUi.aiControl.labels as Record<string,string>,effective=data.effective,disabled=data.effective.serverBlocked;
  const toggle=(key:string,forcedDisabled=false)=><label key={key} className="settings-check"><input type="checkbox" checked={Boolean(effective[key])} disabled={disabled||forcedDisabled} onChange={event=>update(key,event.target.checked).catch(e=>setError((e as Error).message))}/><span><strong>{labels[key]}</strong>{(forcedDisabled||disabled)&&<small>{disabled?settingsUi.aiControl.disabledByServer:settingsUi.aiControl.policyDisabled}</small>}</span></label>;
  return <div className="settings-ai-control">
    <section className="settings-card"><h2>{settingsUi.aiControl.title}</h2><p>{settingsUi.aiControl.hint}</p><div className={disabled?"phase2-warning":"settings-success"}>{disabled?settingsUi.aiControl.disabledByServer:settingsUi.aiControl.serverPolicy}</div><div className="settings-grid"><strong>{settingsUi.aiControl.global}: {effective.masterEnabled?settingsUi.aiControl.stateLabels.on:settingsUi.aiControl.stateLabels.off}</strong><strong>{settingsUi.aiControl.mode}: {settingsUi.aiControl.modeLabels[effective.mode as keyof typeof settingsUi.aiControl.modeLabels]||effective.mode}</strong><span>{settingsUi.aiControl.provider}: {data.serverPolicy.provider}</span><span>{settingsUi.aiControl.model}: {data.serverPolicy.analysisModel}</span><span>{settingsUi.aiControl.worker}: {data.worker.running?settingsUi.aiControl.running:settingsUi.aiControl.stopped}</span><span>{settingsUi.aiControl.outbox}: {data.outbox.status==="healthy"?settingsUi.aiControl.healthy:settingsUi.aiControl.warning}</span><span>{settingsUi.aiControl.autoReplies}: {settingsUi.aiControl.stateLabels.off}</span><span>{settingsUi.aiControl.lastRun}: {data.lastSuccessfulRun?new Date(data.lastSuccessfulRun).toLocaleString("ru-RU"):settingsUi.aiControl.never}</span></div></section>
    <section className="settings-card"><label>{settingsUi.aiControl.channel}<select value={channel} onChange={event=>setChannel(event.target.value)}><option value="">{settingsUi.aiControl.globalScope}</option>{(["INSTAGRAM","FACEBOOK","WHATSAPP","EMAIL"] as const).map(value=><option key={value} value={value}>{settingsUi.aiControl.channelLabels[value]}</option>)}</select></label>{toggle("masterEnabled")}<label>{settingsUi.aiControl.operatingMode}<select value={String(effective.mode)} disabled={disabled} onChange={event=>update("mode",event.target.value).catch(e=>setError((e as Error).message))}><option value="OFF">{settingsUi.aiControl.modeLabels.OFF}</option><option value="SHADOW">{settingsUi.aiControl.modeLabels.SHADOW}</option>{(["ASSIST","AUTO_SAFE","AGENT","AUTONOMOUS"] as const).map(value=><option key={value} value={value} disabled>{settingsUi.aiControl.modeLabels[value]} — {settingsUi.aiControl.policyDisabled}</option>)}</select></label><label>{settingsUi.aiControl.rollout}<select value={Number(effective.rolloutPercentage||0)} disabled={disabled} onChange={event=>update("rolloutPercentage",Number(event.target.value)).catch(e=>setError((e as Error).message))}>{[0,10,25,50,100].map(value=><option key={value} value={value}>{value}%</option>)}</select></label></section>
    {AI_CONTROL_GROUPS.map(([title,keys])=><section className="settings-card" key={title}><h3>{settingsUi.aiControl[title]}</h3><div className="settings-ai-switches">{keys.map(key=>toggle(key,["autoPromoteMemories","autoConfirmAgreements","autoReplies"].includes(key)))}</div></section>)}
    <section className="settings-card"><h3>{settingsUi.aiControl.actions}</h3><div className="settings-grid">{settingsUi.aiControl.actionNames.map((name,index)=><div key={name}><strong>{name}</strong><small>{index<5?settingsUi.aiControl.readOnly:index<8?settingsUi.aiControl.approvalRequired:settingsUi.aiControl.disabled}</small></div>)}</div><p>{settingsUi.aiControl.policyDisabled}</p></section>
    <section className="settings-card"><h3>{settingsUi.aiControl.limits}</h3><div className="settings-grid">{Object.entries(settingsUi.aiControl.limitNames).map(([key,name])=>{const definition=(data as AiControlData&{definitions?:Record<string,{min:number;max:number;writable?:boolean}>}).definitions?.[key];return <label key={key}>{name}<input type="number" min={definition?.min} max={definition?.max} defaultValue={Number(effective[key]||definition?.min||1)} disabled={disabled||definition?.writable===false} onBlur={event=>update(key,Number(event.target.value)).catch(e=>setError((e as Error).message))}/>{definition?.writable===false&&<small>{settingsUi.aiControl.policyDisabled}</small>}</label>})}</div></section>
    <section className="settings-card"><h3>{settingsUi.aiControl.statistics}</h3><div className="settings-grid"><span>{settingsUi.aiControl.messagesQueued}: {data.statistics24h.messagesQueued}</span><span>{settingsUi.aiControl.completed}: {data.statistics24h.analysesCompleted}</span><span>{settingsUi.aiControl.failed}: {data.statistics24h.failed}</span><span>{settingsUi.aiControl.retries}: {data.statistics24h.retryCount}</span><span>{settingsUi.aiControl.latency}: {data.statistics24h.averageLatencyMs} ms</span><span>{settingsUi.aiControl.tokens}: {data.statistics24h.inputTokens}/{data.statistics24h.outputTokens}</span><span>{settingsUi.aiControl.cost}: {data.statistics24h.estimatedCostMinor}</span><span>{settingsUi.aiControl.automaticSent}: 0</span></div></section>
    {saved&&<div className="settings-success" role="status">{saved}</div>}{error&&<div className="phase2-error" role="alert">{error}</div>}
  </div>
}
function AiSettings() {
  const [data, setData] = useState<AiData>(),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false),
    [enabled, setEnabled] = useState(false),
    [consent, setConsent] = useState(false);
  useEffect(() => {
    fetch("/api/ai-assistant/settings", { credentials: "include" })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(settingsUi.aiLoadError)),
      )
      .then((x: AiData) => {
        setData(x);
        setEnabled(x.enabled);
        setConsent(x.allowClientContext ?? false);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : settingsUi.aiLoadError),
      );
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    if (enabled && !consent) {
      setError(settingsUi.aiRequiredConsent);
      return;
    }
    setSaving(true);
    setError("");
    const f = new FormData(e.currentTarget),
      apiKey = String(f.get("apiKey") ?? "").trim(),
      body = {
        enabled,
        allowClientContext: consent,
        model: f.get("model"),
        defaultLanguage: f.get("defaultLanguage"),
        tone: f.get("tone"),
        systemPrompt: f.get("systemPrompt"),
        ...(apiKey ? { apiKey } : {}),
      };
    try {
      const r = await fetch("/api/ai-assistant/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(settingsUi.aiSaveError);
      const x = (await r.json()) as AiData;
      setData(x);
      setEnabled(x.enabled);
      setConsent(x.allowClientContext ?? false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : settingsUi.aiSaveError);
    } finally {
      setSaving(false);
    }
  }
  async function removeToken() {
    if (!window.confirm(settingsUi.aiDeleteTokenConfirm)) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const r = await fetch("/api/ai-assistant/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeApiKey: true, enabled: false }),
      });
      if (!r.ok) throw new Error(settingsUi.aiSaveError);
      const x = (await r.json()) as AiData;
      setData(x);
      setEnabled(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : settingsUi.aiSaveError);
    } finally {
      setSaving(false);
    }
  }
  if (!data)
    return (
      <section
        id="settings-ai-panel"
        role="tabpanel"
        className="settings-card"
        aria-busy={!error}
      >
        <h2>{settingsUi.aiTitle}</h2>
        {error ? (
          <div className="phase2-error" role="alert">
            {error}
          </div>
        ) : (
          <p role="status">{settingsUi.aiLoading}</p>
        )}
      </section>
    );
  return (
    <div id="settings-ai-panel" role="tabpanel" className="settings-ai-panel">
      <AiControlCenter />
      <form className="settings-card settings-ai-card" onSubmit={submit} aria-busy={saving}>
      <header className="settings-ai-header">
        <div>
          <h2>{settingsUi.aiTitle}</h2>
          <p>{settingsUi.aiHint}</p>
        </div>
        <span
          className={
            data.connected
              ? "settings-connection connected"
              : "settings-connection"
          }
        >
          <i aria-hidden="true" />
          {data.connected ? settingsUi.aiConnected : settingsUi.aiDisconnected}
        </span>
      </header>
      <div className="settings-ai-switches">
        <label className="settings-check">
          <input
            name="enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>
            <strong>{settingsUi.aiEnabled}</strong>
          </span>
        </label>
        <label className="settings-check settings-consent">
          <input
            name="allowClientContext"
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            <strong>{settingsUi.aiConsent}</strong>
            <small>{settingsUi.aiConsentHint}</small>
          </span>
        </label>
      </div>
      <div className="settings-grid">
        <label className="settings-wide">
          {settingsUi.aiToken}
          <input
            name="apiKey"
            type="password"
            autoComplete="new-password"
            placeholder={settingsUi.aiTokenPlaceholder}
          />
          <small>
            {data.apiKeySource === "settings"
              ? settingsUi.aiTokenSaved
              : data.apiKeySource === "environment"
                ? settingsUi.aiTokenEnvironment
                : settingsUi.aiTokenMissing}
            {" · "}
            {settingsUi.aiTokenHint}
          </small>
        </label>
        <label>
          {settingsUi.aiModel}
          <select name="model" defaultValue={data.model} required>
            {AI_MODEL_OPTIONS.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
        <label>
          {settingsUi.aiLanguage}
          <input
            name="defaultLanguage"
            defaultValue={data.defaultLanguage}
            required
          />
        </label>
        <label>
          {settingsUi.aiTone}
          <input name="tone" defaultValue={data.tone} required />
        </label>
        <label className="settings-wide">
          {settingsUi.aiInstructions}
          <textarea name="systemPrompt" defaultValue={data.systemPrompt} />
        </label>
      </div>
      {saved && (
        <div className="settings-success" role="status">
          {settingsUi.aiSaved}
        </div>
      )}
      {error && <div className="phase2-error" role="alert">{error}</div>}
      <div className="settings-ai-actions">
        <button className="phase2-primary" disabled={saving}>
          {saving ? settingsUi.aiSaving : settingsUi.aiSave}
        </button>
        {data.connected && <button type="button" className="phase2-secondary" disabled={saving} onClick={removeToken}>{settingsUi.aiDeleteToken}</button>}
      </div>
      </form>
    </div>
  );
}
