"use client";
import { FormEvent, useEffect, useRef, useState, type Ref } from "react";
import { Badge, Modal, Progress } from "@mantine/core";
import { settingsUi, summaryFormatUi } from "../lib/i18n";
import { CrmButton, CrmCheckbox, CrmNativeSelect, CrmTextarea, CrmTextInput } from "./crm/settings-controls";
import { CrmTabList, type CrmTab } from "./crm/tab-list";
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
type KeycrmSettingsData={enabled:boolean;endpoint:string;apiTokenConfigured:boolean;connectionStatus:string;verifiedAt:string|null;lastErrorCode:string|null;pageSize:number;defaultCurrency:string;defaultOrderType:string;configRevision:number;productionStartFieldUuid:string;expectedDeliveryFieldUuid:string};
type KeycrmRun={id:string;mode:"DRY_RUN"|"APPLY";status:"PENDING"|"RUNNING"|"COMPLETED"|"PARTIAL"|"FAILED";requestedFrom:string|null;requestedTo:string|null;currentPage:number;totalPages:number|null;totalRemote:number|null;scannedCount:number;createdCount:number;updatedCount:number;skippedCount:number;failedCount:number;errorMessage:string|null;createdAt:string;completedAt:string|null;rolledBackAt:string|null;rollbackEligible:boolean;rollbackBlockedReason:string|null;startedBy?:{displayName:string};_count?:{issues:number}};
type KeycrmMergeCandidate={clientId:string;displayName:string;reasons:string[]};
type KeycrmIssueDetails={kind?:string;keycrmBuyerId?:number|null;importedClientId?:string|null;candidates?:KeycrmMergeCandidate[];resolved?:boolean};
type KeycrmIssue={id:string;externalOrderId:string|null;code:string;message:string;details?:KeycrmIssueDetails|null;createdAt:string};
function Secret({ name, label, saved, inputRef }: { name: string; label: string; saved: boolean; inputRef?: Ref<HTMLInputElement> }) {
  return <CrmTextInput ref={inputRef} label={label} name={name} type="password" autoComplete="new-password" placeholder={saved ? settingsUi.secretSaved : settingsUi.secretNotSaved}/>;
}
function CommunicationsSettings() {
  const instagramAdvancedRef = useRef<HTMLDetailsElement>(null);
  const instagramAppIdRef = useRef<HTMLInputElement>(null);
  const instagramAppSecretRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<IntegrationData>(),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<"meta" | "chatwoot" | "email" | null>(null),
    [saving, setSaving] = useState(false),
    [profileRefresh,setProfileRefresh]=useState(""),
    [chatwootProfileRefresh,setChatwootProfileRefresh]=useState(""),
    [chatwootProfilesRefreshing,setChatwootProfilesRefreshing]=useState(false),
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
  async function refreshFacebookProfiles(){setSaving(true);setError("");setProfileRefresh("");let cursor:string|undefined,batches=0,updated=0,avatarsUpdated=0,avatarsUnavailable=0;try{do{const r=await fetch("/api/communications/meta/profiles/backfill",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({dryRun:false,limit:10,cursor})});const result=await r.json().catch(()=>({}));if(!r.ok)throw new Error(result.message||settingsUi.metaProfilesRefreshError);updated+=Number(result.updated||0);avatarsUpdated+=Number(result.avatarsResolvedViaUserProfile||0)+Number(result.avatarsResolvedViaConversations||0);avatarsUnavailable+=Number(result.avatarsUnavailable||0);cursor=typeof result.nextCursor==="string"?result.nextCursor:undefined;batches++}while(cursor&&batches<20);setProfileRefresh(`${settingsUi.metaProfilesUpdated}: ${updated}. ${settingsUi.metaAvatarsUpdated}: ${avatarsUpdated}. ${settingsUi.metaAvatarsUnavailable}: ${avatarsUnavailable}.`)}catch(x){setError((x as Error).message)}finally{setSaving(false)}}
  async function refreshChatwootProfiles(){setSaving(true);setChatwootProfilesRefreshing(true);setError("");setChatwootProfileRefresh("");let cursor:string|undefined,batches=0,scanned=0,matched=0,updated=0;try{do{const r=await fetch("/api/communications/chatwoot/profiles/backfill",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({dryRun:false,limit:15,cursor})});const result=await r.json().catch(()=>({}));if(!r.ok)throw new Error(result.message||settingsUi.chatwootProfilesRefreshError);scanned+=Number(result.scanned||0);matched+=Number(result.matched||0);updated+=Number(result.updated||0);cursor=typeof result.nextCursor==="string"?result.nextCursor:undefined;batches++}while(cursor&&batches<500);if(cursor)throw new Error(settingsUi.chatwootProfilesRefreshIncomplete);setChatwootProfileRefresh(`${settingsUi.chatwootProfilesScanned}: ${scanned}. ${settingsUi.chatwootProfilesMatched}: ${matched}. ${settingsUi.chatwootProfilesUpdated}: ${updated}.`)}catch(x){setError((x as Error).message)}finally{setChatwootProfilesRefreshing(false);setSaving(false)}}
  async function verifyEmail(){setSaving(true);setError("");try{const r=await fetch("/api/communications/email/verify",{method:"POST",credentials:"include"});if(!r.ok){const x=await r.json().catch(()=>({}));throw new Error(x.message||settingsUi.emailVerifyError)}setSaved("email");await load()}catch(x){setError((x as Error).message)}finally{setSaving(false)}}
  if (!data)
    return (
      <section
        id="settings-communications-panel"
        role="tabpanel"
        aria-labelledby="settings-communications-tab"
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
    <section id="settings-communications-panel" role="tabpanel" aria-labelledby="settings-communications-tab">
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
          <CrmButton type="button" color="blue" className="settings-facebook-button" onClick={connectFacebook} disabled={oauthLoading||saving}>{oauthLoading?settingsUi.metaConnecting:(data.meta.pageId?settingsUi.metaReconnect:settingsUi.metaContinue)}</CrmButton>
          <CrmButton type="button" onClick={connectInstagram} disabled={oauthLoading||saving} title={!data.meta.instagramAppId||!data.meta.instagramAppSecretConfigured?settingsUi.metaInstagramCredentialsNeeded:undefined}>{settingsUi.metaConnectInstagram}</CrmButton>
          {data.meta.pageId&&data.meta.pageAccessTokenConfigured&&<CrmButton type="button" onClick={verifyMetaDelivery} disabled={saving}>{settingsUi.metaVerifyDelivery}</CrmButton>}
          {data.meta.pageId&&data.meta.pageAccessTokenConfigured&&<CrmButton tone="secondary" type="button" onClick={refreshFacebookProfiles} disabled={saving}>{settingsUi.metaRefreshProfiles}</CrmButton>}
        </div>
        {data.meta.pageId&&<small>{settingsUi.metaProfileDataHint}</small>}
        {profileRefresh&&<div className="settings-success" role="status">{profileRefresh}</div>}
        {data.meta.instagramAccountId&&<div className="settings-instagram-routing"><a href="https://www.facebook.com/settings/?tab=ig_conversation_routing" target="_blank" rel="noreferrer">{settingsUi.metaInstagramRouting} ↗</a><small>{settingsUi.metaInstagramRoutingHint}</small></div>}
        {metaPages.length>0&&<div className="settings-meta-pages" role="group" aria-label={settingsUi.metaChoosePage}><h3>{settingsUi.metaChoosePage}</h3>{metaPages.map(page=><CrmButton tone="secondary" type="button" key={page.id} onClick={()=>selectMetaPage(page.id)} disabled={saving}><span className="settings-meta-page-copy"><b>{page.name}</b><small>ID {page.id}{page.instagramUsername?` · @${page.instagramUsername}`:""}</small></span><span className="settings-meta-page-action">{settingsUi.metaSelect}</span></CrmButton>)}</div>}
        {(!data.meta.instagramAppId||!data.meta.instagramAppSecretConfigured)&&<div className="phase2-warning" role="status">{settingsUi.metaInstagramCredentialsHelp} <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">{settingsUi.metaOpenMetaDevelopers}</a></div>}
        <details ref={instagramAdvancedRef} className="settings-meta-advanced">
          <summary>{settingsUi.metaAdvanced}</summary>
          <p>{settingsUi.metaAdvancedHint}</p>
          <CrmCheckbox className="settings-channel-toggle" name="enabled" defaultChecked={data.meta.enabled} label={settingsUi.channelEnabled}/>
          <div className="settings-grid">
            <CrmTextInput label={settingsUi.metaWebhook} value={data.meta.webhookUrl} readOnly/>
            <CrmTextInput label={settingsUi.metaAppId} name="appId" defaultValue={data.meta.appId}/>
            <CrmTextInput label={settingsUi.metaPageId} name="pageId" defaultValue={data.meta.pageId}/>
            <CrmTextInput label={settingsUi.metaInstagramId} name="instagramAccountId" defaultValue={data.meta.instagramAccountId} readOnly/>
            <CrmTextInput label={settingsUi.metaInstagramAppId} ref={instagramAppIdRef} name="instagramAppId" defaultValue={data.meta.instagramAppId}/>
            <CrmTextInput label={settingsUi.metaWhatsappId} name="whatsappPhoneNumberId" defaultValue={data.meta.whatsappPhoneNumberId}/>
            <Secret name="appSecret" label={settingsUi.metaAppSecret} saved={data.meta.appSecretConfigured}/>
            <Secret inputRef={instagramAppSecretRef} name="instagramAppSecret" label={settingsUi.metaInstagramAppSecret} saved={data.meta.instagramAppSecretConfigured}/>
            <Secret name="verifyToken" label={settingsUi.metaVerifyToken} saved={data.meta.verifyTokenConfigured}/>
            <Secret name="pageAccessToken" label={settingsUi.metaPageToken} saved={data.meta.pageAccessTokenConfigured}/>
            <Secret name="whatsappAccessToken" label={settingsUi.metaWhatsappToken} saved={data.meta.whatsappAccessTokenConfigured}/>
          </div>
          <CrmButton type="submit" disabled={saving}>{settingsUi.saveAdvanced}</CrmButton>
        </details>
        {saved==="meta"&&<div className="settings-success" role="status">{settingsUi.saved}</div>}
      </form>
      <form className="settings-card" onSubmit={(e) => submit("chatwoot", e)}>
        <h2>
          {settingsUi.chatwootTitle} {"\u00b7"} {status(data.chatwoot.status)}
        </h2>
        <div className="settings-grid">
          <CrmTextInput label={settingsUi.chatwootWebhook} value={data.chatwoot.webhookUrl} readOnly/>
          <CrmCheckbox className="settings-channel-toggle" name="enabled" defaultChecked={data.chatwoot.enabled} label={settingsUi.channelEnabled}/>
          <CrmTextInput label={settingsUi.baseUrl} name="baseUrl" type="url" defaultValue={data.chatwoot.baseUrl}/>
          <CrmTextInput label={settingsUi.accountId} name="accountId" defaultValue={data.chatwoot.accountId}/>
          <CrmTextInput label={settingsUi.inboxId} name="inboxId" defaultValue={data.chatwoot.inboxId}/>
          <CrmTextInput label={settingsUi.accessToken} name="accessToken" type="password" autoComplete="new-password" placeholder={data.chatwoot.accessTokenConfigured ? settingsUi.secretSaved : settingsUi.secretNotSaved}/>
          <Secret name="webhookSecret" label={settingsUi.chatwootWebhookSecret} saved={data.chatwoot.webhookSecretConfigured}/>
        </div>
        <p>{settingsUi.chatwootEmailHint}</p>
        {saved==="chatwoot"&&<div className="settings-success" role="status">{settingsUi.saved}</div>}
        {chatwootProfileRefresh&&<div className="settings-success" role="status">{chatwootProfileRefresh}</div>}
        <div className="settings-actions"><CrmButton type="submit" disabled={saving}>{settingsUi.save}</CrmButton><CrmButton tone="secondary" className="settings-secondary" type="button" aria-busy={chatwootProfilesRefreshing} disabled={saving||!data.chatwoot.accessTokenConfigured} onClick={()=>void refreshChatwootProfiles()}>{chatwootProfilesRefreshing?settingsUi.chatwootRefreshingProfiles:settingsUi.chatwootRefreshProfiles}</CrmButton></div>
      </form>
      <form className="settings-card" onSubmit={(e) => submit("email", e)}>
        <h2>
          {settingsUi.emailTitle} {"\u00b7"} {status(data.email.status)}
        </h2>
        <div className="settings-grid">
          <CrmCheckbox className="settings-channel-toggle" name="enabled" defaultChecked={data.email.enabled} label={settingsUi.channelEnabled}/>
          <CrmTextInput label={settingsUi.smtpHost} name="smtpHost" defaultValue={data.email.smtpHost}/>
          <CrmTextInput label={settingsUi.smtpPort} name="smtpPort" type="number" min="1" max="65535" defaultValue={data.email.smtpPort||465}/>
          <CrmTextInput label={settingsUi.imapHost} name="imapHost" defaultValue={data.email.imapHost||"imap.gmail.com"}/>
          <CrmTextInput label={settingsUi.imapPort} name="imapPort" type="number" min="1" max="65535" defaultValue={data.email.imapPort||993}/>
          <CrmTextInput label={settingsUi.username} name="username" type="email" defaultValue={data.email.username||"yoleotard@gmail.com"}/>
          <CrmTextInput label={settingsUi.password} name="password" type="password" autoComplete="new-password" aria-describedby="email-app-password-hint" placeholder={data.email.passwordConfigured ? settingsUi.secretSaved : settingsUi.secretNotSaved}/>
          <CrmTextInput label={settingsUi.fromAddress} name="fromAddress" type="email" defaultValue={data.email.fromAddress||"yoleotard@gmail.com"}/>
          <CrmTextarea className="settings-span-all" label={settingsUi.emailSignature} name="signature" rows={5} maxLength={5000} defaultValue={data.email.signature||""} placeholder={settingsUi.emailSignaturePlaceholder}/>
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
          <CrmButton type="submit" disabled={saving}>{settingsUi.save}</CrmButton>
          <CrmButton tone="secondary" className="settings-secondary" type="button" disabled={saving||!data.email.passwordConfigured} onClick={()=>void verifyEmail()}>{settingsUi.emailVerify}</CrmButton>
        </div>
      </form>
    </section>
  );
}
function KeycrmSettings(){
  const ui=settingsUi.keycrm,[data,setData]=useState<KeycrmSettingsData>(),[runs,setRuns]=useState<KeycrmRun[]>([]),[current,setCurrent]=useState<KeycrmRun>(),[issues,setIssues]=useState<KeycrmIssue[]>([]),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[merging,setMerging]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState(""),[pendingMerge,setPendingMerge]=useState<{issue:KeycrmIssue;candidate:KeycrmMergeCandidate}>(),[rollbackOpen,setRollbackOpen]=useState(false);
  async function jsonRequest<T>(url:string,init?:RequestInit){const response=await fetch(url,{credentials:"include",...init,headers:{...(init?.body?{"Content-Type":"application/json"}:{}),...(init?.headers||{})}}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(Array.isArray(body.message)?body.message.join(", "):body.message||ui.statusError);return body as T}
  async function load(){const [settings,history]=await Promise.all([jsonRequest<KeycrmSettingsData>("/api/keycrm/settings"),jsonRequest<KeycrmRun[]>("/api/keycrm/sync-runs?limit=20")]);setData(settings);setRuns(history);const active=history.find(run=>run.status==="PENDING"||run.status==="RUNNING")||history[0];if(active)setCurrent(active);return {settings,history}}
  useEffect(()=>{load().catch(reason=>setError((reason as Error).message))},[]);
  useEffect(()=>{if(!current||!(current.status==="PENDING"||current.status==="RUNNING"))return;const timer=window.setInterval(()=>{jsonRequest<KeycrmRun>(`/api/keycrm/sync-runs/${current.id}`).then(run=>{setCurrent(run);setRuns(list=>[run,...list.filter(item=>item.id!==run.id)]);if(run.status!=="PENDING"&&run.status!=="RUNNING")jsonRequest<KeycrmIssue[]>(`/api/keycrm/sync-runs/${run.id}/issues`).then(setIssues).catch(()=>undefined)}).catch(reason=>setError((reason as Error).message))},3000);return()=>window.clearInterval(timer)},[current?.id,current?.status]);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError("");setMessage("");try{const form=new FormData(event.currentTarget),apiToken=String(form.get("apiToken")||"").trim(),productionStartFieldUuid=String(form.get("productionStartFieldUuid")||"").trim(),expectedDeliveryFieldUuid=String(form.get("expectedDeliveryFieldUuid")||"").trim(),result=await jsonRequest<KeycrmSettingsData>("/api/keycrm/settings",{method:"PATCH",body:JSON.stringify({enabled:form.get("enabled")==="on",pageSize:Number(form.get("pageSize")),defaultCurrency:form.get("defaultCurrency"),defaultOrderType:form.get("defaultOrderType"),...(productionStartFieldUuid?{productionStartFieldUuid}:{}),...(expectedDeliveryFieldUuid?{expectedDeliveryFieldUuid}:{}),...(apiToken?{apiToken}:{})})});setData(result);setMessage(settingsUi.saved)}catch(reason){setError((reason as Error).message||ui.saveError)}finally{setBusy(false)}}
  async function testConnection(){setBusy(true);setError("");setMessage("");try{const result=await jsonRequest<{connected:boolean;totalOrders:number;verifiedAt:string}>("/api/keycrm/test-connection",{method:"POST"});setMessage(`${ui.connected}. ${ui.totalOrders}: ${result.totalOrders}`);await load()}catch(reason){setError((reason as Error).message)}finally{setBusy(false)}}
  function previewForRange(run:KeycrmRun){return run.mode==="DRY_RUN"&&(run.status==="COMPLETED"||run.status==="PARTIAL")&&run.requestedFrom===(from?new Date(`${from}T00:00:00Z`).toISOString():null)&&(to?run.requestedTo===new Date(`${to}T23:59:59Z`).toISOString():Boolean(run.requestedTo))}
  async function start(dryRun:boolean){setBusy(true);setError("");setMessage("");setIssues([]);try{const preview=!dryRun?runs.find(previewForRange):undefined;if(!dryRun&&!preview)throw new Error(ui.previewRequired);const body={dryRun,clientRequestId:crypto.randomUUID(),...(from?{from:new Date(`${from}T00:00:00Z`).toISOString()}:{}),...(to?{to:new Date(`${to}T23:59:59Z`).toISOString()}:{}),...(preview?{previewRunId:preview.id}:{})},run=await jsonRequest<KeycrmRun>("/api/keycrm/sync-runs",{method:"POST",body:JSON.stringify(body)});setCurrent(run);setRuns(list=>[run,...list]);setMessage(dryRun?ui.running:ui.applying)}catch(reason){setError((reason as Error).message||ui.startError)}finally{setBusy(false)}}
  async function selectRun(run:KeycrmRun){setCurrent(run);setIssues(await jsonRequest<KeycrmIssue[]>(`/api/keycrm/sync-runs/${run.id}/issues`).catch(()=>[]))}
  async function mergeSuggestedClient(issue:KeycrmIssue,candidate:KeycrmMergeCandidate){const details=issue.details;if(!current||!details?.importedClientId)return;setMerging(issue.id);setError("");try{await jsonRequest(`/api/clients/${candidate.clientId}/merge`,{method:"POST",body:JSON.stringify({sourceClientId:details.importedClientId})});setIssues(await jsonRequest<KeycrmIssue[]>(`/api/keycrm/sync-runs/${current.id}/issues`));setMessage(ui.mergeCompleted);setPendingMerge(undefined)}catch(reason){setError((reason as Error).message||ui.mergeError)}finally{setMerging("")}}
  async function rollbackRun(){if(!current)return;setBusy(true);setError("");setMessage("");try{const run=await jsonRequest<KeycrmRun>(`/api/keycrm/sync-runs/${current.id}/rollback`,{method:"POST"});setCurrent(run);setRuns(list=>[run,...list.filter(item=>item.id!==run.id)]);setMessage(ui.rollbackCompleted);setRollbackOpen(false)}catch(reason){setError((reason as Error).message||ui.rollbackError)}finally{setBusy(false)}}
  if(!data)return <section id="settings-keycrm-panel" role="tabpanel" aria-labelledby="settings-keycrm-tab" className="settings-card">{error?<div className="phase2-error" role="alert">{error}</div>:<p>{ui.loading}</p>}</section>;
  const statusLabel=(status:string)=>({PENDING:ui.pending,RUNNING:ui.running,COMPLETED:ui.completed,PARTIAL:ui.partial,FAILED:ui.failed}[status]||status),connectionLabel={VERIFIED:ui.connected,CONFIGURED:ui.configured,NOT_CONFIGURED:ui.notConfigured,ERROR:ui.connectionError,CREDENTIAL_UNREADABLE:ui.credentialUnreadable}[data.connectionStatus]||data.connectionStatus,percent=current?.totalPages?Math.min(100,Math.round(((Math.max(1,current.currentPage)-(current.status==="COMPLETED"||current.status==="PARTIAL"?0:1))/current.totalPages)*100)):0,clientMergeSuggestions=issues.filter(issue=>issue.details?.kind==="CLIENT_MERGE_SUGGESTION"&&!issue.details.resolved),problemIssues=issues.filter(issue=>issue.details?.kind!=="CLIENT_MERGE_SUGGESTION");
  return <div id="settings-keycrm-panel" role="tabpanel" aria-labelledby="settings-keycrm-tab" className="settings-keycrm-panel">
    <form className="settings-card" onSubmit={save} aria-busy={busy}><header className="keycrm-card-header"><div><h2>{ui.title}</h2><p>{ui.hint}</p></div><Badge color={data.connectionStatus==="VERIFIED"?"green":data.connectionStatus==="ERROR"?"red":"gray"}>{connectionLabel}</Badge></header><div className="settings-grid"><CrmTextInput label={ui.endpoint} value={data.endpoint} readOnly/><Secret name="apiToken" label={ui.token} saved={data.apiTokenConfigured}/><CrmCheckbox className="settings-keycrm-toggle" name="enabled" defaultChecked={data.enabled} label={ui.enabled}/><CrmTextInput label={ui.pageSize} name="pageSize" type="number" min="1" max="50" defaultValue={data.pageSize}/><CrmNativeSelect label={ui.defaultCurrency} name="defaultCurrency" defaultValue={data.defaultCurrency} data={["EUR","USD","UAH"]}/><CrmNativeSelect label={ui.defaultOrderType} name="defaultOrderType" defaultValue={data.defaultOrderType} data={Object.entries(ui.orderTypes).map(([value,label])=>({value,label}))}/><CrmTextInput label={ui.productionStartFieldUuid} description={ui.productionFieldUuidHint} name="productionStartFieldUuid" defaultValue={data.productionStartFieldUuid}/><CrmTextInput label={ui.expectedDeliveryFieldUuid} description={ui.productionFieldUuidHint} name="expectedDeliveryFieldUuid" defaultValue={data.expectedDeliveryFieldUuid}/></div><p>{ui.workflowNotice}</p><p>{ui.tokenHint}</p><div className="settings-actions"><CrmButton type="submit" disabled={busy}>{ui.save}</CrmButton><CrmButton tone="secondary" type="button" disabled={busy||!data.apiTokenConfigured} onClick={()=>void testConnection()}>{busy?ui.testing:ui.test}</CrmButton></div></form>
    <section className="settings-card"><h2>{ui.transferTitle}</h2><p>{ui.transferHint}</p><div className="settings-grid"><CrmTextInput label={ui.from} type="date" value={from} onChange={event=>setFrom(event.target.value)}/><CrmTextInput label={ui.to} type="date" value={to} onChange={event=>setTo(event.target.value)}/></div><div className="phase2-warning" role="note">{ui.measurementsNotice}</div><div className="settings-actions"><CrmButton tone="secondary" type="button" disabled={busy||!data.enabled||data.connectionStatus!=="VERIFIED"} onClick={()=>void start(true)}>{ui.preview}</CrmButton><CrmButton type="button" disabled={busy||data.connectionStatus!=="VERIFIED"||!runs.some(previewForRange)} onClick={()=>void start(false)}>{ui.apply}</CrmButton></div></section>
    {current&&<section className="settings-card keycrm-current"><header className="keycrm-card-header"><div><h2>{current.mode==="DRY_RUN"?ui.preview:ui.realRun}</h2><small>{new Date(current.createdAt).toLocaleString("ru-RU")}</small></div><Badge color={current.status==="COMPLETED"?"green":current.status==="PARTIAL"||current.status==="FAILED"?"red":"violet"}>{statusLabel(current.status)}</Badge></header><Progress value={percent} animated={current.status==="RUNNING"} aria-label={ui.progress}/><div className="keycrm-counters"><span>{ui.page}: <b>{current.currentPage}{current.totalPages?` / ${current.totalPages}`:""}</b></span><span>{ui.scanned}: <b>{current.scannedCount}{current.totalRemote!==null?` / ${current.totalRemote}`:""}</b></span><span>{ui.created}: <b>{current.createdCount}</b></span><span>{ui.updated}: <b>{current.updatedCount}</b></span><span>{ui.skipped}: <b>{current.skippedCount}</b></span><span>{ui.failures}: <b>{current.failedCount}</b></span></div>{current.mode==="APPLY"&&(current.status==="PARTIAL"||current.status==="FAILED")&&!current.rolledBackAt&&(current.rollbackEligible?<div className="settings-actions"><CrmButton tone="secondary" type="button" disabled={busy} onClick={()=>setRollbackOpen(true)}>{ui.rollback}</CrmButton></div>:current.rollbackBlockedReason?<div className="phase2-warning" role="note">{current.rollbackBlockedReason}</div>:null)}{current.errorMessage&&<div className="phase2-error" role="alert">{current.errorMessage}</div>}{clientMergeSuggestions.length>0&&<div className="keycrm-merge-suggestions"><h3>{ui.mergeSuggestions}</h3>{clientMergeSuggestions.map(issue=><article key={issue.id}><b>{issue.externalOrderId?`KeyCRM #${issue.externalOrderId}`:issue.code}</b><span>{issue.message}</span>{issue.details?.candidates?.map(candidate=>{const sourceLabel=issue.details?.keycrmBuyerId?`${ui.keycrmBuyer} #${issue.details.keycrmBuyerId}`:`${ui.importedCard} ${issue.details?.importedClientId||"—"}`,mergeAccessibleName=`${ui.mergeClient}: ${sourceLabel} → ${candidate.displayName}`;return <div key={candidate.clientId}><span>{candidate.displayName} · {candidate.reasons.map(reason=>ui.mergeReasons[reason as keyof typeof ui.mergeReasons]||reason).join(", ")}</span>{issue.details?.importedClientId&&<CrmButton tone="secondary" type="button" aria-label={mergeAccessibleName} disabled={merging===issue.id} onClick={()=>setPendingMerge({issue,candidate})}>{ui.mergeClient}</CrmButton>}</div>})}</article>)}</div>}{problemIssues.length>0&&<div className="keycrm-issues"><h3>{ui.issues}</h3>{problemIssues.map(issue=><article key={issue.id}><b>{issue.externalOrderId?`KeyCRM #${issue.externalOrderId}`:issue.code}</b><span>{ui.issueMessages[issue.code as keyof typeof ui.issueMessages]||issue.message}</span></article>)}</div>}</section>}
    <section className="settings-card"><h2>{ui.history}</h2>{runs.length===0?<p>{ui.noRuns}</p>:<div className="keycrm-history">{runs.map(run=><CrmButton tone="secondary" className={current?.id===run.id?"keycrm-history-selected":undefined} aria-pressed={current?.id===run.id} type="button" key={run.id} onClick={()=>void selectRun(run)}><span><b>{run.mode==="DRY_RUN"?ui.dryRun:ui.realRun}</b><small>{new Date(run.createdAt).toLocaleString("ru-RU")}{run.startedBy?` · ${run.startedBy.displayName}`:""}</small></span><span>{run.scannedCount} · {statusLabel(run.status)}</span></CrmButton>)}</div>}</section>
    {message&&<div className="settings-success" role="status">{message}</div>}{error&&<div className="phase2-error" role="alert">{error}</div>}
    <Modal opened={Boolean(pendingMerge)} onClose={()=>setPendingMerge(undefined)} title={ui.mergeDialogTitle} centered closeOnEscape={!merging} closeOnClickOutside={!merging} closeButtonProps={{ "aria-label": ui.close, disabled: Boolean(merging) }}>{pendingMerge&&(()=>{const sourceLabel=pendingMerge.issue.details?.keycrmBuyerId?`${ui.keycrmBuyer} #${pendingMerge.issue.details.keycrmBuyerId}`:`${ui.importedCard} ${pendingMerge.issue.details?.importedClientId||"—"}`,mergeAccessibleName=`${ui.mergeConfirm}: ${sourceLabel} → ${pendingMerge.candidate.displayName}`;return <><p>{ui.mergeDialogDescription}</p><dl className="keycrm-confirm-details"><div><dt>{ui.mergeSource}</dt><dd>{sourceLabel}</dd></div><div><dt>{ui.mergeTarget}</dt><dd>{pendingMerge.candidate.displayName}</dd></div></dl><div className="settings-actions"><CrmButton tone="secondary" type="button" onClick={()=>setPendingMerge(undefined)} disabled={Boolean(merging)}>{ui.cancel}</CrmButton><CrmButton type="button" aria-label={mergeAccessibleName} onClick={()=>void mergeSuggestedClient(pendingMerge.issue,pendingMerge.candidate)} disabled={Boolean(merging)}>{ui.mergeConfirm}</CrmButton></div></>})()}</Modal>
    <Modal opened={rollbackOpen} onClose={()=>setRollbackOpen(false)} title={ui.rollbackDialogTitle} centered closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ "aria-label": ui.close, disabled: busy }}><p>{ui.rollbackConsequences}</p><dl className="keycrm-confirm-details"><div><dt>{ui.rollbackRunId}</dt><dd>{current?.id||"—"}</dd></div></dl><div className="phase2-warning" role="note">{ui.rollbackAuditNotice}</div><div className="settings-actions"><CrmButton tone="secondary" type="button" onClick={()=>setRollbackOpen(false)} disabled={busy}>{ui.cancel}</CrmButton><CrmButton type="button" onClick={()=>void rollbackRun()} disabled={busy}>{ui.rollbackConfirmAction}</CrmButton></div></Modal>
  </div>
}
type SettingsSection = "account" | "finance" | "communications" | "keycrm" | "ai" | "production" | "interface";
export function SettingsWorkspace({role}:{role:string}) {
  const [section, setSection] = useState<SettingsSection>(
    role==="OWNER"?"account":"finance",
  );
  const tabs: CrmTab[] = [
    ...(role==="OWNER"?[{value:"account",label:settingsUi.accountTab,panelId:"settings-account-panel",tabId:"settings-account-tab"}]:[]),
    {value:"finance",label:settingsUi.finance,panelId:"settings-finance-panel",tabId:"settings-finance-tab"},
    {value:"communications",label:settingsUi.communications,panelId:"settings-communications-panel",tabId:"settings-communications-tab"},
    ...((role==="OWNER"||role==="ADMIN")?[{value:"keycrm",label:settingsUi.keycrmTab,panelId:"settings-keycrm-panel",tabId:"settings-keycrm-tab"}]:[]),
    {value:"ai",label:settingsUi.aiTab,panelId:"settings-ai-panel",tabId:"settings-ai-tab"},
    ...((role==="OWNER"||role==="ADMIN")?[{value:"production",label:settingsUi.production,panelId:"settings-production-panel",tabId:"settings-production-tab"},{value:"interface",label:settingsUi.interface,panelId:"settings-interface-panel",tabId:"settings-interface-tab"}]:[]),
    {value:"orders",label:settingsUi.orders,disabled:true,title:settingsUi.comingSoon},
    {value:"shipping",label:settingsUi.shipping,disabled:true,title:settingsUi.comingSoon},
  ];
  return (
    <div className="settings-page">
      <header className="phase2-header">
        <div>
          <p>{settingsUi.eyebrow}</p>
          <h1>{settingsUi.title}</h1>
          <span>{settingsUi.subtitle}</span>
        </div>
      </header>
      <CrmTabList className="settings-tabs" ariaLabel={settingsUi.title} value={section} onChange={value=>setSection(value as SettingsSection)} tabs={tabs}/>
      {section === "account"&&role==="OWNER" ? (
        <AccountSettings />
      ) : section === "finance" ? (
        <FinanceSettings canManageExchangeRates={role==="OWNER"||role==="ADMIN"}/>
      ) : section === "communications" ? (
        <CommunicationsSettings />
      ) : section === "keycrm" ? (
        <KeycrmSettings />
      ) : section === "production" ? (
        <ProductionSettings />
      ) : section === "interface" ? (
        <BrandingSettings />
      ) : (
        <AiSettings />
      )}
    </div>
  );
}

type BrandingData={logoUrl:string|null;useInHeader:boolean;useInMessages:boolean};
function BrandingSettings(){
  const[data,setData]=useState<BrandingData>(),[file,setFile]=useState<File>(),[preview,setPreview]=useState(""),[saving,setSaving]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  useEffect(()=>{fetch("/api/branding",{credentials:"include"}).then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||settingsUi.brandingLoadError);setData(body)}).catch(reason=>setError((reason as Error).message))},[]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
  function pick(next?:File){if(preview)URL.revokeObjectURL(preview);setFile(undefined);setPreview("");setError("");if(!next)return;if(!["image/jpeg","image/png","image/webp"].includes(next.type)){setError(settingsUi.brandingTypeError);return}if(next.size>3*1024*1024){setError(settingsUi.brandingSizeError);return}setFile(next);setPreview(URL.createObjectURL(next))}
  async function persist(formElement:HTMLFormElement,removeLogo=false){if(!data)return;setSaving(true);setError("");setMessage("");try{const form=new FormData(formElement),body:Record<string,unknown>={useInHeader:Boolean(form.get("useInHeader")),useInMessages:Boolean(form.get("useInMessages")),removeLogo};if(file&&!removeLogo){body.name=file.name;body.mime=file.type;body.data=await brandingFileData(file)}const response=await fetch("/api/branding",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(Array.isArray(result.message)?result.message.join(", "):result.message||settingsUi.saveError);setData(result);pick(undefined);setMessage(settingsUi.brandingSaved);window.dispatchEvent(new Event("yoleotard-branding-changed"))}catch(reason){setError((reason as Error).message)}finally{setSaving(false)}}
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();await persist(event.currentTarget)}
  if(!data)return <section id="settings-interface-panel" role="tabpanel" aria-labelledby="settings-interface-tab" className="settings-card">{error?<div className="phase2-error" role="alert">{error}</div>:<p>{settingsUi.brandingLoading}</p>}</section>;
  return <section id="settings-interface-panel" role="tabpanel" aria-labelledby="settings-interface-tab" className="settings-card branding-settings"><h2>{settingsUi.brandingTitle}</h2><p>{settingsUi.brandingHint}</p><form onSubmit={event=>void save(event)}><div className="branding-logo-row"><div className="branding-logo-preview">{(preview||data.logoUrl)?<img src={preview||data.logoUrl||""} alt={settingsUi.brandingPreviewAlt}/>:<span>Y</span>}</div><div><label className="branding-file-button">{settingsUi.brandingChoose}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>pick(event.target.files?.[0])}/></label><small>{file?.name||settingsUi.brandingFileHint}</small>{(data.logoUrl||file)&&<CrmButton type="button" tone="secondary" disabled={saving} onClick={event=>{const form=event.currentTarget.form;if(form)void persist(form,true)}}>{settingsUi.brandingRemove}</CrmButton>}</div></div><div className="branding-uses"><CrmCheckbox name="useInHeader" defaultChecked={data.useInHeader} label={<span className="crm-checkbox-copy"><strong>{settingsUi.brandingHeader}</strong><small>{settingsUi.brandingHeaderHint}</small></span>}/><CrmCheckbox name="useInMessages" defaultChecked={data.useInMessages} label={<span className="crm-checkbox-copy"><strong>{settingsUi.brandingMessages}</strong><small>{settingsUi.brandingMessagesHint}</small></span>}/></div>{error&&<div className="phase2-error" role="alert">{error}</div>}{message&&<div className="settings-success" role="status">{message}</div>}<CrmButton type="submit" disabled={saving}>{saving?settingsUi.accountSaving:settingsUi.save}</CrmButton></form></section>
}
function brandingFileData(file:File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error(settingsUi.brandingReadError));reader.readAsDataURL(file)})}

function ProductionSettings() {
  const [settings,setSettings]=useState<Setting[]>([]),[loaded,setLoaded]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false),[correction,setCorrection]=useState<{matched:number;updated:number;orderNumbers:string[];candidates:{orderId:string;expectedUpdatedAt:string;expectedType:string;expectedProductionSlotUpdatedAt:string|null;expectedSourceId:string;expectedSourceName:string}[]}>({matched:0,updated:0,orderNumbers:[],candidates:[]}),[correctionChecked,setCorrectionChecked]=useState(false),[correcting,setCorrecting]=useState(false),[correctionConfirmOpen,setCorrectionConfirmOpen]=useState(false);
  async function request(init?:RequestInit,path="/api/finance/settings"){const r=await fetch(path,{credentials:"include",...init,headers:{"Content-Type":"application/json"}});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(Array.isArray(body.message)?body.message.join(", "):body.message||settingsUi.saveError);return body}
  useEffect(()=>{request().then(x=>{setSettings(x);setLoaded(true)}).catch(e=>setError((e as Error).message))},[]);
  const value=(key:string,fallback:number)=>{const current=settings.find(item=>item.section==="production"&&item.key===key)?.value;return typeof current==="number"?current:fallback};
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setError("");setMessage("");try{const form=new FormData(e.currentTarget),updated=await request({method:"PATCH",body:JSON.stringify({defaultDurationDays:Number(form.get("defaultDurationDays")),shippingLeadDays:Number(form.get("shippingLeadDays"))})},"/api/finance/settings/production");setSettings(updated);setMessage(settingsUi.saved)}catch(x){setError((x as Error).message)}finally{setSaving(false)}}
  async function correctWebsiteSales(dryRun:boolean){setCorrecting(true);setError("");try{const result=await request({method:"POST",body:JSON.stringify({dryRun,...(!dryRun?{candidates:correction.candidates}:{})})},"/api/orders/maintenance/website-sales");setCorrection(result);setCorrectionChecked(dryRun);if(!dryRun){setCorrectionChecked(false);setCorrectionConfirmOpen(false);setMessage(settingsUi.websiteSalesCorrectionDone.replace("{count}",String(result.updated)))}}catch(reason){setCorrectionChecked(false);setCorrectionConfirmOpen(false);setError((reason as Error).message)}finally{setCorrecting(false)}}
  return <section id="settings-production-panel" role="tabpanel" aria-labelledby="settings-production-tab" className="settings-card"><h2>{settingsUi.productionSettingsTitle}</h2><p>{settingsUi.productionSettingsHint}</p><form key={JSON.stringify(settings)} className="settings-grid" onSubmit={save}><CrmTextInput label={settingsUi.productionDuration} description={settingsUi.productionDurationHint} name="defaultDurationDays" type="number" min="1" max="90" defaultValue={value("defaultDurationDays",7)} disabled={!loaded} required/><CrmTextInput label={settingsUi.shippingLeadDays} description={settingsUi.shippingLeadDaysHint} name="shippingLeadDays" type="number" min="0" max="30" defaultValue={value("shippingLeadDays",2)} disabled={!loaded} required/><CrmButton type="submit" disabled={saving||!loaded}>{saving?settingsUi.accountSaving:settingsUi.save}</CrmButton></form><div className="settings-order-correction"><h3>{settingsUi.websiteSalesCorrectionTitle}</h3><p>{settingsUi.websiteSalesCorrectionHint}</p>{correctionChecked&&<div className="settings-success" role="status">{settingsUi.websiteSalesCorrectionFound.replace("{count}",String(correction.matched))}{correction.orderNumbers.length?` ${correction.orderNumbers.join(", ")}`:""}</div>}<div className="settings-actions"><CrmButton tone="secondary" type="button" disabled={correcting} onClick={()=>void correctWebsiteSales(true)}>{settingsUi.websiteSalesCorrectionCheck}</CrmButton><CrmButton color="red" type="button" disabled={correcting||!correctionChecked||correction.matched===0} onClick={()=>setCorrectionConfirmOpen(true)}>{settingsUi.websiteSalesCorrectionApply}</CrmButton></div></div>{error&&<div className="phase2-error" role="alert">{error}</div>}{message&&<div className="settings-success" role="status">{message}</div>}<Modal opened={correctionConfirmOpen} onClose={()=>!correcting&&setCorrectionConfirmOpen(false)} title={settingsUi.websiteSalesCorrectionConfirmTitle} centered closeOnClickOutside={!correcting} closeOnEscape={!correcting}><p>{settingsUi.websiteSalesCorrectionConfirmHint.replace("{count}",String(correction.matched))}</p>{correction.orderNumbers.length>0&&<p><strong>{correction.orderNumbers.join(", ")}</strong></p>}<div className="settings-actions"><CrmButton tone="secondary" disabled={correcting} onClick={()=>setCorrectionConfirmOpen(false)}>{settingsUi.websiteSalesCorrectionCancel}</CrmButton><CrmButton color="red" loading={correcting} onClick={()=>void correctWebsiteSales(false)}>{settingsUi.websiteSalesCorrectionApply}</CrmButton></div></Modal></section>
}

function AccountSettings(){
  const[currentEmail,setCurrentEmail]=useState(""),[newEmail,setNewEmail]=useState(""),[error,setError]=useState(""),[message,setMessage]=useState(""),[saving,setSaving]=useState(false);
  useEffect(()=>{fetch("/api/auth/me",{credentials:"include"}).then(async r=>{if(!r.ok)throw new Error();const x=await r.json();setCurrentEmail(x.user.email);setNewEmail(x.user.email)}).catch(()=>setError(settingsUi.accountLoadError))},[]);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setError("");setMessage("");const form=e.currentTarget,f=new FormData(form),newPassword=String(f.get("newPassword")||""),confirmPassword=String(f.get("confirmPassword")||"");if(newPassword!==confirmPassword){setError(settingsUi.accountMismatch);return}setSaving(true);try{const body:{currentPassword:string;email:string;newPassword?:string}={currentPassword:String(f.get("currentPassword")||""),email:String(f.get("email")||"")};if(newPassword)body.newPassword=newPassword;const r=await fetch("/api/auth/account",{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(Array.isArray(x.message)?x.message.join(", "):x.message||settingsUi.saveError);setCurrentEmail(x.user.email);setNewEmail(x.user.email);form.reset();setMessage(settingsUi.accountSaved);window.dispatchEvent(new Event("yoleotard-auth-changed"))}catch(x){setError((x as Error).message)}finally{setSaving(false)}}
  return <section id="settings-account-panel" role="tabpanel" aria-labelledby="settings-account-tab" className="settings-card">
    <h2>{settingsUi.accountTitle}</h2><p>{settingsUi.accountHint}</p>
    <form className="settings-grid" onSubmit={submit}>
      <CrmTextInput label={settingsUi.currentLogin} value={currentEmail} readOnly/>
      <CrmTextInput label={settingsUi.newLogin} name="email" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} autoComplete="username" required/>
      <CrmTextInput label={settingsUi.currentPassword} name="currentPassword" type="password" autoComplete="current-password" minLength={8} required/>
      <CrmTextInput label={settingsUi.newPassword} name="newPassword" type="password" autoComplete="new-password" minLength={8}/>
      <CrmTextInput label={settingsUi.confirmPassword} description={settingsUi.accountPasswordHint} name="confirmPassword" type="password" autoComplete="new-password" minLength={8}/>
      {error&&<div className="phase2-error" role="alert">{error}</div>}{message&&<div className="settings-success" role="status">{message}</div>}
      <CrmButton type="submit" disabled={saving}>{saving?settingsUi.accountSaving:settingsUi.accountSave}</CrmButton>
    </form>
  </section>
}
function FinanceSettings({canManageExchangeRates}:{canManageExchangeRates:boolean}) {
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
    <div id="settings-finance-panel" role="tabpanel" aria-labelledby="settings-finance-tab">
      <form
        key={JSON.stringify(settings)}
        className="settings-card"
        onSubmit={save}
        aria-busy={saving}
      >
        <h2>{settingsUi.financeInvoices}</h2>
        <p>{settingsUi.financeHint}</p>
        <div className="settings-grid">
          <CrmTextInput label={settingsUi.invoicePrefix} name="invoicePrefix" defaultValue={value("invoicePrefix", "INV-YO")}/>
          <CrmNativeSelect label={settingsUi.defaultCurrency} name="defaultCurrency" defaultValue={value("defaultCurrency", "EUR")} data={["EUR","USD","UAH"]}/>
          <CrmTextInput label={settingsUi.sellerName} name="sellerName" defaultValue={value("sellerName", "Yoleotard")}/>
          <CrmTextarea label={settingsUi.sellerDetails} name="sellerAddress" defaultValue={value("sellerAddress", settingsUi.defaultCountry)}/>
          <CrmTextInput label={settingsUi.defaultDeposit} name="depositPercent" type="number" min="0" max="100" defaultValue={value("depositPercent", "50")}/>
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
        <CrmButton type="submit" disabled={saving}>
          {settingsUi.save}
        </CrmButton>
      </form>
      <ExchangeRateSettings canManage={canManageExchangeRates}/>
      <section className="settings-card muted-card">
        <h2>{settingsUi.otherSections}</h2>
        <p>{settingsUi.otherHint}</p>
      </section>
    </div>
  );
}

type ExchangeRateData={provider:"ECB"|"NBU";officialUrl:string;supportedPairs:readonly string[];cache:null|{effectiveDate:string;fetchedAt:string;rates:Array<{baseCurrency:string;quoteCurrency:string;decimal:string}>}};
function ExchangeRateSettings({canManage}:{canManage:boolean}){
  const[data,setData]=useState<ExchangeRateData>(),[provider,setProvider]=useState<"ECB"|"NBU">("NBU"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  async function request(path:string,init?:RequestInit){const response=await fetch(`/api${path}`,{credentials:"include",...init,headers:{"Content-Type":"application/json",...init?.headers}});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(Array.isArray(body.message)?body.message.join(", "):body.message||settingsUi.saveError)}return response.json() as Promise<ExchangeRateData>}
  async function load(){const value=await request("/finance/exchange-rates");setData(value);setProvider(value.provider)}
  useEffect(()=>{load().catch(reason=>setError((reason as Error).message))},[]);
  async function saveProvider(){setBusy(true);setError("");setMessage("");try{const value=await request("/finance/exchange-rates/settings",{method:"PATCH",body:JSON.stringify({provider})});setData(value);setMessage(settingsUi.exchangeRates.providerSaved)}catch(reason){setError((reason as Error).message)}finally{setBusy(false)}}
  async function refresh(){setBusy(true);setError("");setMessage("");try{const value=await request("/finance/exchange-rates/refresh",{method:"POST"});setData(value);setProvider(value.provider);setMessage(settingsUi.exchangeRates.refreshed)}catch(reason){setError((reason as Error).message)}finally{setBusy(false)}}
  return <section className="settings-card" aria-busy={!data||busy}><h2>{settingsUi.exchangeRates.title}</h2><p>{settingsUi.exchangeRates.hint}</p><div className="settings-grid"><CrmNativeSelect label={settingsUi.exchangeRates.provider} value={provider} disabled={!data||busy||!canManage} onChange={event=>setProvider(event.target.value as "ECB"|"NBU")} data={[{value:"NBU",label:settingsUi.exchangeRates.nbu},{value:"ECB",label:settingsUi.exchangeRates.ecb}]}/><div><strong>{settingsUi.exchangeRates.supportedPairs}</strong><p>{(data?.supportedPairs||[]).join(", ")||"—"}</p></div></div><p>{settingsUi.exchangeRates.providerWarning}</p>{!canManage&&<p className="settings-inline-note">{settingsUi.exchangeRates.readOnly}</p>}{data&&<p><a href={data.officialUrl} target="_blank" rel="noreferrer">{settingsUi.exchangeRates.officialSource}</a>{data.cache?` · ${settingsUi.exchangeRates.effectiveDate}: ${new Intl.DateTimeFormat("ru-RU").format(new Date(`${data.cache.effectiveDate}T00:00:00Z`))}`:` · ${settingsUi.exchangeRates.notLoaded}`}</p>}{data?.cache&&<div className="settings-grid">{data.cache.rates.map(rate=><span key={`${rate.baseCurrency}-${rate.quoteCurrency}`}><strong>1 {rate.baseCurrency}</strong> = {rate.decimal} {rate.quoteCurrency}</span>)}</div>}{error&&<div className="phase2-error" role="alert">{error}</div>}{message&&<div className="settings-success" role="status">{message}</div>}{canManage&&<div className="settings-actions"><CrmButton tone="secondary" type="button" disabled={!data||busy||provider===data.provider} onClick={()=>void saveProvider()}>{settingsUi.exchangeRates.saveProvider}</CrmButton><CrmButton type="button" disabled={!data||busy||provider!==data.provider} onClick={()=>void refresh()}>{busy?settingsUi.exchangeRates.refreshing:settingsUi.exchangeRates.refresh}</CrmButton></div>}</section>
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
  async function update(key:string,value:unknown,globalOnly=false){setError("");setSaved("");const scopedChannel=globalOnly?"":channel;const response=await fetch("/api/ai-control/settings",{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({key,value,scope:scopedChannel?"CHANNEL":"GLOBAL",...(scopedChannel?{scopeId:scopedChannel}:{})})});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||settingsUi.aiControl.saveError)}await load();setSaved(settingsUi.aiControl.saved)}
  if(!data)return <section className="settings-card" aria-busy={!error}><h2>{settingsUi.aiControl.title}</h2>{error?<div className="phase2-error" role="alert">{error}</div>:<p>{settingsUi.aiLoading}</p>}</section>;
  const labels=settingsUi.aiControl.labels as Record<string,string>,effective=data.effective,disabled=data.effective.serverBlocked;
  const toggle=(key:string,forcedDisabled=false)=><CrmCheckbox key={key} className="settings-check" checked={Boolean(effective[key])} disabled={disabled||forcedDisabled} onChange={event=>update(key,event.target.checked).catch(e=>setError((e as Error).message))} label={<span><strong>{labels[key]}</strong>{(forcedDisabled||disabled)&&<small>{disabled?settingsUi.aiControl.disabledByServer:settingsUi.aiControl.policyDisabled}</small>}</span>}/>;
  return <div className="settings-ai-control">
    <section className="settings-card"><h2>{settingsUi.aiControl.title}</h2><p>{settingsUi.aiControl.hint}</p><div className={disabled?"phase2-warning":"settings-success"}>{disabled?settingsUi.aiControl.disabledByServer:settingsUi.aiControl.serverPolicy}</div><div className="settings-grid"><strong>{settingsUi.aiControl.global}: {effective.masterEnabled?settingsUi.aiControl.stateLabels.on:settingsUi.aiControl.stateLabels.off}</strong><strong>{settingsUi.aiControl.mode}: {settingsUi.aiControl.modeLabels[effective.mode as keyof typeof settingsUi.aiControl.modeLabels]||effective.mode}</strong><span>{settingsUi.aiControl.provider}: {data.serverPolicy.provider}</span><span>{settingsUi.aiControl.model}: {data.serverPolicy.analysisModel}</span><span>{settingsUi.aiControl.worker}: {data.worker.running?settingsUi.aiControl.running:settingsUi.aiControl.stopped}</span><span>{settingsUi.aiControl.outbox}: {data.outbox.status==="healthy"?settingsUi.aiControl.healthy:settingsUi.aiControl.warning}</span><span>{settingsUi.aiControl.autoReplies}: {settingsUi.aiControl.stateLabels.off}</span><span>{settingsUi.aiControl.lastRun}: {data.lastSuccessfulRun?new Date(data.lastSuccessfulRun).toLocaleString("ru-RU"):settingsUi.aiControl.never}</span></div></section>
    <section className="settings-card"><h3>{summaryFormatUi.title}</h3><p>{summaryFormatUi.hint}</p><CrmNativeSelect label={summaryFormatUi.title} value={String(effective.summaryDetailLevel||"DETAILED")} data={[{value:"COMPACT",label:summaryFormatUi.compact},{value:"DETAILED",label:summaryFormatUi.detailed}]} onChange={event=>update("summaryDetailLevel",event.target.value,true).catch(e=>setError((e as Error).message))}/></section>
    <section className="settings-card"><CrmNativeSelect label={settingsUi.aiControl.channel} value={channel} onChange={event=>setChannel(event.target.value)} data={[{value:"",label:settingsUi.aiControl.globalScope},...(["INSTAGRAM","FACEBOOK","WHATSAPP","EMAIL"] as const).map(value=>({value,label:settingsUi.aiControl.channelLabels[value]}))]}/>{toggle("masterEnabled")}<CrmNativeSelect label={settingsUi.aiControl.operatingMode} value={String(effective.mode)} disabled={disabled} onChange={event=>update("mode",event.target.value).catch(e=>setError((e as Error).message))} data={[{value:"OFF",label:settingsUi.aiControl.modeLabels.OFF},{value:"SHADOW",label:settingsUi.aiControl.modeLabels.SHADOW},...(["ASSIST","AUTO_SAFE","AGENT","AUTONOMOUS"] as const).map(value=>({value,label:`${settingsUi.aiControl.modeLabels[value]} — ${settingsUi.aiControl.policyDisabled}`,disabled:true}))]}/><CrmNativeSelect label={settingsUi.aiControl.rollout} value={String(Number(effective.rolloutPercentage||0))} disabled={disabled} onChange={event=>update("rolloutPercentage",Number(event.target.value)).catch(e=>setError((e as Error).message))} data={[0,10,25,50,100].map(value=>({value:String(value),label:`${value}%`}))}/></section>
    {AI_CONTROL_GROUPS.map(([title,keys])=><section className="settings-card" key={title}><h3>{settingsUi.aiControl[title]}</h3><div className="settings-ai-switches">{keys.map(key=>toggle(key,["autoPromoteMemories","autoConfirmAgreements","autoReplies"].includes(key)))}</div></section>)}
    <section className="settings-card"><h3>{settingsUi.aiControl.actions}</h3><div className="settings-grid">{settingsUi.aiControl.actionNames.map((name,index)=><div key={name}><strong>{name}</strong><small>{index<5?settingsUi.aiControl.readOnly:index<8?settingsUi.aiControl.approvalRequired:settingsUi.aiControl.disabled}</small></div>)}</div><p>{settingsUi.aiControl.policyDisabled}</p></section>
    <section className="settings-card"><h3>{settingsUi.aiControl.limits}</h3><div className="settings-grid">{Object.entries(settingsUi.aiControl.limitNames).map(([key,name])=>{const definition=(data as AiControlData&{definitions?:Record<string,{min:number;max:number;writable?:boolean}>}).definitions?.[key];return <CrmTextInput key={key} label={name} description={definition?.writable===false?settingsUi.aiControl.policyDisabled:undefined} type="number" min={definition?.min} max={definition?.max} defaultValue={Number(effective[key]||definition?.min||1)} disabled={disabled||definition?.writable===false} onBlur={event=>update(key,Number(event.target.value)).catch(e=>setError((e as Error).message))}/>})}</div></section>
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
        aria-labelledby="settings-ai-tab"
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
    <div id="settings-ai-panel" role="tabpanel" aria-labelledby="settings-ai-tab" className="settings-ai-panel">
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
        <CrmCheckbox className="settings-check" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} label={<span><strong>{settingsUi.aiEnabled}</strong></span>}/>
        <CrmCheckbox className="settings-check settings-consent" name="allowClientContext" checked={consent} onChange={(e) => setConsent(e.target.checked)} label={<span><strong>{settingsUi.aiConsent}</strong><small>{settingsUi.aiConsentHint}</small></span>}/>
      </div>
      <div className="settings-grid">
        <CrmTextInput className="settings-wide" label={settingsUi.aiToken} name="apiKey" type="password" autoComplete="new-password" placeholder={settingsUi.aiTokenPlaceholder} description={<>
            {data.apiKeySource === "settings"
              ? settingsUi.aiTokenSaved
              : data.apiKeySource === "environment"
                ? settingsUi.aiTokenEnvironment
                : settingsUi.aiTokenMissing}
            {" · "}
            {settingsUi.aiTokenHint}
          </>}/>
        <CrmNativeSelect label={settingsUi.aiModel} name="model" defaultValue={data.model} required data={AI_MODEL_OPTIONS.map(model=>({value:model,label:model}))}/>
        <CrmTextInput label={settingsUi.aiLanguage} name="defaultLanguage" defaultValue={data.defaultLanguage} required/>
        <CrmTextInput label={settingsUi.aiTone} name="tone" defaultValue={data.tone} required/>
        <CrmTextarea className="settings-wide" label={settingsUi.aiInstructions} name="systemPrompt" defaultValue={data.systemPrompt}/>
      </div>
      {saved && (
        <div className="settings-success" role="status">
          {settingsUi.aiSaved}
        </div>
      )}
      {error && <div className="phase2-error" role="alert">{error}</div>}
      <div className="settings-ai-actions">
        <CrmButton type="submit" disabled={saving}>
          {saving ? settingsUi.aiSaving : settingsUi.aiSave}
        </CrmButton>
        {data.connected && <CrmButton tone="secondary" type="button" disabled={saving} onClick={removeToken}>{settingsUi.aiDeleteToken}</CrmButton>}
      </div>
      </form>
    </div>
  );
}
