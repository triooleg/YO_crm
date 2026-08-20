"use client";
import { FormEvent, useEffect, useState } from "react";
import { settingsUi } from "../lib/i18n";
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
type IntegrationData = {
  deliveryAvailable: boolean;
  meta: {
    enabled: boolean;
    status: string;
    appId: string;
    pageId: string;
    instagramAccountId: string;
    whatsappPhoneNumberId: string;
    appSecretConfigured: boolean;
    verifyTokenConfigured: boolean;
    pageAccessTokenConfigured: boolean;
    whatsappAccessTokenConfigured: boolean;
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
    username: string;
    fromAddress: string;
    passwordConfigured: boolean;
  };
};
function Secret({ name, label, saved }: { name: string; label: string; saved: boolean }) {
  return <label>{label}<input name={name} type="password" autoComplete="new-password" placeholder={saved ? settingsUi.secretSaved : settingsUi.secretNotSaved}/></label>;
}
function CommunicationsSettings() {
  const [data, setData] = useState<IntegrationData>(),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<"meta" | "chatwoot" | "email" | null>(null),
    [saving, setSaving] = useState(false);
  async function load() {
    const r = await fetch("/api/communications/integrations", {
      credentials: "include",
    });
    if (!r.ok) throw new Error(settingsUi.channelsLoadError);
    setData(await r.json());
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
              username: f.get("username"),
              password: f.get("password"),
              fromAddress: f.get("fromAddress"),
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
    const f=new FormData(e.currentTarget),body={enabled:f.get("enabled")==="on",appId:f.get("appId"),pageId:f.get("pageId"),instagramAccountId:f.get("instagramAccountId"),whatsappPhoneNumberId:f.get("whatsappPhoneNumberId"),appSecret:f.get("appSecret"),verifyToken:f.get("verifyToken"),pageAccessToken:f.get("pageAccessToken"),whatsappAccessToken:f.get("whatsappAccessToken")};
    try{const r=await fetch("/api/communications/meta/settings",{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error(settingsUi.channelsSaveError);await load();setSaved("meta")}catch(x){setError((x as Error).message)}finally{setSaving(false)}
  }
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
    value === "CONFIGURED" ? settingsUi.configured : settingsUi.notConnected;
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
        <h2>{settingsUi.metaTitle} · {status(data.meta.status)}</h2>
        <p>{settingsUi.metaHint}</p>
        <label className="settings-channel-toggle"><input name="enabled" type="checkbox" defaultChecked={data.meta.enabled}/>{settingsUi.channelEnabled}</label>
        <div className="settings-grid">
          <label>{settingsUi.metaWebhook}<input value={data.meta.webhookUrl} readOnly/></label>
          <label>{settingsUi.metaAppId}<input name="appId" defaultValue={data.meta.appId}/></label>
          <label>{settingsUi.metaPageId}<input name="pageId" defaultValue={data.meta.pageId}/></label>
          <label>{settingsUi.metaInstagramId}<input name="instagramAccountId" defaultValue={data.meta.instagramAccountId}/></label>
          <label>{settingsUi.metaWhatsappId}<input name="whatsappPhoneNumberId" defaultValue={data.meta.whatsappPhoneNumberId}/></label>
          <Secret name="appSecret" label={settingsUi.metaAppSecret} saved={data.meta.appSecretConfigured}/>
          <Secret name="verifyToken" label={settingsUi.metaVerifyToken} saved={data.meta.verifyTokenConfigured}/>
          <Secret name="pageAccessToken" label={settingsUi.metaPageToken} saved={data.meta.pageAccessTokenConfigured}/>
          <Secret name="whatsappAccessToken" label={settingsUi.metaWhatsappToken} saved={data.meta.whatsappAccessTokenConfigured}/>
        </div>
        {saved==="meta"&&<div className="settings-success" role="status">{settingsUi.saved}</div>}
        <button className="phase2-primary" disabled={saving}>{settingsUi.save}</button>
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
              defaultValue={data.email.smtpPort}
            />
          </label>
          <label>
            {settingsUi.username}
            <input name="username" defaultValue={data.email.username} />
          </label>
          <label>
            {settingsUi.password}
            <input
              name="password"
              type="password"
              autoComplete="new-password"
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
              defaultValue={data.email.fromAddress}
            />
          </label>
        </div>
        {saved === "email" && (
          <div className="settings-success" role="status">
            {settingsUi.saved}
          </div>
        )}
        <button className="phase2-primary" disabled={saving}>
          {settingsUi.save}
        </button>
      </form>
    </section>
  );
}
export function SettingsWorkspace() {
  const [section, setSection] = useState<"finance" | "communications" | "ai">(
    "finance",
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
        {(["orders", "production", "shipping", "interface"] as const).map(
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
      {section === "finance" ? (
        <FinanceSettings />
      ) : section === "communications" ? (
        <CommunicationsSettings />
      ) : (
        <AiSettings />
      )}
    </div>
  );
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
    <form
      id="settings-ai-panel"
      role="tabpanel"
      className="settings-card settings-ai-card"
      onSubmit={submit}
      aria-busy={saving}
    >
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
          <input name="model" defaultValue={data.model} required />
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
  );
}
