"use client";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { communicationsUi as ui, labels } from "../lib/i18n";
import {
  canRefreshInbox,
  isCurrentInboxDetailRequest,
} from "../lib/inbox-request-guard";
import { ClientAvatar } from "./client-avatar";
type Order = {
  id: string;
  number: string;
  modelImagePath?: string;
  productionStatus: string;
  notes?: string;
  priceMinor: number;
  currency: string;
};
type Attachment = { type: string; url?: string; stickerId?: string };
type ConversationPreview = {
  id: string;
  unreadCount?: number;
  unreadVersion?: number;
  channel?: string;
  lastMessageAt?: string;
  messages?: { content: string; createdAt: string }[];
};
type Client = {
  id: string;
  displayName: string;
  firstName?: string;
  avatarUrl?: string;
  status?: string;
  source: string;
  preferredChannel?: string;
  phone?: string;
  instagram?: string;
  orders: Order[];
  conversations: ConversationPreview[];
};
type Message = {
  id: string;
  direction: string;
  content: string;
  createdAt: string;
  channel: string;
  status?: string;
  metadata?: { attachments?: Attachment[]; reason?: string; code?: number; subcode?: number };
};
type Template = {
  id: string;
  name: string;
  content: string;
  channel?: string;
  language: string;
};
type Side = "left" | "right";
const limits = { left: [200, 430], right: [260, 560] } as const,
  defaults = { left: 280, right: 360 },
  icons: Record<string, string> = {
    INSTAGRAM: "◎",
    FACEBOOK: "f",
    WHATSAPP: "◉",
    CHATWOOT: "C",
    EMAIL: "✉",
    TELEGRAM: "➤",
    WEBSITE: "⌂",
    MANUAL: "✎",
  };
const channel = (c?: Client) => c?.preferredChannel || c?.source || "MANUAL";
function sourceBadge(c?: Client) {
  const key = channel(c);
  return {
    icon: icons[key] || icons.MANUAL,
    label: ui.sources[key as keyof typeof ui.sources] || ui.sources.MANUAL,
  };
}
function clientBadges(c: Client) {
  const keys = [
    ...new Set(
      c.conversations
        .map((x) => x.channel)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  return (keys.length ? keys : [channel(c)]).map((key) => ({
    key,
    ...sourceBadge({ source: key } as Client),
  }));
}
function latestConversation(c: Client) {
  return [...c.conversations].sort(
    (a, b) =>
      new Date(b.lastMessageAt || b.messages?.[0]?.createdAt || 0).getTime() -
      new Date(a.lastMessageAt || a.messages?.[0]?.createdAt || 0).getTime(),
  )[0];
}
function conversationTimestamp(c: Client) {
  const latest = latestConversation(c);
  return new Date(
    latest?.lastMessageAt || latest?.messages?.[0]?.createdAt || 0,
  ).getTime();
}
function sortClients(data: Client[]) {
  return [...data].sort(
    (a, b) => conversationTimestamp(b) - conversationTimestamp(a),
  );
}
function safeAttachmentUrl(url?: string) {
  if (!url) return;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
export function CommunicationsWorkspace() {
  const [clients, setClients] = useState<Client[]>([]),
    [client, setClient] = useState<Client>(),
    [messages, setMessages] = useState<Message[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [templatesOpen, setTemplatesOpen] = useState(false),
    [text, setText] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [messagesLoading, setMessagesLoading] = useState(false),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [preview, setPreview] = useState<string>(),
    [left, setLeft] = useState(defaults.left),
    [right, setRight] = useState(defaults.right);
  const widths = useRef({ ...defaults }),
    selectedClientId = useRef<string | undefined>(undefined),
    detailVersion = useRef(0),
    readVersion = useRef(0),
    readOperationSequence = useRef(0),
    readOperations = useRef(new Map<string, number>()),
    pendingReads = useRef(new Map<string, Map<string, number>>()),
    manualLoading = useRef(false),
    refreshing = useRef(false),
    previewTrigger = useRef<HTMLButtonElement | null>(null),
    previewClose = useRef<HTMLButtonElement | null>(null);
  async function api(path: string, init?: RequestInit) {
    const r = await fetch("/api" + path, {
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!r.ok) {
      const x = await r.json().catch(() => ({}));
      throw new Error(x.message || ui.requestError);
    }
    return r.json();
  }
  function persistWidths() {
    localStorage.setItem(
      "communications-widths",
      JSON.stringify(widths.current),
    );
  }
  function setWidth(side: Side, value: number, persist = false) {
    const n = Math.max(limits[side][0], Math.min(limits[side][1], value));
    widths.current = { ...widths.current, [side]: n };
    side === "left" ? setLeft(n) : setRight(n);
    if (persist) persistWidths();
  }
  async function markClientRead(c: Client) {
    const conversations = c.conversations
      .filter(
        (conversation) =>
          (conversation.unreadCount || 0) > 0,
      )
      .map((conversation) => ({
        id: conversation.id,
        unreadVersion: conversation.unreadVersion || 0,
      }));
    if (!conversations.length) return;
    readVersion.current++;
    const operation = ++readOperationSequence.current;
    readOperations.current.set(c.id, operation);
    const observed = new Map(
      c.conversations.map((conversation) => [
        conversation.id,
        conversation.unreadCount || 0,
      ]),
    );
    pendingReads.current.set(c.id, observed);
    const readClient = {
      ...c,
      conversations: c.conversations.map((conversation) => ({
        ...conversation,
        unreadCount: 0,
      })),
    };
    setClients((current) =>
      current.map((candidate) =>
        candidate.id === c.id ? readClient : candidate,
      ),
    );
    setClient(readClient);
    try {
      await api("/communications/" + c.id + "/read", {
        method: "PATCH",
        body: JSON.stringify({ conversations }),
      });
    } catch {
      if (readOperations.current.get(c.id) === operation) {
        setClients((current) =>
          current.map((candidate) =>
            candidate.id === c.id
              ? {
                  ...candidate,
                  conversations: candidate.conversations.map((conversation) => ({
                    ...conversation,
                    unreadCount:
                      (conversation.unreadCount || 0) +
                      (observed.get(conversation.id) || 0),
                  })),
                }
              : candidate,
          ),
        );
        setClient((current) =>
          current?.id === c.id
            ? {
                ...current,
                conversations: current.conversations.map((conversation) => ({
                  ...conversation,
                  unreadCount:
                    (conversation.unreadCount || 0) +
                    (observed.get(conversation.id) || 0),
                })),
              }
            : current,
        );
      }
    } finally {
      if (readOperations.current.get(c.id) === operation) {
        pendingReads.current.delete(c.id);
        readOperations.current.delete(c.id);
        readVersion.current++;
      }
    }
  }
  async function open(c: Client) {
    selectedClientId.current = c.id;
    const request = { clientId: c.id, version: ++detailVersion.current };
    manualLoading.current = true;
    setClient(c);
    setMessagesLoading(true);
    setError("");
    try {
      void markClientRead(c);
      const x = await api("/communications/" + c.id);
      if (
        isCurrentInboxDetailRequest(
          request,
          selectedClientId.current,
          detailVersion.current,
        )
      )
        setMessages(x.messages || []);
    } catch (e) {
      if (
        isCurrentInboxDetailRequest(
          request,
          selectedClientId.current,
          detailVersion.current,
        )
      )
        setError((e as Error).message);
    } finally {
      if (
        isCurrentInboxDetailRequest(
          request,
          selectedClientId.current,
          detailVersion.current,
        )
      ) {
        manualLoading.current = false;
        setMessagesLoading(false);
      }
    }
  }
  async function loadClients(id?: string) {
    setLoading(true);
    setError("");
    try {
      const data = sortClients((await api("/communications")) as Client[]);
      setClients(data);
      const selected = data.find((x) => x.id === id) || data[0];
      if (selected) await open(selected);
      else {
        selectedClientId.current = undefined;
        setClient(undefined);
        setMessages([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function refreshInbox() {
    if (!canRefreshInbox(manualLoading.current, refreshing.current)) return;
    refreshing.current = true;
    const observedReadVersion = readVersion.current;
    try {
      const data = sortClients((await api("/communications")) as Client[]).map(
        (candidate) => {
          const pending = pendingReads.current.get(candidate.id);
          if (!pending) return candidate;
          return {
            ...candidate,
            conversations: candidate.conversations.map((conversation) => ({
              ...conversation,
              unreadCount: Math.max(
                (conversation.unreadCount || 0) -
                  (pending.get(conversation.id) || 0),
                0,
              ),
            })),
          };
        },
      );
      if (observedReadVersion !== readVersion.current) return;
      setClients(data);
      const selected = data.find((x) => x.id === selectedClientId.current);
      if (selected) {
        const request = {
          clientId: selected.id,
          version: ++detailVersion.current,
        };
        const detail = await api("/communications/" + selected.id);
        if (
          isCurrentInboxDetailRequest(
            request,
            selectedClientId.current,
            detailVersion.current,
          )
        ) {
          setClient(selected);
          setMessages(detail.messages || []);
        }
      }
    } catch {
    } finally {
      refreshing.current = false;
    }
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("communications-widths") || "null",
      );
      if (
        saved &&
        Number.isFinite(saved.left) &&
        Number.isFinite(saved.right)
      ) {
        setWidth("left", saved.left);
        setWidth("right", saved.right);
      }
    } catch {
      localStorage.removeItem("communications-widths");
    }
    void loadClients();
    api("/communications/templates")
      .then(setTemplates)
      .catch((e) => setError((e as Error).message));
    const timer = setInterval(() => void refreshInbox(), 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!preview) return;
    previewClose.current?.focus();
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPreview(undefined);
      if (event.key === "Tab") {
        event.preventDefault();
        previewClose.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previewTrigger.current?.focus();
    };
  }, [preview]);
  const filteredClients = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru");
    return q
      ? clients.filter((c) =>
          [
            c.displayName,
            c.phone,
            c.instagram,
            ...clientBadges(c).map((x) => x.label),
          ].some((v) => v?.toLocaleLowerCase("ru").includes(q)),
        )
      : clients;
  }, [clients, search]);
  function resize(side: Side, e: PointerEvent<HTMLDivElement>) {
    const h = e.currentTarget,
      start = e.clientX,
      base = widths.current[side];
    h.setPointerCapture(e.pointerId);
    const move = (m: globalThis.PointerEvent) =>
      setWidth(side, base + (m.clientX - start) * (side === "left" ? 1 : -1));
    const done = () => {
      h.removeEventListener("pointermove", move);
      persistWidths();
    };
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", done, { once: true });
    h.addEventListener("pointercancel", done, { once: true });
  }
  function resizeByKeyboard(side: Side, e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const d = e.key === "ArrowRight" ? 10 : -10;
    setWidth(side, widths.current[side] + d * (side === "left" ? 1 : -1), true);
  }
  async function save(action: "DRAFT" | "SEND") {
    if (!client || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const m = await api("/communications/" + client.id + "/messages", {
        method: "POST",
        body: JSON.stringify({ content: text.trim(), channel: channel(client), action, ...(action === "SEND" ? { clientRequestId: crypto.randomUUID() } : {}) }),
      });
      setMessages((x) => [...x, m]);
      if (m.status === "FAILED") {
        const reasons = ui.sendFailureReasons as Record<string, string>;
        setError(reasons[m.metadata?.reason || ""] || ui.sendFailed);
      }
      else setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function ai(action: string) {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const x = await api("/ai-assistant/generate", {
        method: "POST",
        body: JSON.stringify({
          action,
          text: text || messages.at(-1)?.content || "",
          clientId: client.id,
        }),
      });
      setText(x.text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function chooseTemplate(template: Template) {
    setText(template.content);
    setTemplatesOpen(false);
  }
  async function createClient(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget)),
        promoting = client?.status === "LEAD";
      const created = await api(
        promoting
          ? "/clients/" + client.id + "/promote-from-inbox"
          : "/clients",
        {
          method: "POST",
          body: JSON.stringify({
            ...data,
            source: data.source || channel(client),
          }),
        },
      );
      setCreating(false);
      await loadClients(created.id);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = sourceBadge(client),
    grid = left + "px 6px minmax(380px,1fr) 6px " + right + "px";
  return (
    <div className="communications-page">
      <header className="phase2-header">
        <div>
          <p>{ui.eyebrow}</p>
          <h1>{ui.title}</h1>
          <span>{ui.subtitle}</span>
        </div>
        <div className="communications-header-actions">
          <button onClick={() => setCreating(true)}>
            {client?.status === "LEAD" ? ui.createFromMessage : ui.createClient}
          </button>
          <button
            onClick={() => {
              widths.current = { ...defaults };
              setLeft(defaults.left);
              setRight(defaults.right);
              localStorage.removeItem("communications-widths");
            }}
          >
            {ui.resetWidths}
          </button>
        </div>
      </header>
      {error && (
        <div className="phase2-error" role="alert">
          {error}
          <button onClick={() => setError("")}>{ui.close}</button>
        </div>
      )}
      <section
        className="communications-grid"
        style={{ gridTemplateColumns: grid }}
        aria-label={ui.workspace}
      >
        <aside className="communications-clients" aria-label={ui.clientsList}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={ui.search}
            aria-label={ui.search}
          />
          {loading ? (
            <State text={ui.loading} />
          ) : (
            filteredClients.map((c) => {
              const badges = clientBadges(c),
                unread = c.conversations.reduce(
                  (sum, x) => sum + (x.unreadCount || 0),
                  0,
                ),
                latest = latestConversation(c),
                last = latest?.messages?.[0];
              return (
                <button
                  key={c.id}
                  className={client?.id === c.id ? "active" : ""}
                  onClick={() => void open(c)}
                >
                  <ClientAvatar className="communications-avatar" displayName={c.displayName} avatarUrl={c.avatarUrl} />
                  <div>
                    <span className="communications-client-name">
                      <b>{c.displayName}</b>
                      <span className="communications-source-icons">
                        {badges.map((b) => (
                          <span
                            key={b.key}
                            className="communications-source-icon"
                            title={b.label}
                            aria-label={b.label}
                          >
                            {b.icon}
                          </span>
                        ))}
                      </span>
                    </span>
                    <small className="communications-client-preview">
                      {last?.content || badges.map((b) => b.label).join(" · ")}
                    </small>
                  </div>
                  <span className="communications-client-side">
                    {last && (
                      <time
                        className="communications-client-time"
                        dateTime={last.createdAt}
                      >
                        {new Date(last.createdAt).toLocaleTimeString("ru", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    )}
                    {unread > 0 && <em>{unread}</em>}
                  </span>
                </button>
              );
            })
          )}
          {!loading && !filteredClients.length && (
            <State text={search ? ui.noSearchResults : ui.noClients} />
          )}
        </aside>
        <Resizer
          side="left"
          value={left}
          onPointer={resize}
          onKey={resizeByKeyboard}
        />
        <main className="communications-chat">
          <header className="communications-chat-header">
            <span className="communications-chat-client">
              {client && <ClientAvatar className="communications-avatar" displayName={client.displayName} avatarUrl={client?.avatarUrl} />}
              <b>{client?.displayName || ui.selectClient}</b>
            </span>
            {client && (
              <span>
                <span aria-hidden>{active.icon}</span> {active.label}
              </span>
            )}
          </header>
          <div className="communications-messages">
            {messagesLoading ? (
              <State text={ui.loadingMessages} />
            ) : (
              messages.map((message) => {
                const attachments = message.metadata?.attachments || [];
                return (
                  <article
                    key={message.id}
                    className={message.direction === "OUTBOUND" ? "out" : "in"}
                  >
                    <span>{message.content}</span>
                    {attachments.length > 0 && (
                      <div className="communications-attachments">
                        {attachments.map((attachment, index) => {
                          const url = safeAttachmentUrl(attachment.url),
                            label =
                              ui.attachmentTypes[
                                attachment.type as keyof typeof ui.attachmentTypes
                              ] || ui.attachmentTypes.fallback;
                          return url &&
                            ["image", "sticker"].includes(attachment.type) ? (
                            <button
                              type="button"
                              key={index}
                              onClick={(event) => {
                                previewTrigger.current = event.currentTarget;
                                setPreview(url);
                              }}
                              aria-label={ui.openAttachment + ": " + label}
                            >
                              <img src={url} alt={label} />
                            </button>
                          ) : url ? (
                            <a
                              key={index}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {ui.openAttachment}: {label}
                            </a>
                          ) : (
                            <span key={index}>{label}</span>
                          );
                        })}
                      </div>
                    )}
                    <small>
                      {message.status === "FAILED" ? (ui.sendFailureReasons as Record<string, string>)[message.metadata?.reason || ""] || ui.failed : message.status === "DRAFT" ? ui.draft : ""}{message.status === "FAILED" || message.status === "DRAFT" ? " · " : ""}
                      {new Date(message.createdAt).toLocaleString("ru")}
                    </small>
                  </article>
                );
              })
            )}
            {!messagesLoading && client && !messages.length && (
              <State text={ui.emptyMessages} />
            )}{" "}
            {!client && !loading && <State text={ui.selectClientHint} />}
          </div>
          <footer>
            <div className="communications-ai">
              <b>{ui.ai}</b>
              {(
                [
                  ["REPLY", ui.reply],
                  ["TRANSLATE", ui.translate],
                  ["IMPROVE", ui.improve],
                ] as const
              ).map(([a, l]) => (
                <button
                  key={a}
                  disabled={busy || !client}
                  onClick={() => void ai(a)}
                >
                  {l}
                </button>
              ))}
              <span className="communications-template-menu">
                <button
                  type="button"
                  disabled={!client || !templates.length}
                  aria-expanded={templatesOpen}
                  onClick={() => setTemplatesOpen((x) => !x)}
                >
                  {ui.template}
                </button>
                {templatesOpen && (
                  <div role="menu" aria-label={ui.templatesList}>
                    {templates.map((template) => (
                      <button
                        type="button"
                        role="menuitem"
                        key={template.id}
                        onClick={() => chooseTemplate(template)}
                      >
                        <b>{template.name}</b>
                        <small>{template.language}</small>
                      </button>
                    ))}
                  </div>
                )}
              </span>
            </div>
            <div className="communications-compose">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={ui.messagePlaceholder}
                disabled={!client}
              />
              <button className="communications-draft"
                disabled={busy || !client || !text.trim()}
                onClick={() => void save("DRAFT")}
              >
                {busy ? ui.saving : ui.saveDraft}
              </button>
              {channel(client) === "FACEBOOK" && (
                <button
                  disabled={busy || !client || !text.trim()}
                  onClick={() => void save("SEND")}
                >
                  {busy ? ui.sending : ui.sendMessage}
                </button>
              )}
            </div>
          </footer>
        </main>
        <Resizer
          side="right"
          value={right}
          onPointer={resize}
          onKey={resizeByKeyboard}
        />
        <aside className="communications-orders">
          <header>
            <b>{ui.clientOrders}</b>
            <small>{client?.orders?.length || 0}</small>
          </header>
          {client?.orders?.map((o) => (
            <article key={o.id}>
              {o.modelImagePath ? (
                <img
                  src={
                    "/api/orders/images/" + o.modelImagePath.split("/").pop()
                  }
                  alt={ui.modelImage}
                />
              ) : (
                <span />
              )}
              <div>
                <b>{o.number}</b>
                <small>
                  {labels.productionStatus[
                    o.productionStatus as keyof typeof labels.productionStatus
                  ] || ui.unknownStatus}
                </small>
                <p>{o.notes || ui.noDescription}</p>
                <strong>
                  {(o.priceMinor / 100).toFixed(2)} {o.currency}
                </strong>
              </div>
            </article>
          ))}
          {client && !client.orders?.length && <State text={ui.noOrders} />}
        </aside>
      </section>
      {creating && (
        <div className="phase2-overlay">
          <form
            className="phase2-modal communications-create"
            onSubmit={createClient}
          >
            <div>
              <h2>{ui.createClientTitle}</h2>
              <button
                type="button"
                aria-label={ui.close}
                onClick={() => setCreating(false)}
              >
                ×
              </button>
            </div>
            <label>
              {ui.firstName}
              <input
                name="firstName"
                required
                autoFocus
                defaultValue={
                  client?.status === "LEAD"
                    ? client.firstName || client.displayName
                    : ""
                }
              />
            </label>
            <label>
              {ui.phone}
              <input name="phone" />
            </label>
            <label>
              {ui.instagram}
              <input name="instagram" />
            </label>
            <label>
              {ui.source}
              <select name="source" defaultValue={channel(client)}>
                {Object.entries(ui.sources).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ui.note}
              <input name="notes" />
            </label>
            <footer>
              <button type="button" onClick={() => setCreating(false)}>
                {ui.cancel}
              </button>
              <button className="phase2-primary" disabled={busy}>
                {busy ? ui.creating : ui.create}
              </button>
            </footer>
          </form>
        </div>
      )}
      {preview && (
        <div
          className="communications-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={ui.imagePreview}
          onClick={() => setPreview(undefined)}
        >
          <button
            ref={previewClose}
            type="button"
            aria-label={ui.close}
            onClick={() => setPreview(undefined)}
          >
            ×
          </button>
          <img
            src={preview}
            alt={ui.imagePreview}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
function State({ text }: { text: string }) {
  return <div className="communications-state">{text}</div>;
}
function Resizer({
  side,
  value,
  onPointer,
  onKey,
}: {
  side: Side;
  value: number;
  onPointer: (s: Side, e: PointerEvent<HTMLDivElement>) => void;
  onKey: (s: Side, e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="communications-resizer"
      role="separator"
      aria-label={side === "left" ? ui.resizeClients : ui.resizeOrders}
      aria-orientation="vertical"
      aria-valuemin={limits[side][0]}
      aria-valuemax={limits[side][1]}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(e) => onPointer(side, e)}
      onKeyDown={(e) => onKey(side, e)}
    />
  );
}
