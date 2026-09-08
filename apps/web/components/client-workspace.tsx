"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { MeasurementPanel } from "./measurement-panel";
import { OrderPanel } from "./order-panel";
import { MeasurementViewer, type MeasurementView } from "./measurement-viewer";
import { clientAthleteUi, clientMergeUi } from "../lib/i18n";
import { ClientAvatar } from "./client-avatar";

type Client = {
  id: string;
  displayName: string;
  avatarUrl?: string;
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
  const mergeTriggerRef = useRef<HTMLButtonElement>(null);
  const mergeDialogRef = useRef<HTMLElement>(null);
  const mergeBusyRef = useRef(false);
  const detailRequestId=useRef(0);
  const initialClientId=useRef(typeof window==="undefined"?undefined:new URLSearchParams(window.location.search).get("clientId")||undefined);
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
    const data = await request(
      `/clients${q ? `?search=${encodeURIComponent(q)}` : ""}`,
    );
    setClients(data);
    setAuth(true);
    if (!selected && data[0]) setSelected(pendingOrderClientId.current||initialClientId.current||data[0].id);
  }
  useEffect(() => {
    request("/auth/me")
      .then(() => load())
      .catch(() => setAuth(false));
  }, []);
  useEffect(() => {
    if (!auth) return;
    const t = setTimeout(
      () => load(search).catch((e) => setError(e.message)),
      250,
    );
    return () => clearTimeout(t);
  }, [search, auth]);
  useEffect(() => {
    const requestId=++detailRequestId.current;
    setDetail(undefined);setMergeSuggestions([]);setMergeSourceId("");setMergeOpen(false);
    if (!selected || !auth) {
      setDetail(undefined);
      return;
    }
    request(`/clients/${selected}`)
      .then(value=>{if(requestId!==detailRequestId.current)return;setDetail(value);if(pendingOrderClientId.current===value.id){pendingOrderClientId.current=undefined;setOrdering(true);clearClientContextAction()}})
      .catch((e) => {if(requestId===detailRequestId.current)setError(e.message)});
    request(`/clients/${selected}/merge-suggestions`).then(value=>{if(requestId===detailRequestId.current)setMergeSuggestions(value)}).catch(()=>{if(requestId===detailRequestId.current)setMergeSuggestions([])});
  }, [selected, auth]);
  useEffect(()=>{
    if(!mergeOpen)return;
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
          <div className="phase2-card-actions"><button ref={mergeTriggerRef} disabled={!detail||detail.id!==selected} onClick={()=>{if(detail?.id===selected)setMergeOpen(true)}}>{clientMergeUi.action}{mergeSuggestions.length?` · ${mergeSuggestions.length} ${clientMergeUi.suggestionBadge}`:""}</button><button className="phase2-primary" onClick={() => setCreating(true)}>+ Новый клиент</button></div>
        </header>
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
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Имя, телефон, Instagram…"
                />
              )}
              <button onClick={() => setCollapsed((v) => !v)}>
                {collapsed ? "›" : "‹"}
              </button>
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
          close={() => setCreating(false)}
          done={(c) => {
            setCreating(false);
            load().then(() => setSelected(c.id));
          }}
        />
      )}
      {mergeOpen&&detail&&<div className="phase2-overlay"><section ref={mergeDialogRef} className="phase2-modal" role="dialog" aria-modal="true" aria-labelledby="client-merge-title"><div><h2 id="client-merge-title">{clientMergeUi.title}</h2><button type="button" aria-label={clientAthleteUi.close} disabled={mergeBusy} onClick={()=>setMergeOpen(false)}>×</button></div><p>{clientMergeUi.hint}</p>{!mergeSuggestions.length&&<p>{clientMergeUi.noSuggestions}</p>}<label>{clientMergeUi.source}<select autoFocus value={mergeSourceId} onChange={event=>setMergeSourceId(event.target.value)}><option value="">{clientMergeUi.choose}</option>{[...mergeSuggestions,...clients.filter(client=>client.id!==detail.id&&!mergeSuggestions.some(item=>item.id===client.id)).map(client=>({...client,reasons:[],channels:[]} as MergeSuggestion))].map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.displayName}{candidate.reasons.length?` — ${candidate.reasons.map(mergeReasonLabel).join(", ")}`:""}</option>)}</select></label>{mergeSourceId&&mergeSuggestions.find(item=>item.id===mergeSourceId)&&<div><strong>{clientMergeUi.reasons}</strong><p>{mergeSuggestions.find(item=>item.id===mergeSourceId)!.reasons.map(mergeReasonLabel).join(" · ")}</p><strong>{clientMergeUi.channels}</strong><p>{mergeSuggestions.find(item=>item.id===mergeSourceId)!.channels.map(mergeChannelLabel).join(" · ")||"—"}</p></div>}<footer><button type="button" disabled={mergeBusy} onClick={()=>setMergeOpen(false)}>{clientMergeUi.cancel}</button><button type="button" className="phase2-primary" disabled={mergeBusy||!mergeSourceId} onClick={()=>void mergeClient()}>{mergeBusy?clientMergeUi.merging:clientMergeUi.confirm}</button></footer></section></div>}
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
  onMeasure,
  onOrder,
  onAddAthlete,
  addAthleteTriggerRef,
}: {
  detail?: Client;
  onMeasure: () => void;
  onOrder: () => void;
  onAddAthlete: () => void;
  addAthleteTriggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [tab, setTab] = useState("main"),
    [viewing, setViewing] = useState<{
      athleteName: string;
      measurement: MeasurementView;
    }>();
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
            <em>Активный клиент</em>
          </div>
        </div>
        <div className="phase2-card-actions">
          <button onClick={onOrder}>+ Новый заказ</button>
          <button onClick={onMeasure}>+ Замеры</button>
        </div>
      </div>
      <nav className="phase2-tabs">
        {[
          ["main", "Главное"],
          ["orders", "Заказы"],
          ["history", "История"],
          ["files", "Файлы"],
        ].map(([id, n]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id ?? "main")}
            key={id}
          >
            {n}
          </button>
        ))}
      </nav>
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
          <Title t="Последние заказы" a="Все заказы" />
          {detail.orders.slice(0, 3).map((o) => (
            <OrderLine o={o} key={o.id} />
          ))}
          {!detail.orders.length && <Empty t="Заказов пока нет" />}
        </div>
      )}
      {tab === "orders" && (
        <div className="phase2-card-content">
          {detail.orders.length ? (
            detail.orders.map((o) => <OrderLine o={o} key={o.id} />)
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
      {tab === "files" && <Empty t="Файлы клиента будут собраны здесь" />}
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
}: {
  close: () => void;
  done: (c: Client) => void;
  request: (p: string, i?: RequestInit) => Promise<any>;
}) {
  const [error, setError] = useState("");
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
    <div className="phase2-overlay">
      <form className="phase2-modal" onSubmit={submit}>
        <div>
          <h2>Новый клиент</h2>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <label>
          Имя
          <input name="firstName" required />
        </label>
        <label>
          Фамилия
          <input name="lastName" />
        </label>
        <label>
          Страна
          <input name="country" />
        </label>
        <label>
          Телефон
          <input name="phone" />
        </label>
        <label>
          Instagram
          <input name="instagram" />
        </label>
        <label>
          Язык общения
          <input name="language" />
        </label>
        {error && <div className="phase2-error">{error}</div>}
        <footer>
          <button type="button" onClick={close}>
            Отмена
          </button>
          <button className="phase2-primary">Создать клиента</button>
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
  const closeRef = useRef(close),
    savingRef = useRef(saving);
  closeRef.current = close;
  savingRef.current = saving;
  useEffect(() => {
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
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label={clientAthleteUi.close}
          >
            ×
          </button>
        </div>
        <label>
          {clientAthleteUi.firstName}
          <input name="firstName" autoFocus required />
        </label>
        <label>
          {clientAthleteUi.lastName}
          <input name="lastName" />
        </label>
        <label>
          {clientAthleteUi.discipline}
          <select name="discipline">
            <option value="">{clientAthleteUi.disciplineNotSet}</option>
            <option value="RHYTHMIC_GYMNASTICS">
              {clientAthleteUi.rhythmicGymnastics}
            </option>
            <option value="ACROBATIC_GYMNASTICS">
              {clientAthleteUi.acrobaticGymnastics}
            </option>
            <option value="FIGURE_SKATING">
              {clientAthleteUi.figureSkating}
            </option>
            <option value="AEROBIC_GYMNASTICS">
              {clientAthleteUi.aerobicGymnastics}
            </option>
            <option value="BATON_TWIRLING_MAJORETTE">
              {clientAthleteUi.batonTwirling}
            </option>
            <option value="OTHER">{clientAthleteUi.other}</option>
          </select>
        </label>
        {error && (
          <div className="phase2-error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <button type="button" onClick={close} disabled={saving}>
            {clientAthleteUi.cancel}
          </button>
          <button className="phase2-primary" disabled={saving}>
            {saving ? clientAthleteUi.saving : clientAthleteUi.save}
          </button>
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
function OrderLine({ o }: { o: Order }) {
  return (
    <div className="phase2-row">
      {o.modelImagePath && (
        <img
          className="phase2-order-thumb"
          src={`/api/orders/images/${o.modelImagePath}`}
          alt="Модель заказа"
        />
      )}
      <div>
        <strong>{o.number}</strong>
        <small>
          {new Intl.NumberFormat("ru-RU", {
            style: "currency",
            currency: o.currency,
          }).format(o.priceMinor / 100)}
        </small>
      </div>
      <em>{o.salesStatus}</em>
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
