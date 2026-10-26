"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Alert, Group } from "@mantine/core";
import { MeasurementPanel } from "./measurement-panel";
import { OrderPanel } from "./order-panel";
import { MeasurementViewer, type MeasurementView } from "./measurement-viewer";
import { clientAthleteUi, clientMergeUi, clientWorkspaceUi, overviewContextUi } from "../lib/i18n";
import { orderLabel } from "../lib/orders-i18n";
import { orderDisplayNumber } from "../lib/order-source";
import { ClientAvatar } from "./client-avatar";
import { CrmActionIcon, CrmButton, CrmNativeSelect, CrmTextInput } from "./crm/settings-controls";
import { CrmTabList } from "./crm/tab-list";

type Client = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  status?: string;
  files?: {id:string;name:string;path:string;sizeBytes:number;createdAt:string}[];
  country?: string;
  city?: string;
  phone?: string;
  email?: string;
  instagram?: string;
  whatsapp?: string;
  telegram?: string;
  language?: string;
  athletes: Athlete[];
  orders: Order[];
  activities: Activity[];
};
type Athlete = {
  id: string;
  firstName: string;
  lastName?: string;
  discipline?: string;
  measurements: MeasurementView[];
};
type Order = {
  id: string;
  number: string;
  sourceSystem?:string;
  externalNumber?:string|null;
  externalId?:string|null;
  salesStatus: string;
  priceMinor: number;
  currency: string;
  modelImagePath?: string;
};
type Activity = { id: string; summary: string; createdAt: string };
type MergeReasonCode=keyof typeof clientMergeUi.reasonLabels;
type MergeSuggestion = Client & { reasons:MergeReasonCode[]; channels:string[] };
function mergeReasonLabel(reason:MergeReasonCode){return clientMergeUi.reasonLabels[reason]}
function mergeErrorLabel(reason:unknown){const code=reason instanceof Error?reason.message:"";return clientMergeUi.errors[code as keyof typeof clientMergeUi.errors]||clientMergeUi.errorFallback}
function mergeChannelLabel(channel:string){return clientMergeUi.channelLabels[channel as keyof typeof clientMergeUi.channelLabels]||clientMergeUi.channelFallback}

export function ClientWorkspace({onNavigate}:{onNavigate?:(section:"orders")=>void}={}) {
  const addAthleteTriggerRef = useRef<HTMLButtonElement>(null);
  const createClientTriggerRef = useRef<HTMLButtonElement>(null);
  const mergeTriggerRef = useRef<HTMLButtonElement>(null);
  const mergeDialogRef = useRef<HTMLElement>(null);
  const mergeSelectRef = useRef<HTMLSelectElement>(null);
  const mergeBusyRef = useRef(false);
  const detailRequestId=useRef(0);
  const listRequestId=useRef(0);
  const [createdPeriod,setCreatedPeriod]=useState(()=>{
    const period=typeof window==="undefined"?null:new URLSearchParams(window.location.search).get("period");
    return period&&/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(period)?period:"";
  });
  const initialClientId=useRef(typeof window==="undefined"?undefined:new URLSearchParams(window.location.search).get("clientId")||undefined);
  const initialOrderId=useRef(typeof window==="undefined"?undefined:new URLSearchParams(window.location.search).get("orderId")||undefined);
  const pendingOrderClientId=useRef(typeof window==="undefined"?undefined:(()=>{const params=new URLSearchParams(window.location.search);return params.get("action")==="new-order"?params.get("clientId")||undefined:undefined})());
  const [auth, setAuth] = useState<boolean | null>(null),
    [clients, setClients] = useState<Client[]>([]),
    [selected, setSelected] = useState<string>(),
    [detail, setDetail] = useState<Client>(),
    [search, setSearch] = useState(""),
    [collapsed, setCollapsed] = useState(false),
    [creating, setCreating] = useState(false),
    [addingAthlete, setAddingAthlete] = useState(false),
    [measuring, setMeasuring] = useState(false),
    [ordering, setOrdering] = useState(false),
    [mergeOpen,setMergeOpen]=useState(false),
    [mergeSuggestions,setMergeSuggestions]=useState<MergeSuggestion[]>([]),
    [mergeSourceId,setMergeSourceId]=useState(""),
    [mergeBusy,setMergeBusy]=useState(false),
    [error, setError] = useState("");
  mergeBusyRef.current=mergeBusy;
  async function request(path: string, init?: RequestInit) {
    const r = await fetch(`/api${path}`, {
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json" },
    });
    if (r.status === 401) {
      setAuth(false);
      throw new Error("Требуется вход");
    }
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      throw new Error(b.message ?? "Не удалось выполнить запрос");
    }
    return r.json();
  }
  async function load(q = "") {
    const requestId=++listRequestId.current;
    const query=new URLSearchParams();if(q)query.set("search",q);if(createdPeriod)query.set("period",createdPeriod);
    let data:Client[];
    try{data=await request(`/clients${query.size?`?${query}`:""}`)}catch(reason){if(requestId===listRequestId.current)throw reason;return}
    if(requestId!==listRequestId.current)return;
    if(createdPeriod)setError("");
    setClients(data);
    setAuth(true);
    if (!selected && data[0]) setSelected(pendingOrderClientId.current||initialClientId.current||data[0].id);
  }
  useEffect(() => {
    let cancelled=false;
    request("/auth/me")
      .then(async () => {
        if(cancelled)return;
        try{await load()}catch(reason){if(!cancelled){if(!createdPeriod){setAuth(false);return}setAuth(current=>current===false?false:true);setError((reason as Error).message)}}
      })
      .catch(() => {if(!cancelled)setAuth(false)});
    return()=>{cancelled=true;listRequestId.current++};
  }, []);
  useEffect(() => {
    if (!auth) return;
    const t = setTimeout(
      () => load(search).catch((e) => setError(e.message)),
      250,
    );
    return () => {clearTimeout(t);listRequestId.current++};
  }, [search, auth, createdPeriod]);
  function clearCreatedPeriod(){
    listRequestId.current++;setCreatedPeriod("");setError("");
    const url=new URL(window.location.href);url.searchParams.delete("period");
    window.history.replaceState(null,"",`${url.pathname}${url.search}${url.hash}`);
  }
  useEffect(() => {
    const requestId=++detailRequestId.current;
    setDetail(undefined);setMergeSuggestions([]);setMergeSourceId("");setMergeOpen(false);
    if (!selected || !auth) {
      setDetail(undefined);
      return;
    }
    const contextOrderId=selected===initialClientId.current?initialOrderId.current:undefined;
    request(`/clients/${selected}${contextOrderId?`?orderId=${encodeURIComponent(contextOrderId)}`:""}`)
      .then(value=>{if(requestId!==detailRequestId.current)return;if(contextOrderId&&!value.orders.some((order:Order)=>order.id===contextOrderId)){setError(clientWorkspaceUi.contextOrderUnavailable);initialOrderId.current=undefined;clearClientContextAction()}setDetail(value);if(pendingOrderClientId.current===value.id){pendingOrderClientId.current=undefined;setOrdering(true);clearClientContextAction()}})
      .catch((e) => {if(requestId===detailRequestId.current){if(selected===initialClientId.current){setError(clientWorkspaceUi.contextClientUnavailable);initialClientId.current=undefined;initialOrderId.current=undefined;clearClientContextAction()}else setError(e.message)}});
    request(`/clients/${selected}/merge-suggestions`).then(value=>{if(requestId===detailRequestId.current)setMergeSuggestions(value)}).catch(()=>{if(requestId===detailRequestId.current)setMergeSuggestions([])});
  }, [selected, auth]);
  useEffect(()=>{
    if(!mergeOpen)return;
    mergeSelectRef.current?.focus();
    function keydown(event:KeyboardEvent){
      if(event.key==="Escape"&&!mergeBusyRef.current){event.preventDefault();setMergeOpen(false);return}
      if(event.key!=="Tab"||!mergeDialogRef.current)return;
      const controls=[...mergeDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href]')];
      if(!controls.length)return;
      const first=controls[0]!,last=controls[controls.length-1]!;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
    document.addEventListener("keydown",keydown);
    return()=>{document.removeEventListener("keydown",keydown);mergeTriggerRef.current?.focus()};
  },[mergeOpen]);
  async function mergeClient(){
    if(!detail||detail.id!==selected||!mergeSourceId)return;
    const mergeRequestId=detailRequestId.current,mergeTargetId=selected;
    setMergeBusy(true);setError("");
    try{await request(`/clients/${mergeTargetId}/merge`,{method:"POST",body:JSON.stringify({sourceClientId:mergeSourceId})});setMergeOpen(false);setMergeSourceId("");await load(search);const value=await request(`/clients/${mergeTargetId}`);if(mergeRequestId===detailRequestId.current)setDetail(value);request(`/clients/${mergeTargetId}/merge-suggestions`).then(suggestions=>{if(mergeRequestId===detailRequestId.current)setMergeSuggestions(suggestions)}).catch(()=>{if(mergeRequestId===detailRequestId.current)setMergeSuggestions([])})}catch(reason){if(mergeRequestId===detailRequestId.current)setError(mergeErrorLabel(reason))}finally{setMergeBusy(false)}
  }
  if (auth === null) return <div className="phase2-loading">Загрузка CRM…</div>;
  if (!auth)
    return (
      <Login
        onSuccess={() => {
          setAuth(true);
          load().catch((e) => setError(e.message));
        }}
      />
    );
  return (
    <main className={`phase2-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="phase2-nav">
        <div className="phase2-brand">
          <span>Y</span>
          <div>
            <strong>Yoleotard</strong>
            <small>CRM</small>
          </div>
        </div>
        {[
          "Обзор",
          "Входящие",
          "Клиенты",
          "Заказы",
          "Производство",
          "Финансы",
          "Доставка",
          "Задачи",
        ].map((x) => (
          <button
            className={x === "Клиенты" ? "active" : ""}
            onClick={() => x === "Заказы" && onNavigate?.("orders")}
            key={x}
          >
            {x}
          </button>
        ))}
      </aside>
      <section className="phase2-main">
        <header className="phase2-header">
          <div>
            <p>РАБОТА С КЛИЕНТАМИ</p>
            <h1>Клиенты</h1>
            <span>Контакты, спортсмены, заказы и вся история работы</span>
          </div>
          <div className="phase2-card-actions phase2-client-header-actions">
            <CrmButton tone="secondary" ref={mergeTriggerRef} disabled={!detail||detail.id!==selected} onClick={()=>{if(detail?.id===selected)setMergeOpen(true)}}>{clientMergeUi.action}{mergeSuggestions.length?` · ${mergeSuggestions.length} ${clientMergeUi.suggestionBadge}`:""}</CrmButton>
            <CrmButton ref={createClientTriggerRef} onClick={() => setCreating(true)}>+ Новый клиент</CrmButton>
          </div>
        </header>
        {createdPeriod&&<Alert role="status" color="violet"><Group justify="space-between"><span>{overviewContextUi.clientsCreatedPeriod}: {new Intl.DateTimeFormat("ru-RU",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${createdPeriod}-01T12:00:00Z`)).replace(/\s?г\.$/,"")}</span><CrmButton tone="secondary" onClick={clearCreatedPeriod}>{overviewContextUi.clearPeriod}</CrmButton></Group></Alert>}
        {error && (
          <div className="phase2-error">
            {error}
            <button onClick={() => setError("")}>Закрыть</button>
          </div>
        )}
        <div className="phase2-workspace">
          <section className="phase2-list">
            <div className="phase2-list-tools">
              {!collapsed && (
                <CrmTextInput
                  className="phase2-client-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Имя, телефон, Instagram…"
                />
              )}
              <CrmActionIcon
                aria-label={collapsed ? clientWorkspaceUi.expandList : clientWorkspaceUi.collapseList}
                onClick={() => setCollapsed((v) => !v)}
              >
                {collapsed ? "›" : "‹"}
              </CrmActionIcon>
            </div>
            {clients.map((c) => (
              <button
                className={`phase2-client ${selected === c.id ? "selected" : ""}`}
                key={c.id}
                onClick={() => setSelected(c.id)}
              >
                <ClientAvatar className="phase2-avatar" displayName={c.displayName} avatarUrl={c.avatarUrl} />
                {!collapsed && (
                  <span>
                    <strong>{c.displayName}</strong>
                    <small>
                      {c.country || channel(c) || "Контакты не указаны"}
                    </small>
                  </span>
                )}
              </button>
            ))}
            {!clients.length && !collapsed && (
              <div className="phase2-empty">Клиенты не найдены</div>
            )}
          </section>
          <Card
            detail={detail}
          focusedOrderId={initialOrderId.current}
          onMeasure={() => setMeasuring(true)}
          onOrder={() => setOrdering(true)}
          onAddAthlete={() => setAddingAthlete(true)}
          addAthleteTriggerRef={addAthleteTriggerRef}
          />
        </div>
      </section>
      {creating && (
        <Create
          request={request}
          returnFocusRef={createClientTriggerRef}
          close={() => setCreating(false)}
          done={(c) => {
            setCreating(false);
            load().then(() => setSelected(c.id));
          }}
        />
      )}
      {mergeOpen&&detail&&<div className="phase2-overlay"><section ref={mergeDialogRef} className="phase2-modal" role="dialog" aria-modal="true" aria-labelledby="client-merge-title"><div><h2 id="client-merge-title">{clientMergeUi.title}</h2><CrmActionIcon type="button" aria-label={clientAthleteUi.close} disabled={mergeBusy} onClick={()=>setMergeOpen(false)}>×</CrmActionIcon></div><p>{clientMergeUi.hint}</p>{!mergeSuggestions.length&&<p>{clientMergeUi.noSuggestions}</p>}<CrmNativeSelect ref={mergeSelectRef} label={clientMergeUi.source} value={mergeSourceId} onChange={event=>setMergeSourceId(event.target.value)} data={[{value:"",label:clientMergeUi.choose},...[...mergeSuggestions,...clients.filter(client=>client.id!==detail.id&&!mergeSuggestions.some(item=>item.id===client.id)).map(client=>({...client,reasons:[],channels:[]} as MergeSuggestion))].map(candidate=>({value:candidate.id,label:`${candidate.displayName}${candidate.reasons.length?` — ${candidate.reasons.map(mergeReasonLabel).join(", ")}`:""}`}))]}/>{mergeSourceId&&mergeSuggestions.find(item=>item.id===mergeSourceId)&&<div><strong>{clientMergeUi.reasons}</strong><p>{mergeSuggestions.find(item=>item.id===mergeSourceId)!.reasons.map(mergeReasonLabel).join(" · ")}</p><strong>{clientMergeUi.channels}</strong><p>{mergeSuggestions.find(item=>item.id===mergeSourceId)!.channels.map(mergeChannelLabel).join(" · ")||"—"}</p></div>}<footer><CrmButton type="button" tone="secondary" disabled={mergeBusy} onClick={()=>setMergeOpen(false)}>{clientMergeUi.cancel}</CrmButton><CrmButton type="button" disabled={mergeBusy||!mergeSourceId} onClick={()=>void mergeClient()}>{mergeBusy?clientMergeUi.merging:clientMergeUi.confirm}</CrmButton></footer></section></div>}
      {addingAthlete && detail && (
        <AddAthlete
          clientId={detail.id}
          request={request}
          returnFocusRef={addAthleteTriggerRef}
          close={() => setAddingAthlete(false)}
          done={() => {
            setAddingAthlete(false);
            request(`/clients/${detail.id}`).then(setDetail);
            load();
          }}
        />
      )}
      {ordering && detail && (
        <OrderPanel
          client={detail}
          request={request}
          onClose={() => setOrdering(false)}
          onSaved={() => {
            setOrdering(false);
            request(`/clients/${detail.id}`).then(setDetail);
            load();
          }}
        />
      )}
      {measuring && detail && (
        <MeasurementPanel
          client={detail}
          request={request}
          onClose={() => setMeasuring(false)}
          onSaved={() => {
            setMeasuring(false);
            request(`/clients/${detail.id}`).then(setDetail);
            load();
          }}
        />
      )}
    </main>
  );
}

function clearClientContextAction(){const url=new URL(window.location.href);for(const key of["action","clientId","clientName","orderId"])url.searchParams.delete(key);window.history.replaceState(null,"",url)}
function Login({ onSuccess }: { onSuccess: () => void }) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      r = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: d.get("email"),
          password: d.get("password"),
        }),
      });
    if (!r.ok) {
      setError("Неверная почта или пароль");
      return;
    }
    onSuccess();
  }
  return (
    <main className="phase2-login">
      <form onSubmit={submit}>
        <div className="phase2-logo">Y</div>
        <h1>Вход в Yoleotard CRM</h1>
        <p>Внутренняя рабочая система</p>
        <label>
          Электронная почта
          <input name="email" type="email" required />
        </label>
        <label>
          Пароль
          <input name="password" type="password" minLength={8} required />
        </label>
        {error && <div className="phase2-error">{error}</div>}
        <button className="phase2-primary">Войти</button>
      </form>
    </main>
  );
}
function Card({
  detail,
  focusedOrderId,
  onMeasure,
  onOrder,
  onAddAthlete,
  addAthleteTriggerRef,
}: {
  detail?: Client;
  focusedOrderId?: string;
  onMeasure: () => void;
  onOrder: () => void;
  onAddAthlete: () => void;
  addAthleteTriggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [tab, setTab] = useState(focusedOrderId ? "orders" : "main"),
    [viewing, setViewing] = useState<{
      athleteName: string;
      measurement: MeasurementView;
    }>();
  useEffect(() => { if (focusedOrderId && detail?.orders.some((order) => order.id === focusedOrderId)) setTab("orders"); }, [detail?.id, focusedOrderId]);
  if (!detail)
    return (
      <section className="phase2-card phase2-empty">
        Выберите клиента слева
      </section>
    );
  return (
    <section className="phase2-card">
      <div className="phase2-card-head">
        <div className="phase2-person">
          <ClientAvatar className="phase2-avatar big" displayName={detail.displayName} avatarUrl={detail.avatarUrl} />
          <div>
            <h2>{detail.displayName}</h2>
            <em>{clientWorkspaceUi.statuses[detail.status as keyof typeof clientWorkspaceUi.statuses]||clientWorkspaceUi.statusUnknown}</em>
          </div>
        </div>
        <div className="phase2-card-actions">
          <button onClick={onOrder}>+ Новый заказ</button>
          <button onClick={onMeasure}>+ Замеры</button>
        </div>
      </div>
      <CrmTabList className="phase2-tabs" ariaLabel={clientWorkspaceUi.tabList} value={tab} onChange={setTab} tabs={[{value:"main",label:"Главное"},{value:"orders",label:"Заказы"},{value:"history",label:"История"},{value:"files",label:"Файлы"}]}/>
      {tab === "main" && (
        <div className="phase2-card-content">
          <div className="phase2-facts">
            <Fact
              l="Предпочтительный канал"
              v={channel(detail) || "Не указан"}
            />
            <Fact l="Язык общения" v={detail.language || "Не указан"} />
            <Fact l="Телефон" v={detail.phone || "Не указан"} />
            <Fact
              l="Местоположение"
              v={
                [detail.city, detail.country].filter(Boolean).join(", ") ||
                "Не указано"
              }
            />
          </div>
          <Title
            t="Спортсмены"
            a={clientAthleteUi.add}
            onClick={onAddAthlete}
            buttonRef={addAthleteTriggerRef}
          />
          {detail.athletes.map((a) => (
            <div className="phase2-row" key={a.id}>
              <div>
                <strong>
                  {a.firstName} {a.lastName}
                </strong>
                <small>{a.discipline || "Дисциплина не указана"}</small>
              </div>
              <Age
                m={a.measurements[0]}
                onView={() =>
                  a.measurements[0] &&
                  setViewing({
                    athleteName: `${a.firstName} ${a.lastName || ""}`.trim(),
                    measurement: a.measurements[0],
                  })
                }
              />
            </div>
          ))}
          {!detail.athletes.length && <Empty t="Спортсмены ещё не добавлены" />}
          <Title t="Последние заказы" a="Все заказы" onClick={()=>setTab("orders")} />
          {detail.orders.slice(0, 3).map((o) => (
            <OrderLine o={o} key={o.id} />
          ))}
          {!detail.orders.length && <Empty t="Заказов пока нет" />}
        </div>
      )}
      {tab === "orders" && (
        <div className="phase2-card-content">
          {detail.orders.length ? (
            detail.orders.map((o) => <OrderLine o={o} key={o.id} focused={o.id === focusedOrderId} />)
          ) : (
            <Empty t="Заказов пока нет" />
          )}
        </div>
      )}
      {tab === "history" && (
        <div className="phase2-card-content">
          {detail.activities.length ? (
            detail.activities.map((a) => (
              <div className="phase2-history" key={a.id}>
                <i />
                <div>
                  <strong>{a.summary}</strong>
                  <small>{date(a.createdAt)}</small>
                </div>
              </div>
            ))
          ) : (
            <Empty t="История появится после первого действия" />
          )}
        </div>
      )}
      {tab === "files" && <div className="phase2-card-content">{detail.files?.length?detail.files.map(file=><a key={file.id} href={`/api/order-tabs/client-files/${encodeURIComponent(file.path)}`} target="_blank" rel="noreferrer">{file.name}</a>):<Empty t={detail.files?clientWorkspaceUi.noFiles:clientWorkspaceUi.filesUnavailable}/>}</div>}
      {viewing && (
        <MeasurementViewer
          athleteName={viewing.athleteName}
          measurement={viewing.measurement}
          onClose={() => setViewing(undefined)}
        />
      )}{" "}
    </section>
  );
}
function Create({
  close,
  done,
  request,
  returnFocusRef,
}: {
  close: () => void;
  done: (c: Client) => void;
  request: (p: string, i?: RequestInit) => Promise<any>;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLFormElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    firstNameRef.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled])",
        ),
      ];
      if (!controls.length) return;
      const first = controls[0]!, last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      returnFocusRef.current?.focus();
    };
  }, [returnFocusRef]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      done(
        await request("/clients", {
          method: "POST",
          body: JSON.stringify(
            Object.fromEntries(new FormData(e.currentTarget)),
          ),
        }),
      );
    } catch (x) {
      setError(x instanceof Error ? x.message : "Ошибка");
    }
  }
  return (
    <div className="phase2-overlay" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <form ref={dialogRef} className="phase2-modal" role="dialog" aria-modal="true" aria-labelledby="create-client-title" onSubmit={submit}>
        <div>
          <h2 id="create-client-title">Новый клиент</h2>
          <CrmActionIcon
            type="button"
            aria-label={clientWorkspaceUi.closeCreateClient}
            onClick={close}
          >
            ×
          </CrmActionIcon>
        </div>
        <CrmTextInput ref={firstNameRef} label="Имя" name="firstName" required />
        <CrmTextInput label="Фамилия" name="lastName" />
        <CrmTextInput label="Страна" name="country" />
        <CrmTextInput label="Телефон" name="phone" />
        <CrmTextInput label="Instagram" name="instagram" />
        <CrmTextInput label="Язык общения" name="language" />
        {error && <div className="phase2-error">{error}</div>}
        <footer>
          <CrmButton type="button" tone="secondary" onClick={close}>
            Отмена
          </CrmButton>
          <CrmButton type="submit">Создать клиента</CrmButton>
        </footer>
      </form>
    </div>
  );
}
export function AddAthlete({
  clientId,
  close,
  done,
  request,
  returnFocusRef,
}: {
  clientId: string;
  close: () => void;
  done: () => void;
  request: (p: string, i?: RequestInit) => Promise<any>;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(close),
    savingRef = useRef(saving);
  closeRef.current = close;
  savingRef.current = saving;
  useEffect(() => {
    firstNameRef.current?.focus();
    function keydown(e: KeyboardEvent) {
      if (e.key === "Escape" && !savingRef.current) closeRef.current();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const controls = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled])",
        ),
      ];
      if (!controls.length) return;
      const first = controls[0]!,
        last = controls[controls.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      returnFocusRef.current?.focus();
    };
  }, [returnFocusRef]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const f = new FormData(e.currentTarget),
      discipline = String(f.get("discipline") || ""),
      body: { firstName: string; lastName?: string; discipline?: string } = {
        firstName: String(f.get("firstName") || "").trim(),
        lastName: String(f.get("lastName") || "").trim() || undefined,
      };
    if (discipline) body.discipline = discipline;
    try {
      await request(`/clients/${clientId}/athletes`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      done();
    } catch (x) {
      setError(x instanceof Error ? x.message : clientAthleteUi.saveError);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className="phase2-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && close()}
    >
      <form
        ref={dialogRef}
        className="phase2-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-athlete-title"
        onSubmit={submit}
      >
        <div>
          <h2 id="add-athlete-title">{clientAthleteUi.title}</h2>
          <CrmActionIcon
            type="button"
            onClick={close}
            disabled={saving}
            aria-label={clientAthleteUi.close}
          >
            ×
          </CrmActionIcon>
        </div>
        <CrmTextInput ref={firstNameRef} label={clientAthleteUi.firstName} name="firstName" required />
        <CrmTextInput label={clientAthleteUi.lastName} name="lastName" />
        <CrmNativeSelect
          name="discipline"
          label={clientAthleteUi.discipline}
          data={[
            { value: "", label: clientAthleteUi.disciplineNotSet },
            { value: "RHYTHMIC_GYMNASTICS", label: clientAthleteUi.rhythmicGymnastics },
            { value: "ACROBATIC_GYMNASTICS", label: clientAthleteUi.acrobaticGymnastics },
            { value: "FIGURE_SKATING", label: clientAthleteUi.figureSkating },
            { value: "AEROBIC_GYMNASTICS", label: clientAthleteUi.aerobicGymnastics },
            { value: "BATON_TWIRLING_MAJORETTE", label: clientAthleteUi.batonTwirling },
            { value: "OTHER", label: clientAthleteUi.other },
          ]}
        />
        {error && (
          <div className="phase2-error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <CrmButton type="button" tone="secondary" onClick={close} disabled={saving}>
            {clientAthleteUi.cancel}
          </CrmButton>
          <CrmButton type="submit" disabled={saving}>
            {saving ? clientAthleteUi.saving : clientAthleteUi.save}
          </CrmButton>
        </footer>
      </form>
    </div>
  );
}
function Fact({ l, v }: { l: string; v: string }) {
  return (
    <div>
      <small>{l}</small>
      <strong>{v}</strong>
    </div>
  );
}
function Title({
  t,
  a,
  onClick,
  buttonRef,
}: {
  t: string;
  a: string;
  onClick?: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="phase2-section-title">
      <h3>{t}</h3>
      <button ref={buttonRef} type="button" onClick={onClick}>
        {a}
      </button>
    </div>
  );
}
function Empty({ t }: { t: string }) {
  return <div className="phase2-empty-line">{t}</div>;
}
function OrderLine({ o, focused = false }: { o: Order; focused?: boolean }) {
  return (
    <div className={`phase2-row${focused ? " is-context" : ""}`}>
      {o.modelImagePath && (
        <img
          className="phase2-order-thumb"
          src={`/api/orders/images/${o.modelImagePath}`}
          alt="Модель заказа"
        />
      )}
      <div>
        <strong title={o.number}>{orderDisplayNumber(o)}</strong>
        <small>
          {new Intl.NumberFormat("ru-RU", {
            style: "currency",
            currency: o.currency,
          }).format(o.priceMinor / 100)}
        </small>
      </div>
      <em>{orderLabel("sales",o.salesStatus)}</em>
    </div>
  );
}
function Age({ m, onView }: { m?: MeasurementView; onView: () => void }) {
  if (!m) return <span className="phase2-warning">Нет замеров</span>;
  const old = (Date.now() - new Date(m.measuredAt).getTime()) / 86400000 > 180;
  return (
    <button
      type="button"
      className={`phase2-measure-link ${old ? "phase2-warning" : ""}`}
      onClick={onView}
      title="Просмотреть замеры"
    >
      Замеры: {date(m.measuredAt)}
      {old ? " · устарели" : ""}
    </button>
  );
}
function initials(n: string) {
  return n
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}
function channel(c: Partial<Client>) {
  return c.instagram
    ? "Instagram"
    : c.whatsapp
      ? "WhatsApp"
      : c.telegram
        ? "Telegram"
        : c.email
          ? "Email"
          : c.phone
            ? "Телефон"
            : "";
}
function date(v: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(v));
}
