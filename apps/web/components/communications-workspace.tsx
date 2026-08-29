"use client";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { communicationsUi as ui, labels } from "../lib/i18n";
import {
  canRefreshInbox,
  isCurrentInboxDetailRequest,
} from "../lib/inbox-request-guard";
import { ClientAvatar } from "./client-avatar";
import { prepareAttachmentAttempt, settleAttachmentAttempt, shouldResetAttachmentForClient, type PendingAttachmentSend } from "../lib/attachment-send-state";
type Order = {
  id: string;
  number: string;
  modelImagePath?: string;
  productionStatus: string;
  salesStatus?: string;
  notes?: string;
  priceMinor: number;
  currency: string;
  payments?: { amountMinor: number; currency: string }[];
};
type Attachment = { type: string; url?: string; stickerId?: string; name?: string; mimeType?: string };
type UploadedAttachment = { path: string; name: string; mimeType: string; sizeBytes: number };
type ConversationPreview = {
  id: string;
  unreadCount?: number;
  unreadVersion?: number;
  channel?: string;
  lastMessageAt?: string;
  messages?: { content: string; createdAt: string }[];
  connectedAccountLabel?: string;
  connectedAccountUrl?: string;
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
  email?: string;
  instagram?: string;
  instagramUsername?: string;
  facebook?: string;
  orders: Order[];
  buyerSummary?: { purchaseCount: number; paymentTotals: { currency: string; amountMinor: number }[] };
  conversations: ConversationPreview[];
};
type ClientPage = { items: Client[]; total: number; hasMore: boolean };
type Message = {
  id: string;
  direction: string;
  content: string;
  createdAt: string;
  channel: string;
  status?: string;
  metadata?: { attachments?: Attachment[]; reason?: string; code?: number; subcode?: number; translation?: { text?: string; language?: string } };
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
const isInstagramScopedId = (value?: string) => /^\d+$/.test(value || "");
const instagramHandle = (value?: string) => value ? `@${value.replace(/^@/, "")}` : "";
function sourceBadge(c?: Client) {
  const key = channel(c);
  return {
    icon: icons[key] || icons.MANUAL,
    label: ui.sources[key as keyof typeof ui.sources] || ui.sources.MANUAL,
  };
}
function sendFailureText(reason: string | undefined, messageChannel: string) {
  const reasons = ui.sendFailureReasons as Record<string, string>;
  const provider = messageChannel === "INSTAGRAM" ? "Instagram" : "Facebook";
  return (reasons[reason || ""] || ui.failed).replaceAll("Facebook", provider);
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
function connectedAccountLabel(c: Client | undefined, activeChannel: string) {
  if (!c) return "";
  return [...c.conversations]
    .filter((conversation) => conversation.channel === activeChannel && conversation.connectedAccountLabel)
    .sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime())[0]?.connectedAccountLabel || "";
}
function connectedAccountUrl(c: Client | undefined, activeChannel: string) {
  if (!c) return "";
  return [...c.conversations]
    .filter((conversation) => conversation.channel === activeChannel && conversation.connectedAccountUrl)
    .sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime())[0]?.connectedAccountUrl || "";
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
function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(ui.fileReadError));
    reader.readAsDataURL(file);
  });
}
function formatBytes(size: number) {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`;
}
function formatMessageDateTime(value:string){
  return new Date(value).toLocaleString("ru",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
function optionalFormFields(data: Record<string, FormDataEntryValue>, names: string[]) {
  return Object.fromEntries(names.map((name) => {
    const value = data[name];
    return [name, typeof value === "string" && value.trim()?value.trim():undefined];
  }));
}
export function CommunicationsWorkspace() {
  const [clients, setClients] = useState<Client[]>([]),
    [client, setClient] = useState<Client>(),
    [activeChannel,setActiveChannel]=useState("MANUAL"),
    [messages, setMessages] = useState<Message[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [templatesOpen, setTemplatesOpen] = useState(false),
    [templateBusy,setTemplateBusy]=useState(false),
    [templateNotice,setTemplateNotice]=useState(""),
    [text, setText] = useState(""),
    [selectedMessageIds,setSelectedMessageIds]=useState<string[]>([]),
    [replyInstruction,setReplyInstruction]=useState(""),
    [replyMode,setReplyMode]=useState(false),
    [aiReply,setAiReply]=useState<{messageIds:string[];phase:"RUSSIAN"|"TRANSLATED";sourceText?:string;targetLanguage?:string}|null>(null),
    [aiDraftText,setAiDraftText]=useState(""),
    [translatingId,setTranslatingId]=useState<string|null>(null),
    [aiPreparing,setAiPreparing]=useState(false),
    [busyDraftIds,setBusyDraftIds]=useState<Set<string>>(()=>new Set()),
    [search, setSearch] = useState(""),
    [visibleClientCount,setVisibleClientCount]=useState(15),
    [clientsHasMore,setClientsHasMore]=useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [messagesLoading, setMessagesLoading] = useState(false),
    [error, setError] = useState(""),
    [attachment, setAttachment] = useState<File>(),
    [attachmentPreview, setAttachmentPreview] = useState(""),
    [creating, setCreating] = useState(false),
    [preview, setPreview] = useState<{url:string;type:"image"|"video"}>(),
    [left, setLeft] = useState(defaults.left),
    [right, setRight] = useState(defaults.right);
  const widths = useRef({ ...defaults }),
    selectedClientId = useRef<string | undefined>(undefined),
    composeEpoch = useRef(0),
    listRequestSequence = useRef(0),
    listLoading = useRef(false),
    currentSearch = useRef(""),
    currentClientCount = useRef(15),
    aiOperationSequence = useRef(0),
    detailVersion = useRef(0),
    readVersion = useRef(0),
    readOperationSequence = useRef(0),
    readOperations = useRef(new Map<string, number>()),
    pendingReads = useRef(new Map<string, Map<string, number>>()),
    pendingSend = useRef<PendingAttachmentSend<File, UploadedAttachment> & { textContent?: string; textRequestId?: string }>({}),
    pendingAiSend = useRef<{textContent?:string;textRequestId?:string}>({}),
    pendingDraftSends = useRef(new Map<string,string>()),
    manualLoading = useRef(false),
    refreshing = useRef(false),
    previewTrigger = useRef<HTMLButtonElement | null>(null),
    previewClose = useRef<HTMLButtonElement | null>(null),
    previewVideo = useRef<HTMLVideoElement | null>(null),
    aiDraftEditor = useRef<HTMLTextAreaElement | null>(null);
  currentSearch.current=search;
  currentClientCount.current=visibleClientCount;
  const accountLabel = connectedAccountLabel(client, activeChannel);
  const accountUrl = connectedAccountUrl(client, activeChannel);
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
  async function fetchClientWindow(count: number, query: string) {
    const items: Client[] = [];
    const seenIds = new Set<string>();
    let offset = 0;
    let hasMore = true;
    let requests = 0;
    while (items.length < count && hasMore && requests++ < 100) {
      const limit = Math.min(60, Math.max(15, count - items.length));
      const page = await api(`/communications?offset=${offset}&limit=${limit}&search=${encodeURIComponent(query.trim())}`) as ClientPage;
      offset += page.items.length;
      for(const item of page.items)if(!seenIds.has(item.id)){seenIds.add(item.id);items.push(item)}
      hasMore = page.hasMore;
      if (!page.items.length) break;
    }
    return { items:items.slice(0,count), hasMore:hasMore||items.length>count };
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
    if (shouldResetAttachmentForClient(selectedClientId.current, c.id)) {
      if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
      setAttachment(undefined);
      setAttachmentPreview("");
      pendingSend.current = {};
      pendingAiSend.current = {};
      pendingDraftSends.current.clear();
    }
    selectedClientId.current = c.id;
    composeEpoch.current++;
    aiOperationSequence.current++;
    setSelectedMessageIds([]);setReplyInstruction("");setReplyMode(false);setAiReply(null);setAiDraftText("");setTranslatingId(null);setAiPreparing(false);setBusy(false);
    const request = { clientId: c.id, version: ++detailVersion.current };
    manualLoading.current = true;
    setClient(c);
    setActiveChannel(latestConversation(c)?.channel||channel(c));
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
  async function loadClients(id?: string, requestedCount=visibleClientCount, requestedSearch=search) {
    const request=++listRequestSequence.current;
    listLoading.current=true;
    setLoading(true);
    setError("");
    try {
      const page = await fetchClientWindow(requestedCount, requestedSearch);
      if(request!==listRequestSequence.current)return;
      const data = sortClients(page.items);
      setClients(data);
      setClientsHasMore(page.hasMore);
      const selected = id ? data.find((x) => x.id === id) : data[0];
      if (selected&&selected.id===selectedClientId.current)setClient(selected);
      else if(id&&selected)await open(selected);
      else if(!selectedClientId.current&&selected)await open(selected);
      else if(!selectedClientId.current) {
        selectedClientId.current = undefined;
        setClient(undefined);
        setMessages([]);
      }
    } catch (e) {
      if(request===listRequestSequence.current)setError((e as Error).message);
    } finally {
      if(request===listRequestSequence.current){setLoading(false);listLoading.current=false}
    }
  }
  async function refreshInbox() {
    if (listLoading.current||!canRefreshInbox(manualLoading.current, refreshing.current)) return;
    refreshing.current = true;
    const listRequest=++listRequestSequence.current;
    const observedReadVersion = readVersion.current;
    try {
      const page = await fetchClientWindow(currentClientCount.current, currentSearch.current);
      const data = sortClients(page.items).map(
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
      if (observedReadVersion !== readVersion.current||listRequest!==listRequestSequence.current) return;
      setClients(data);
      setClientsHasMore(page.hasMore);
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
        if(preview.type==="video"&&previewVideo.current){
          const close=previewClose.current,video=previewVideo.current;
          if(event.shiftKey&&document.activeElement===close){event.preventDefault();video.focus()}
          else if(!event.shiftKey&&document.activeElement===video){event.preventDefault();close?.focus()}
        }else{event.preventDefault();previewClose.current?.focus()}
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previewTrigger.current?.focus();
    };
  }, [preview]);
  useEffect(()=>{if(aiReply){aiDraftEditor.current?.scrollIntoView({block:"nearest"});aiDraftEditor.current?.focus()}},[aiReply?.phase]);
  const filteredClients = clients;
  const visibleClients=filteredClients;
  useEffect(()=>{
    const timer=setTimeout(()=>{setVisibleClientCount(15);void loadClients(undefined,15,search)},250);
    return()=>clearTimeout(timer);
  },[search]);
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
  async function save(action: "DRAFT" | "SEND",contentOverride?:string) {
    const messageText=(contentOverride??text).trim();
    if (!client || (!messageText && !attachment)) return false;
    if(action==="DRAFT")invalidateAiOperation();
    const operationClientId=client.id,operationEpoch=composeEpoch.current;
    const isActive=()=>selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch;
    setBusy(true);
    setError("");
    try {
      let uploaded: UploadedAttachment | undefined;
      if (attachment) {
        if (pendingSend.current.file === attachment && pendingSend.current.uploaded) uploaded = pendingSend.current.uploaded;
        else {
          uploaded = await api("/communications/attachments", {
            method: "POST",
            body: JSON.stringify({ name: attachment.name, mimeType: attachment.type, data: await readFile(attachment) }),
          });
          if(!isActive())return false;
          pendingSend.current = { file: attachment, uploaded };
        }
      }
      const sendOne = async (content?: string, file?: UploadedAttachment, requestId?: string) => {
        const result = await api("/communications/" + client.id + "/messages", {
          method: "POST",
          body: JSON.stringify({ ...(content ? { content } : {}), ...(file ? { attachment: file } : {}), channel: activeChannel, action, ...(action === "SEND" ? { clientRequestId: requestId || crypto.randomUUID() } : {}) }),
        });
        if(isActive())setMessages((current) => [...current, result]);
        return result as Message;
      };
      const sent: Message[] = [];
      if (action === "DRAFT") {
        sent.push(await sendOne(messageText || undefined, uploaded));
      } else {
        if (uploaded && !pendingSend.current.attachmentDelivered) {
          const attempt = prepareAttachmentAttempt(pendingSend.current, () => crypto.randomUUID());
          pendingSend.current = attempt.state;
          const { requestId } = attempt;
          const result = await sendOne(undefined, uploaded, requestId);
          if(!isActive())return false;
          sent.push(result);
          pendingSend.current = settleAttachmentAttempt(pendingSend.current, result.status);
        }
        if (!sent.some((message) => message.status === "FAILED") && messageText) {
          const content = messageText;
          const textRequestId = pendingSend.current.textContent === content && pendingSend.current.textRequestId
            ? pendingSend.current.textRequestId
            : crypto.randomUUID();
          pendingSend.current = { ...pendingSend.current, textContent: content, textRequestId };
          const result = await sendOne(content, undefined, textRequestId);
          if(!isActive())return false;
          sent.push(result);
          if (result.status === "FAILED") {
            const { textContent: _content, textRequestId: _requestId, ...attachmentState } = pendingSend.current;
            pendingSend.current = attachmentState;
          }
        }
      }
      const failed = sent.find((message) => message.status === "FAILED");
      if(!isActive())return false;
      if (failed) {
        setError(sendFailureText(failed.metadata?.reason, activeChannel));
        return false;
      }
      else {
        setText("");
        if(action==="DRAFT"){setAiReply(null);setAiDraftText("")}
        setAttachment(undefined);
        pendingSend.current = {};
        if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
        setAttachmentPreview("");
        return true;
      }
    } catch (e) {
      if(isActive())setError((e as Error).message);
      return false;
    } finally {
      if(isActive())setBusy(false);
    }
  }
  function chooseAttachment(file?: File) {
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachment(file);
    pendingSend.current = {};
    setAttachmentPreview(file?.type.startsWith("image/") ? URL.createObjectURL(file) : "");
  }
  async function ai(action: string) {
    if (!client) return;
    const operationClientId=client.id,operationEpoch=composeEpoch.current,operationSequence=++aiOperationSequence.current;
    setAiPreparing(true);
    setError("");
    try {
      const x = await api("/ai-assistant/generate", {
        method: "POST",
        body: JSON.stringify({
          action,
          text: text || messages.at(-1)?.content || "",
          clientId: operationClientId,
        }),
      });
      if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence){setText(x.text);setAiReply(null);setAiDraftText("")}
    } catch (e) {
      if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setError((e as Error).message);
    } finally {
      if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setAiPreparing(false);
    }
  }
  function invalidateAiOperation(){aiOperationSequence.current++;setAiPreparing(false)}
  function toggleMessage(id:string){invalidateAiOperation();setSelectedMessageIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);setAiReply(null);setAiDraftText("")}
  async function translateMessage(message:Message){
    if(!client)return;const operationClientId=client.id,operationEpoch=composeEpoch.current;
    setTranslatingId(message.id);setError("");
    try{const result=await api(`/ai-assistant/messages/${message.id}/translate`,{method:"POST",body:"{}"});if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setMessages(current=>current.map(item=>item.id===message.id?{...item,metadata:result.metadata}:item))}
    catch(e){if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setError((e as Error).message)}finally{if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setTranslatingId(null)}
  }
  async function sendSavedDraft(message:Message){
    if(!client||message.status!=="DRAFT")return;
    const operationClientId=client.id,operationEpoch=composeEpoch.current,requestId=pendingDraftSends.current.get(message.id)||crypto.randomUUID();
    pendingDraftSends.current.set(message.id,requestId);setBusyDraftIds(current=>new Set(current).add(message.id));setError("");
    try{const result=await api("/communications/"+operationClientId+"/messages",{method:"POST",body:JSON.stringify({content:message.content,channel:message.channel||activeChannel,action:"SEND",clientRequestId:requestId,draftMessageId:message.id})});if(selectedClientId.current!==operationClientId||composeEpoch.current!==operationEpoch)return;if(result.status==="FAILED"){pendingDraftSends.current.delete(message.id);setError(sendFailureText(result.metadata?.reason,message.channel||activeChannel));return}pendingDraftSends.current.delete(message.id);setMessages(current=>current.map(item=>item.id===message.id?result:item))}
    catch(e){if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setError((e as Error).message)}finally{setBusyDraftIds(current=>{const next=new Set(current);next.delete(message.id);return next})}
  }
  async function generateSelectedReply(){
    if(!client||!selectedMessageIds.length)return;
    const operationClientId=client.id,operationEpoch=composeEpoch.current,operationSequence=++aiOperationSequence.current;
    setAiPreparing(true);setError("");
    try{const x=await api("/ai-assistant/generate",{method:"POST",body:JSON.stringify({action:"REPLY",text:"",instructions:replyInstruction,clientId:operationClientId,messageIds:selectedMessageIds})});if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence){setAiDraftText(x.text);setAiReply({messageIds:[...selectedMessageIds],phase:"RUSSIAN"})}}
    catch(e){if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setError((e as Error).message)}finally{if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setAiPreparing(false)}
  }
  async function prepareAiTranslation(){
    if(!client||!aiReply||!aiDraftText.trim())return;
    const operationClientId=client.id,operationEpoch=composeEpoch.current,operationSequence=++aiOperationSequence.current,sourceText=aiDraftText.trim();
    setAiPreparing(true);setError("");
    try{const x=await api("/ai-assistant/generate",{method:"POST",body:JSON.stringify({action:"FINALIZE_REPLY",text:sourceText,clientId:operationClientId,messageIds:aiReply.messageIds})});if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence){setAiDraftText(x.text);setAiReply({...aiReply,phase:"TRANSLATED",sourceText,targetLanguage:x.targetLanguage})}}
    catch(e){if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setError((e as Error).message)}finally{if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setAiPreparing(false)}
  }
  async function sendConfirmedAiReply(){
    if(!aiReply||aiReply.phase!=="TRANSLATED")return;
    if(!client||!aiDraftText.trim())return;
    const operationClientId=client.id,operationEpoch=composeEpoch.current,content=aiDraftText.trim(),requestId=pendingAiSend.current.textContent===content&&pendingAiSend.current.textRequestId?pendingAiSend.current.textRequestId:crypto.randomUUID();
    pendingAiSend.current={textContent:content,textRequestId:requestId};setBusy(true);setError("");
    try{const result=await api("/communications/"+operationClientId+"/messages",{method:"POST",body:JSON.stringify({content,channel:activeChannel,action:"SEND",clientRequestId:requestId})});if(selectedClientId.current!==operationClientId||composeEpoch.current!==operationEpoch)return;setMessages(current=>[...current,result]);if(result.status==="FAILED"){pendingAiSend.current={};setError(sendFailureText(result.metadata?.reason,activeChannel));return}pendingAiSend.current={};setSelectedMessageIds([]);setReplyInstruction("");setReplyMode(false);setAiReply(null);setAiDraftText("")}
    catch(e){if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setError((e as Error).message)}finally{if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setBusy(false)}
  }
  async function saveAsTemplate(content:string,channel:string,language="ru"){
    const suggested=content.replace(/\s+/g," ").trim().slice(0,60),entered=window.prompt(ui.templateNamePrompt,suggested);
    const name=entered?.trim().slice(0,120);if(!name||!content.trim())return;
    setTemplateBusy(true);setError("");setTemplateNotice("");
    try{const created=await api("/communications/templates",{method:"POST",body:JSON.stringify({name,content:content.trim(),channel,language})});setTemplates(current=>[...current,created].sort((a,b)=>a.name.localeCompare(b.name,"ru")));setTemplateNotice(ui.templateSaved)}
    catch(e){setError((e as Error).message)}finally{setTemplateBusy(false)}
  }
  async function archiveTemplate(template:Template){
    if(!window.confirm(ui.deleteTemplateConfirm.replace("{name}",template.name)))return;
    setTemplateBusy(true);setError("");setTemplateNotice("");
    try{await api("/communications/templates/"+template.id+"/archive",{method:"POST",body:"{}"});setTemplates(current=>current.filter(item=>item.id!==template.id))}
    catch(e){setError((e as Error).message)}finally{setTemplateBusy(false)}
  }
  function chooseTemplate(template: Template) {
    invalidateAiOperation();
    setText(template.content);
    setAiReply(null);
    setAiDraftText("");
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
            firstName: String(data.firstName||"").trim(),
            ...optionalFormFields(data,["phone","email","instagram","notes"]),
            source: data.source || channel(client),
          }),
        },
      );
      setCreating(false);
      setSearch("");
      const existingClient=client?.id===created.id?client:undefined;
      const exactCreated={...created,orders:existingClient?.orders||[],conversations:existingClient?.conversations||[]} as Client;
      await open(exactCreated);
      await loadClients(created.id,15,"");
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = sourceBadge({source:activeChannel} as Client),
    availableChannels = client ? clientBadges(client) : [],
    activeOrders=client?.orders||[],
    purchaseTotals=(client?.buyerSummary?.paymentTotals||[]).map(total=>[total.currency,total.amountMinor] as const),
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
            {ui.createClient}
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
      {templateNotice && <div className="communications-template-notice" role="status">{templateNotice}<button type="button" onClick={()=>setTemplateNotice("")}>{ui.close}</button></div>}
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
            visibleClients.map((c) => {
              const badges = clientBadges(c),
                unread = c.conversations.reduce(
                  (sum, x) => sum + (x.unreadCount || 0),
                  0,
                ),
                latest = latestConversation(c),
                last = latest?.messages?.[0],
                primaryBadge=badges.find(badge=>badge.key===latest?.channel)||badges[0];
              return (
                <button
                  key={c.id}
                  className={client?.id === c.id ? "active" : ""}
                  onClick={() => void open(c)}
                >
                  <span className="communications-client-avatar-wrap">
                    <ClientAvatar className="communications-avatar" displayName={c.displayName} avatarUrl={c.avatarUrl} />
                    {primaryBadge&&<span className={`communications-avatar-source source-${primaryBadge.key.toLowerCase()}`} title={primaryBadge.label} aria-label={primaryBadge.label}>{primaryBadge.icon}</span>}
                  </span>
                  <div>
                    <span className="communications-client-name">
                      <b>{c.displayName}</b>
                      {badges.length>1&&<span className="communications-source-icons">{badges.filter(badge=>badge.key!==primaryBadge?.key).map(badge=><span key={badge.key} className={`communications-source-icon source-${badge.key.toLowerCase()}`} title={badge.label} aria-label={badge.label}>{badge.icon}</span>)}</span>}
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
                    {last&&<time className="communications-client-date" dateTime={last.createdAt}>{new Date(last.createdAt).toLocaleDateString("ru")}</time>}
                    {unread > 0 && <em>{unread}</em>}
                  </span>
                </button>
              );
            })
          )}
          {!loading&&clientsHasMore&&<button type="button" className="communications-load-more" aria-label={ui.loadMoreChats} onClick={()=>{const next=visibleClientCount+15;setVisibleClientCount(next);void loadClients(selectedClientId.current,next,search)}}><span aria-hidden="true">＋</span><b>{ui.loadMoreChats}</b></button>}
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
              <span className="communications-chat-client-copy">
                <b>{client?.displayName || ui.selectClient}</b>
                {accountLabel && (accountUrl
                  ? <a className="communications-chat-account" href={accountUrl} target="_blank" rel="noopener noreferrer" title={ui.openInSocialNetwork}>{ui.connectedAccount}: {accountLabel} ↗</a>
                  : <small className="communications-chat-account">{ui.connectedAccount}: {accountLabel}</small>)}
              </span>
            </span>
            {client && (availableChannels.length > 1 ? (
              <label>{ui.replyChannel}<select value={activeChannel} onChange={event=>setActiveChannel(event.target.value)}>{availableChannels.map(item=><option key={item.key} value={item.key}>{item.icon} {item.label}</option>)}</select></label>
            ) : (
              <span title={active.label} aria-label={active.label}>{active.icon} {active.label}</span>
            ))}
          </header>
          <div className="communications-messages">
            {messagesLoading ? (
              <State text={ui.loadingMessages} />
            ) : (
              messages.map((message) => {
                const attachments = message.metadata?.attachments || [];
                const hasVisualAttachment = attachments.some((attachment) => ["image", "sticker", "video"].includes(attachment.type));
                const canSelectForReply = replyMode && !hasVisualAttachment && (message.direction === "INBOUND" || message.status === "DRAFT");
                return (
                  <article
                    key={message.id}
                    className={`${message.direction === "OUTBOUND" ? "out" : "in"}${canSelectForReply ? " selectable" : ""}`}
                  >
                    {canSelectForReply && <label className="communications-message-select"><input type="checkbox" checked={selectedMessageIds.includes(message.id)} onChange={()=>toggleMessage(message.id)} aria-label={message.status==="DRAFT"?ui.selectDraftForReply:ui.selectMessageForReply}/></label>}
                    <span className="communications-message-content">{message.content}</span>
                    {attachments.length > 0 && (
                      <div className="communications-attachments">
                        {attachments.map((attachment, index) => {
                          const url = safeAttachmentUrl(attachment.url),
                            label =
                              ui.attachmentTypes[
                                attachment.type as keyof typeof ui.attachmentTypes
                              ] || ui.attachmentTypes.fallback;
                          return url &&
                            ["image", "sticker", "video"].includes(attachment.type) ? (
                            <span className="communications-media-attachment" key={index}>
                            <button
                              type="button"
                              className={attachment.type==="video"?"communications-video-preview":undefined}
                              onClick={(event) => {
                                previewTrigger.current = event.currentTarget;
                                setPreview({url,type:attachment.type==="video"?"video":"image"});
                              }}
                              aria-label={ui.openAttachment + ": " + label}
                            >
                              {attachment.type==="video"?<video src={url} preload="metadata" muted playsInline aria-label={label}/>:<img src={url} alt={label} />}
                            </button>
                              <a className="communications-media-save" aria-label={ui.saveAttachment} title={ui.saveAttachment} href={`/api/communications/messages/${encodeURIComponent(message.id)}/attachments/${index}/download`} download><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 20h14"/></svg></a>
                            </span>
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
                    {message.metadata?.translation?.text && <div className="communications-message-translation"><span>{message.metadata.translation.text}</span></div>}
                    <small>
                      {message.status === "FAILED" ? sendFailureText(message.metadata?.reason, message.channel) : message.status === "DRAFT" ? ui.draft : ""}{message.status === "FAILED" || message.status === "DRAFT" ? " · " : ""}
                      {formatMessageDateTime(message.createdAt)}
                    </small>
                    {message.direction === "INBOUND" && !hasVisualAttachment && <button type="button" className="communications-message-translate" aria-label={translatingId===message.id?ui.translating:message.metadata?.translation?.text?ui.translateAgain:ui.translate} title={translatingId===message.id?ui.translating:message.metadata?.translation?.text?ui.translateAgain:ui.translate} disabled={translatingId===message.id} onClick={()=>void translateMessage(message)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M8.5 3v3c0 4-2 7-5 9M6 10.5c1.4 2.1 3.5 3.7 6 4.5M13 21l4-10 4 10M14.5 17.5h5"/></svg></button>}
                    {message.direction === "OUTBOUND" && <button type="button" className="communications-save-template" aria-label={ui.saveAsTemplate} title={ui.saveAsTemplate} disabled={templateBusy} onClick={()=>void saveAsTemplate(message.content,message.channel)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.75L6 21V4.75Z"/><path d="M12 7v6M9 10h6"/></svg></button>}
                    {message.status === "DRAFT" && <button type="button" className="communications-send-saved-draft" disabled={busyDraftIds.has(message.id)} onClick={()=>void sendSavedDraft(message)}>{busyDraftIds.has(message.id)?ui.sending:ui.sendSavedDraft}</button>}
                  </article>
                );
              })
            )}
            {aiReply&&<article className="out communications-ai-draft-message">
              <b>{aiReply.phase==="RUSSIAN"?ui.aiRussianDraftTitle:ui.aiTranslatedDraftTitle}</b>
              <textarea ref={aiDraftEditor} value={aiDraftText} disabled={aiPreparing||busy} onChange={event=>{invalidateAiOperation();setAiDraftText(event.target.value)}} aria-label={aiReply.phase==="RUSSIAN"?ui.aiRussianDraftTitle:ui.aiTranslatedDraftTitle}/>
              <small>{aiReply.phase==="RUSSIAN"?ui.russianDraftHint:ui.translatedDraftHint}</small>
              <div>
                <button type="button" className="secondary" disabled={templateBusy||!aiDraftText.trim()} onClick={()=>void saveAsTemplate(aiDraftText,activeChannel,aiReply.targetLanguage||"ru")}>{ui.saveAsTemplate}</button>
                <button type="button" className="secondary" onClick={()=>{invalidateAiOperation();setAiReply(null);setAiDraftText("")}}>{ui.cancelAiDraft}</button>
                <button type="button" disabled={busy||aiPreparing||!aiDraftText.trim()} onClick={()=>void(aiReply.phase==="RUSSIAN"?prepareAiTranslation():sendConfirmedAiReply())}>{aiPreparing?ui.aiPreparing:aiReply.phase==="RUSSIAN"?ui.prepareTranslation:ui.confirmTranslationAndSend}</button>
              </div>
            </article>}
            {!messagesLoading && client && !messages.length && (
              <State text={ui.emptyMessages} />
            )}{" "}
            {!client && !loading && <State text={ui.selectClientHint} />}
          </div>
          <footer>
            <div className="communications-ai">
              <b>{ui.ai}</b>
              <button type="button" disabled={busy||!client} onClick={()=>{if(replyMode){invalidateAiOperation();setSelectedMessageIds([]);setReplyInstruction("");setAiReply(null);setAiDraftText("")}setReplyMode(!replyMode)}}>{replyMode?ui.cancelReplySelection:ui.reply}{selectedMessageIds.length?` (${selectedMessageIds.length})`:""}</button>
              {(
                [
                  ["IMPROVE", ui.improve],
                ] as const
              ).map(([a, l]) => (
                <button
                  key={a}
                  disabled={busy || aiPreparing || !client}
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
                    {templates.map((template) => <span className="communications-template-row" role="none" key={template.id}>
                      <button type="button" role="menuitem" onClick={() => chooseTemplate(template)}><b>{template.name}</b><small>{template.language}</small></button>
                      <button type="button" role="menuitem" className="communications-template-delete" disabled={templateBusy} aria-label={`${ui.deleteTemplate}: ${template.name}`} title={ui.deleteTemplate} onClick={()=>void archiveTemplate(template)}>×</button>
                    </span>)}
                  </div>
                )}
              </span>
            </div>
            {replyMode&&selectedMessageIds.length>0&&<div className="communications-reply-task"><label>{ui.replyTask}<textarea value={replyInstruction} onChange={event=>setReplyInstruction(event.target.value)} placeholder={ui.replyTaskPlaceholder}/></label><button type="button" disabled={aiPreparing} onClick={()=>void generateSelectedReply()}>{aiPreparing?ui.aiPreparing:ui.prepareRussianDraft}</button></div>}
            {attachment && (
              <div className="communications-selected-attachment">
                {attachmentPreview && <img src={attachmentPreview} alt={ui.selectedAttachment} />}
                <span><b>{attachment.name}</b><small>{formatBytes(attachment.size)}</small></span>
                <button type="button" onClick={() => chooseAttachment()} aria-label={ui.removeAttachment}>×</button>
              </div>
            )}
            <div className="communications-compose">
              <label className="communications-attach" aria-label={ui.attachFile}>
                <span aria-hidden>＋</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain" disabled={!client || busy} onChange={(event) => { chooseAttachment(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
              <textarea
                value={text}
                onChange={(e) => {invalidateAiOperation();setText(e.target.value)}}
                placeholder={ui.messagePlaceholder}
                disabled={!client}
              />
              <button className="communications-draft"
                disabled={busy || !client || (!text.trim() && !attachment)}
                onClick={() => void save("DRAFT")}
              >
                {busy ? ui.saving : ui.saveDraft}
              </button>
              {["FACEBOOK", "INSTAGRAM"].includes(activeChannel) && (
                <button
                  disabled={busy || !client || (!text.trim() && !attachment)}
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
          {client&&<section className="communications-buyer-card"><ClientAvatar className="communications-avatar" displayName={client.displayName} avatarUrl={client.avatarUrl}/><div><b>{client.displayName}</b><small>{client.status==="LEAD"?ui.unsavedBuyer:ui.savedBuyer}</small></div>{client.phone&&<p><span>{ui.phone}</span><b>{client.phone}</b></p>}{client.email&&<p><span>{ui.email}</span><b>{client.email}</b></p>}{client.instagramUsername&&<p><span>{ui.instagramUsername}</span><b>{instagramHandle(client.instagramUsername)}</b></p>}{client.instagram&&<p><span>{isInstagramScopedId(client.instagram)?ui.instagramSid:ui.instagram}</span><b>{client.instagram}</b></p>}{client.facebook&&<p><span>{ui.facebookSid}</span><b>{client.facebook}</b></p>}{client.status==="LEAD"?<button type="button" onClick={()=>setCreating(true)}>{ui.saveBuyer}</button>:<div className="communications-purchase-summary"><span>{ui.purchaseHistory}: {client.buyerSummary?.purchaseCount||0}</span>{purchaseTotals.map(([currency,total])=><strong key={currency}>{(total/100).toFixed(2)} {currency}</strong>)}</div>}</section>}
          {client?.status!=="LEAD"&&<header>
            <b>{ui.activeOrders}</b>
            <small>{activeOrders.length}</small>
          </header>}
          {client?.status!=="LEAD"&&activeOrders.map((o) => (
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
          {client?.status!=="LEAD"&&!activeOrders.length && <State text={ui.noActiveOrders} />}
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
              {ui.profileName}
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
              <input name="phone" defaultValue={client?.status==="LEAD"?client.phone||"":""}/>
            </label>
            <label>
              {ui.email}
              <input name="email" type="email" defaultValue={client?.status==="LEAD"?client.email||"":""}/>
            </label>
            {client?.status==="LEAD"&&client.facebook&&<label>{ui.facebookSid}<input value={client.facebook} readOnly/><small>{ui.facebookSidHint}</small></label>}
            {client?.status==="LEAD"&&isInstagramScopedId(client.instagram)&&<><label>{ui.instagramSid}<input value={client.instagram} readOnly/><small>{ui.instagramSidHint}</small></label>{client.instagramUsername&&<label>{ui.instagramUsername}<input value={instagramHandle(client.instagramUsername)} readOnly/></label>}</>}
            {!(client?.status==="LEAD"&&(client.facebook||isInstagramScopedId(client.instagram)))&&<label>
              {ui.instagram}
              <input name="instagram" defaultValue={client?.status==="LEAD"?client.instagram||"":""}/>
            </label>}
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
          aria-label={preview.type==="video"?ui.videoPreview:ui.imagePreview}
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
          {preview.type === "video" ? (
            <video ref={previewVideo} src={preview.url} controls autoPlay playsInline tabIndex={0} aria-label={ui.videoPreview} onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={preview.url} alt={ui.imagePreview} onClick={(e) => e.stopPropagation()} />
          )}
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
