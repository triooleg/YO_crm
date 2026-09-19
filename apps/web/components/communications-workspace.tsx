"use client";
import type { ClipboardEvent, FormEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, NativeSelect } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { communicationsUi as ui, labels } from "../lib/i18n";
import {
  canRefreshInbox,
  isCurrentInboxDetailRequest,
  isCurrentInboxRefresh,
} from "../lib/inbox-request-guard";
import { inboxMeasurements, type InboxMeasurement } from "../lib/inbox-measurements";
import { ClientAvatar } from "./client-avatar";
import { AddAthlete } from "./client-workspace";
import { OrderPanel } from "./order-panel";
import { TaskDialog } from "./tasks-workspace";
import { latestSuccessfulMessage, prepareAttachmentAttempt, settleAttachmentAttempt, shouldResetAttachmentForClient, type PendingAttachmentSend } from "../lib/attachment-send-state";
import { shouldOfferInboundTranslation } from "../lib/message-language";
import { prepareInboxMessages, restoreInboxDraft } from "../lib/inbox-message-visibility";
import { CrmSearchField } from "./crm/search-field";
import { CrmActionIcon, CrmButton, CrmNativeSelect } from "./crm/settings-controls";
import { CrmMenu } from "./crm/menu";
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
  hasSummary?:boolean;
  linkedChannels?:string[];
  linkedAccounts?:{channel:string;accountName:string;sourceClientId?:string}[];
  mergedClients?:{sourceClientId:string;displayName:string;channels:string[];splitMode:"FULL"|"CHANNELS_ONLY"}[];
  displayName: string;
  firstName?: string;
  avatarUrl?: string;
  status?: string;
  source: string;
  preferredChannel?: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;
  timezone?: string;
  language?: string;
  instagram?: string;
  instagramUsername?: string;
  facebook?: string;
  notes?: string;
  nextActionAt?: string;
  orders: Order[];
  buyerSummary?: { purchaseCount: number; paymentTotals: { currency: string; amountMinor: number }[] };
  conversations: ConversationPreview[];
};
type ClientAthlete = {
  id: string;
  firstName: string;
  lastName?: string;
  discipline?: string;
  measurements: InboxMeasurement[];
};
type ClientDetail = {
  id: string;
  displayName: string;
  athletes: ClientAthlete[];
  orders?: Order[];
  workTasks?: { id:string; title:string; description?:string; dueAt?:string; markerColor:string; assignee?:{id:string;displayName:string}; column:{id:string;name:string;color:string;isDone:boolean} }[];
};
type TaskBoard = {
  columns: { id: string; name: string; color: string; isDone: boolean; sortOrder: number; tasks: never[] }[];
  users: { id: string; displayName: string; role: string }[];
};
type ContextTarget = "clients" | "tasks" | "finance";
type CommunicationsWorkspaceProps = { searchQuery?:string; onSearchChange?:(value:string)=>void; unreadRequest?:number; businessLogoUrl?:string|null; onNavigate?: (section: ContextTarget, context?: Record<string,string>) => void };
type ClientPage = { items: Client[]; preferredItem?: Client; total: number; hasMore: boolean; channelCounts:Partial<Record<SocialChannel,number>> };
type Message = {
  id: string;
  externalId?: string;
  direction: string;
  content: string;
  createdAt: string;
  channel: string;
  status?: string;
  language?: string;
  metadata?: { attachments?: Attachment[]; composerDraftKey?:string; replyTo?: { kind: "story" | "message"; externalMessageId?: string; storyId?: string; storyUrl?: string; storyMediaType?:"image"|"video" }; engagement?: { kind:"comment"|"reaction"|"mention"|"share"; surface:"post"|"story"|"reel"|"live"|"comment"; objectExternalId:string; mediaId?:string; mediaUrl?:string; permalinkUrl?:string; reactionType?:string; action?:string; replyMode:"PUBLIC_COMMENT"|"DIRECT_MESSAGE" }; engagementReply?:{mode?:"PUBLIC_COMMENT";targetExternalId?:string}; reactions?: { customer?: { name?: string; emoji?: string; reactedAt?: string }; business?: { name?: string; emoji?: string; reactedAt?: string } }; reason?: string; code?: number; subcode?: number; source?: string; metaReadAt?: string; translation?: { text?: string; language?: string }; emailHtml?: string; subject?: string; messageId?: string };
  replyToMessage?: { id: string; content: string; metadata?: { attachments?: Attachment[] } } | null;
};
type Template = {
  id: string;
  name: string;
  content: string;
  channel?: string;
  language: string;
};
type Side = "left" | "right";
type SocialChannel = "FACEBOOK" | "INSTAGRAM" | "WHATSAPP" | "CHATWOOT" | "EMAIL";
type OrderScope = "WITH_ORDERS" | "ACTIVE_ORDERS";
type ContextTab = "CLIENT" | "ORDERS" | "NOTES" | "FILES" | "SUMMARY";
type ConversationSummaryItem = { id:string; fromDate:string; generatedAt:string; throughMessageAt?:string; messageCount?:number; isCurrent:boolean; summary?:string|null; pending?:boolean; processedChunks?:number; totalChunks?:number };
type ConversationScope = "ALL" | "UNREAD" | "CLIENTS";
const limits = { left: [200, 430], right: [260, 560] } as const,
  defaults = { left: 365, right: 410 },
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
const socialChannels: SocialChannel[] = ["FACEBOOK", "INSTAGRAM", "WHATSAPP", "CHATWOOT", "EMAIL"];
const sendableChannels: SocialChannel[] = ["FACEBOOK", "INSTAGRAM", "WHATSAPP", "CHATWOOT", "EMAIL"];
const COMMUNICATION_FILE_MAX_BYTES = 5 * 1024 * 1024;
const COMMUNICATION_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const commonAttachmentMimeTypes = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","application/pdf","text/plain"];
const whatsappAttachmentMimeTypes = ["image/jpeg","image/png","video/mp4","application/pdf","text/plain"];
const standardEmojis = ["😀","😂","🥰","😍","😊","😉","😅","😢","😭","😮","🙏","👍","👎","👏","🙌","❤️","💜","🔥","✨","🎉","✅","💯"];
const reactionEmojisByChannel:Record<string,string[]>={INSTAGRAM:["❤️"],WHATSAPP:["❤️","😂","😮","😢","😡","👍"]};
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
  const provider = messageChannel === "INSTAGRAM" ? "Instagram" : messageChannel === "WHATSAPP" ? "WhatsApp" : messageChannel === "CHATWOOT" ? "Chatwoot" : messageChannel === "EMAIL" ? "Gmail" : "Facebook";
  return (reasons[reason || ""] || ui.failed).replaceAll("Facebook", provider);
}
function clientBadges(c: Client) {
  const keys = [
    ...new Set(
      (c.linkedChannels?.length?c.linkedChannels:c.conversations.map((x) => x.channel))
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  return (keys.length ? keys : [channel(c)]).map((key) => ({
    key,
    accountName:c.linkedAccounts?.find(item=>item.channel===key)?.accountName,
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
  if (/^\/api\/communications\/files\/[a-zA-Z0-9._-]+$/.test(url)) return url;
  if (/^\/api\/communications\/messages\/[a-zA-Z0-9_-]+\/attachments\/\d+\/download\?inline=1$/.test(url)) return url;
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
function clipboardImageName(mimeType:string,now=Date.now()){
  const extension:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"};
  return `clipboard-image-${now}.${extension[mimeType]||"png"}`;
}
function showInboxNotification(message:string){
  notifications.show({message,color:"teal",autoClose:3000,withCloseButton:true,closeButtonProps:{"aria-label":ui.close}});
}
function showInboxErrorNotification(message:string){
  notifications.show({id:"communications-error",message,color:"red",autoClose:5000,withCloseButton:true,closeButtonProps:{"aria-label":ui.close}});
}
function formatMessageDateTime(value:string){
  return new Date(value).toLocaleString("ru",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
function orderPaidMinor(order:Order){return (order.payments||[]).filter(payment=>payment.currency===order.currency).reduce((total,payment)=>total+payment.amountMinor,0)}
function messageDayKey(value:string){const date=new Date(value);return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`}
function localDateKey(value:string|Date){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value)),part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===type)?.value||"";return `${part("year")}-${part("month")}-${part("day")}`}
function formatMessageDay(value:string){return new Date(value).toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"})}
function gmailConversationUrl(messages: Message[]) {
  const messageId = [...messages].reverse().find((message) => message.channel === "EMAIL" && typeof message.metadata?.messageId === "string")?.metadata?.messageId?.trim();
  if (!messageId || messageId.length > 998 || /[\r\n]/.test(messageId)) return "";
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`rfc822msgid:${messageId}`)}`;
}
function shortMessagePreview(value:string){const compact=value.replace(/\s+/g," ").trim();return compact.length>160?compact.slice(0,157)+"…":compact}
function optionalFormFields(data: Record<string, FormDataEntryValue>, names: string[]) {
  return Object.fromEntries(names.map((name) => {
    const value = data[name];
    return [name, typeof value === "string" && value.trim()?value.trim():undefined];
  }));
}
export function CommunicationsWorkspace({onNavigate,searchQuery,onSearchChange,unreadRequest,businessLogoUrl}:CommunicationsWorkspaceProps={}) {
  const [clients, setClients] = useState<Client[]>([]),
    [client, setClient] = useState<Client>(),
    [activeChannel,setActiveChannel]=useState("MANUAL"),
    [messages, setMessages] = useState<Message[]>([]),
    [newMessageCount,setNewMessageCount]=useState(0),
    [templates, setTemplates] = useState<Template[]>([]),
    [templatesOpen, setTemplatesOpen] = useState(false),
    [templateBusy,setTemplateBusy]=useState(false),
    [text, setText] = useState(""),
    [draftStatus,setDraftStatus]=useState<"IDLE"|"SAVING"|"SAVED"|"ERROR">("IDLE"),
    [emailReplyTarget,setEmailReplyTarget]=useState<Message>(),
    [socialReplyTarget,setSocialReplyTarget]=useState<Message>(),
    [emojiOpen,setEmojiOpen]=useState(false),
    [selectedMessageIds,setSelectedMessageIds]=useState<string[]>([]),
    [replyInstruction,setReplyInstruction]=useState(""),
    [replyMode,setReplyMode]=useState(false),
    [aiReply,setAiReply]=useState<{messageIds:string[];phase:"RUSSIAN"|"TRANSLATED";sourceText?:string;targetLanguage?:string;aiRunId?:string}|null>(null),
    [aiDraftText,setAiDraftText]=useState(""),
    [translatingId,setTranslatingId]=useState<string|null>(null),
    [aiPreparing,setAiPreparing]=useState(false),
    [reactionBusyIds,setReactionBusyIds]=useState<Set<string>>(()=>new Set()),
    [reactionPickerMessageId,setReactionPickerMessageId]=useState<string>(),
    [deleteTarget,setDeleteTarget]=useState<Message>(),
    [deleteBusy,setDeleteBusy]=useState(false),
    [search, setSearch] = useState(()=>typeof window==="undefined"?"":new URLSearchParams(window.location.search).get("clientName")||""),
    [socialFilters,setSocialFilters]=useState<SocialChannel[]>([]),
    [orderScope,setOrderScope]=useState<OrderScope>(),
    [conversationScope,setConversationScope]=useState<ConversationScope>("ALL"),
    [clientTotal,setClientTotal]=useState(0),
    [channelTotals,setChannelTotals]=useState<Partial<Record<SocialChannel,number>>>({}),
    [visibleClientCount,setVisibleClientCount]=useState(15),
    [clientsHasMore,setClientsHasMore]=useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [messagesLoading, setMessagesLoading] = useState(false),
    [error, setError] = useState(""),
    [connectionLost,setConnectionLost]=useState(false),
    [attachment, setAttachment] = useState<File>(),
    [attachmentPreview, setAttachmentPreview] = useState(""),
    [creating, setCreating] = useState(false),
    [noteOpen,setNoteOpen]=useState(false),
    [noteText,setNoteText]=useState(""),
    [splitOpen,setSplitOpen]=useState(false),
    [splitSourceId,setSplitSourceId]=useState(""),
    [splitBusy,setSplitBusy]=useState(false),
    [splitError,setSplitError]=useState(""),
    [clientDetail,setClientDetail]=useState<ClientDetail>(),
    [selectedAthleteId,setSelectedAthleteId]=useState<string>(),
    [contextLoading,setContextLoading]=useState(false),
    [addingAthlete,setAddingAthlete]=useState(false),
    [ordering,setOrdering]=useState(false),
    [taskBoard,setTaskBoard]=useState<TaskBoard>(),
    [tasking,setTasking]=useState(false),
    [taskSaving,setTaskSaving]=useState(false),
    [contextOpen,setContextOpen]=useState(false),
    [contextCollapsed,setContextCollapsed]=useState(false),
    [mobileClientListOpen,setMobileClientListOpen]=useState(false),
    [contextTab,setContextTab]=useState<ContextTab>(()=>typeof window!=="undefined"&&new URLSearchParams(window.location.search).has("orderId")?"ORDERS":"CLIENT"),
    [conversationSummaries,setConversationSummaries]=useState<ConversationSummaryItem[]>([]),
    [summaryFirstMessageDate,setSummaryFirstMessageDate]=useState(""),
    [summaryDate,setSummaryDate]=useState(""),
    [summaryMonth,setSummaryMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1)),
    [summaryCalendarOpen,setSummaryCalendarOpen]=useState(false),
    [summaryLoading,setSummaryLoading]=useState(false),
    [summaryGenerating,setSummaryGenerating]=useState(false),
    [summaryProgress,setSummaryProgress]=useState<ConversationSummaryItem>(),
    [preview, setPreview] = useState<{url:string;type:"image"|"video"}>(),
    [left, setLeft] = useState(defaults.left),
    [right, setRight] = useState(defaults.right);
  const widths = useRef({ ...defaults }),
    selectedClientId = useRef<string | undefined>(undefined),
    initialClientId = useRef(typeof window==="undefined"?undefined:new URLSearchParams(window.location.search).get("clientId")||undefined),
    initialOrderId = useRef(typeof window==="undefined"?undefined:new URLSearchParams(window.location.search).get("orderId")||undefined),
    composeEpoch = useRef(0),
    listRequestSequence = useRef(0),
    refreshRequestSequence = useRef(0),
    skipNextFilterReload=useRef(false),
    listLoading = useRef(false),
    clientDetailRequest = useRef(0),
    orderRequestVersion = useRef(0),
    taskRequestVersion = useRef(0),
    currentSearch = useRef(""),
    currentSocialFilters = useRef<SocialChannel[]>([]),
    currentOrderScope = useRef<OrderScope | undefined>(undefined),
    currentConversationScope=useRef<ConversationScope>("ALL"),
    currentClientCount = useRef(15),
    aiOperationSequence = useRef(0),
    detailVersion = useRef(0),
    readVersion = useRef(0),
    readOperationSequence = useRef(0),
    readOperations = useRef(new Map<string, number>()),
    pendingReads = useRef(new Map<string, Map<string, number>>()),
    pendingSend = useRef<PendingAttachmentSend<File, UploadedAttachment> & { textContent?: string; textRequestId?: string }>({}),
    pendingAiSend = useRef<{textContent?:string;textRequestId?:string}>({}),
    composerDraftId=useRef<string|undefined>(undefined),
    composerDraftKey=useRef<string|undefined>(undefined),
    draftSavePromise=useRef<Promise<void>|null>(null),
    autosaveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),
    draftSequence=useRef(0),
    lastAutosavedText=useRef(""),
    volatileDrafts=useRef(new Map<string,string>()),
    manualLoading = useRef(false),
    refreshing = useRef(false),
    addAthleteTriggerRef = useRef<HTMLButtonElement | null>(null),
    orderTriggerRef = useRef<HTMLButtonElement | null>(null),
    previewTrigger = useRef<HTMLButtonElement | null>(null),
    previewClose = useRef<HTMLButtonElement | null>(null),
    previewVideo = useRef<HTMLVideoElement | null>(null),
    messagesViewport = useRef<HTMLDivElement | null>(null),
    currentMessages=useRef<Message[]>([]),
    autoScrollPending = useRef(true),
    stickToBottom = useRef(true),
    aiDraftEditor = useRef<HTMLTextAreaElement | null>(null),
    composerTextarea=useRef<HTMLTextAreaElement|null>(null),
    attachmentInput=useRef<HTMLInputElement|null>(null),
    emojiTrigger=useRef<HTMLButtonElement|null>(null),
    emojiPicker=useRef<HTMLDivElement|null>(null),
    deleteTrigger=useRef<HTMLElement|null>(null),
    deleteDialog=useRef<HTMLElement|null>(null),
    deleteClose=useRef<HTMLButtonElement|null>(null),
    summaryRequestSequence=useRef(0),
    summaryDateButtonRef=useRef<HTMLButtonElement|null>(null),
    splitTriggerRef=useRef<HTMLButtonElement|null>(null),
    clientIdentityRef=useRef<HTMLSpanElement|null>(null),
    currentActiveChannel=useRef(activeChannel),
    currentComposerText=useRef(text);
  currentSearch.current=search;
  currentSocialFilters.current=socialFilters;
  currentOrderScope.current=orderScope;
  currentActiveChannel.current=activeChannel;
  currentComposerText.current=text;
  currentConversationScope.current=conversationScope;
  currentClientCount.current=visibleClientCount;
  currentMessages.current=messages;
  const accountUrl = activeChannel === "EMAIL" ? gmailConversationUrl(messages) : connectedAccountUrl(client, activeChannel);
  function updateMessagesScrollIntent(){const viewport=messagesViewport.current;if(!viewport)return;stickToBottom.current=viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<=48;if(stickToBottom.current)setNewMessageCount(0)}
  function insertEmoji(emoji:string){const editor=composerTextarea.current,start=editor?.selectionStart??text.length,end=editor?.selectionEnd??start;invalidateAiOperation();setText(text.slice(0,start)+emoji+text.slice(end));setEmojiOpen(false);requestAnimationFrame(()=>{composerTextarea.current?.focus();composerTextarea.current?.setSelectionRange(start+emoji.length,start+emoji.length)})}
  function handleComposerKeyDown(event:KeyboardEvent<HTMLTextAreaElement>){
    if(event.key!=="Enter"||!(event.ctrlKey||event.metaKey)||event.nativeEvent.isComposing)return;
    if(busy||!client||(!text.trim()&&!attachment)||!sendableChannels.includes(activeChannel as SocialChannel))return;
    event.preventDefault();void save("SEND");
  }
  function handleComposerPaste(event:ClipboardEvent<HTMLTextAreaElement>){
    const imageItem=Array.from(event.clipboardData.items).find(item=>item.kind==="file"&&item.type.startsWith("image/"));
    if(!imageItem)return;
    const blob=imageItem.getAsFile();
    if(!blob)return;
    event.preventDefault();
    const file=new File([blob],clipboardImageName(blob.type),{type:blob.type});
    chooseAttachment(file);
  }
  function closeDeleteDialog(){
    if(deleteBusy)return;
    setDeleteTarget(undefined);
    requestAnimationFrame(()=>deleteTrigger.current?.focus());
  }
  async function setReaction(message:Message,emoji?:string){
    if(!reactionEmojisByChannel[message.channel]||message.direction!=="INBOUND"||!message.externalId||reactionBusyIds.has(message.id))return;
    const businessReaction=message.metadata?.reactions?.business,operationClientId=selectedClientId.current,operationEpoch=composeEpoch.current;
    const action=businessReaction&&(!emoji||businessReaction.emoji===emoji)?"unreact":"react";
    const isActive=()=>selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch;
    setReactionPickerMessageId(undefined);setReactionBusyIds(current=>new Set(current).add(message.id));setError("");
    try{
      const updated=await api(`/communications/messages/${encodeURIComponent(message.id)}/reaction`,{method:"POST",body:JSON.stringify({action,emoji:action==="react"?emoji:businessReaction?.emoji})}) as Message;
      if(isActive())setMessages(current=>current.map(item=>item.id===message.id?{...item,...updated,replyToMessage:item.replyToMessage}:item));
    }catch(reason){if(isActive())setError((reason as Error).message)}finally{if(isActive())setReactionBusyIds(current=>{const next=new Set(current);next.delete(message.id);return next})}
  }

  async function splitClient(){
    if(!client||!splitSourceId||splitBusy||busy)return;
    const targetId=client.id,fallbackRemovedChannels=(client.mergedClients?.find(item=>item.sourceClientId===splitSourceId)?.channels||[]) as SocialChannel[];
    if(autosaveTimer.current){clearTimeout(autosaveTimer.current);autosaveTimer.current=undefined}
    setSplitBusy(true);setSplitError("");
    try{
      if(draftSavePromise.current)await draftSavePromise.current;
      const splitResult=await api(`/clients/${targetId}/split`,{method:"POST",body:JSON.stringify({sourceClientId:splitSourceId})}) as {movedConversationIds?:string[];movedChannels?:SocialChannel[];detachedSourceClientIds?:string[]};
      setSplitOpen(false);setSplitSourceId("");
      composeEpoch.current++;draftSequence.current++;aiOperationSequence.current++;summaryRequestSequence.current++;
      composerDraftId.current=undefined;composerDraftKey.current=undefined;draftSavePromise.current=null;lastAutosavedText.current="";
      pendingSend.current={};pendingAiSend.current={};
      if(attachmentPreview)URL.revokeObjectURL(attachmentPreview);
      if(attachmentInput.current)attachmentInput.current.value="";
      const removedChannels=splitResult.movedChannels?.length?splitResult.movedChannels:fallbackRemovedChannels,movedConversationIds=new Set(splitResult.movedConversationIds||[]),detachedSourceClientIds=new Set(splitResult.detachedSourceClientIds||[splitSourceId]);
      const survivingConversations=client.conversations.filter(item=>movedConversationIds.size?!movedConversationIds.has(item.id):!removedChannels.includes(item.channel as SocialChannel));
      const survivingChannels=[...new Set(survivingConversations.map(item=>item.channel).filter((channel):channel is string=>Boolean(channel)))],survivingChannel=survivingChannels[0]||"MANUAL";
      const reconciledClient={...client,linkedChannels:survivingChannels,linkedAccounts:client.linkedAccounts?.filter(item=>!item.sourceClientId||(!detachedSourceClientIds.has(item.sourceClientId)&&survivingChannels.includes(item.channel))),mergedClients:client.mergedClients?.filter(item=>!detachedSourceClientIds.has(item.sourceClientId)),conversations:survivingConversations};
      setClient(reconciledClient);setClients(items=>items.map(item=>item.id===targetId?reconciledClient:item));setActiveChannel(survivingChannel);setMessages([]);setNewMessageCount(0);setMessagesLoading(true);
      setText("");setDraftStatus("IDLE");setAttachment(undefined);setAttachmentPreview("");setEmailReplyTarget(undefined);setSocialReplyTarget(undefined);setEmojiOpen(false);setSelectedMessageIds([]);setReplyInstruction("");setReplyMode(false);setAiReply(null);setAiDraftText("");setTranslatingId(null);setAiPreparing(false);setReactionBusyIds(new Set());setReactionPickerMessageId(undefined);
      setConversationSummaries([]);setSummaryProgress(undefined);setSummaryFirstMessageDate("");setSummaryDate("");setSummaryCalendarOpen(false);setSummaryLoading(false);setSummaryGenerating(false);
      const nextFilters=currentSocialFilters.current.filter(channel=>!removedChannels.includes(channel));
      if(nextFilters.length!==currentSocialFilters.current.length){skipNextFilterReload.current=true;currentSocialFilters.current=nextFilters;setSocialFilters(nextFilters)}
      const refreshed=await loadClients(targetId,currentClientCount.current,currentSearch.current,nextFilters,currentOrderScope.current,currentConversationScope.current);
      if(refreshed)await open(refreshed);
      else setMessagesLoading(false);
      requestAnimationFrame(()=>clientIdentityRef.current?.focus());
    }catch(reason){const code=(reason as Error).message;setSplitError(ui.splitErrors[code as keyof typeof ui.splitErrors]||ui.splitError)}finally{setSplitBusy(false)}
  }
  function scrollMessagesToLatest(){if(!messagesViewport.current)return;if(!autoScrollPending.current&&!stickToBottom.current)return;requestAnimationFrame(()=>{if(!messagesViewport.current)return;messagesViewport.current.scrollTop=messagesViewport.current.scrollHeight;stickToBottom.current=true;autoScrollPending.current=false})}
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
  async function loadConversationSummaries(operationClientId:string,operationChannel:string){
    const request=++summaryRequestSequence.current;
    setSummaryLoading(true);
    try{
      const result=await api(`/ai-assistant/clients/${encodeURIComponent(operationClientId)}/summaries?channel=${encodeURIComponent(operationChannel)}`) as {firstMessageDate?:string|null;items:ConversationSummaryItem[]};
      if(request!==summaryRequestSequence.current||selectedClientId.current!==operationClientId||currentActiveChannel.current!==operationChannel)return;
      setConversationSummaries(result.items||[]);
      setSummaryFirstMessageDate(result.firstMessageDate||"");
      const nextDate=summaryDate||result.items?.[0]?.fromDate||result.firstMessageDate||localDateKey(messages.find(message=>message.channel===operationChannel)?.createdAt||messages[0]?.createdAt||new Date());
      setSummaryDate(nextDate);setSummaryMonth(new Date(`${nextDate}T12:00:00`));
    }catch(reason){if(request===summaryRequestSequence.current&&selectedClientId.current===operationClientId&&currentActiveChannel.current===operationChannel)setError((reason as Error).message)}
    finally{if(request===summaryRequestSequence.current&&selectedClientId.current===operationClientId&&currentActiveChannel.current===operationChannel)setSummaryLoading(false)}
  }
  async function generateConversationSummary(){
    if(!client||!summaryDate||summaryGenerating)return;
    const operationClientId=client.id,operationChannel=activeChannel,operationEpoch=composeEpoch.current;
    setSummaryGenerating(true);setError("");
    try{
      const item=await api(`/ai-assistant/clients/${encodeURIComponent(operationClientId)}/summaries`,{method:"POST",body:JSON.stringify({channel:operationChannel,fromDate:summaryDate})}) as ConversationSummaryItem;
      if(selectedClientId.current!==operationClientId||composeEpoch.current!==operationEpoch||currentActiveChannel.current!==operationChannel)return;
      if(item.pending)setSummaryProgress(item);
      else{setSummaryProgress(undefined);setConversationSummaries(current=>[item,...current.filter(existing=>existing.fromDate!==item.fromDate)])}
      setSummaryCalendarOpen(false);
    }catch(reason){if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&currentActiveChannel.current===operationChannel)setError((reason as Error).message)}
    finally{if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&currentActiveChannel.current===operationChannel)setSummaryGenerating(false)}
  }
  useEffect(()=>{if(searchQuery!==undefined)setSearch(searchQuery)},[searchQuery]);
  useEffect(()=>{if(unreadRequest)setConversationScope("UNREAD")},[unreadRequest]);
  useEffect(()=>{if(contextTab==="SUMMARY"&&client)void loadConversationSummaries(client.id,activeChannel)},[contextTab,client?.id,activeChannel]);
  async function autosaveDraft(content:string){
    const operationClientId=selectedClientId.current,operationChannel=activeChannel,operationEpoch=composeEpoch.current,sequence=++draftSequence.current;
    if(!operationClientId||!content.trim()||content.trim()===lastAutosavedText.current)return;
    setDraftStatus("SAVING");
    try{
      const draftKey=composerDraftKey.current||crypto.randomUUID();composerDraftKey.current=draftKey;
      const result=await api(`/communications/${operationClientId}/drafts/${encodeURIComponent(draftKey)}`,{method:"PUT",body:JSON.stringify({content:content.trim(),channel:operationChannel})}) as Message;
      if(selectedClientId.current!==operationClientId||composeEpoch.current!==operationEpoch||sequence!==draftSequence.current)return;
      composerDraftId.current=result.id;lastAutosavedText.current=content.trim();setDraftStatus("SAVED");
      setMessages(current=>current.some(message=>message.id===result.id)?current.map(message=>message.id===result.id?{...message,...result}:message):[...current,result]);
    }catch{
      if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&sequence===draftSequence.current)setDraftStatus("ERROR");
    }
  }
  async function fetchClientWindow(count: number, query: string, selectedChannels: SocialChannel[] = [], selectedOrderScope?: OrderScope, selectedConversationScope:ConversationScope="ALL", preferredClientId?:string) {
    const items: Client[] = [];
    const seenIds = new Set<string>();
    let offset = 0;
    let hasMore = true;
    let requests = 0;
    let total=0;
    let channelCounts:Partial<Record<SocialChannel,number>>={};
    while (items.length < count && hasMore && requests++ < 100) {
      const limit = Math.min(60, Math.max(15, count - items.length));
      const channelParam=selectedChannels.length?`&channels=${encodeURIComponent(selectedChannels.join(","))}`:"";
      const orderScopeParam=selectedOrderScope?`&orderScope=${encodeURIComponent(selectedOrderScope)}`:"";
      const conversationScopeParam=selectedConversationScope!=="ALL"?`&conversationScope=${encodeURIComponent(selectedConversationScope)}`:"";
      const clientParam=offset===0&&preferredClientId?`&clientId=${encodeURIComponent(preferredClientId)}`:"";
      const page = await api(`/communications?offset=${offset}&limit=${limit}&search=${encodeURIComponent(query.trim())}${channelParam}${orderScopeParam}${conversationScopeParam}${clientParam}`) as ClientPage;
      total=page.total;channelCounts=page.channelCounts||{};
      if(page.preferredItem&&!seenIds.has(page.preferredItem.id)){seenIds.add(page.preferredItem.id);items.push(page.preferredItem)}
      for(const item of page.items)if(!seenIds.has(item.id)){seenIds.add(item.id);items.push(item)}
      offset += page.items.length;
      hasMore = page.hasMore;
      if (!page.items.length) break;
    }
    return { items:items.slice(0,count), total, channelCounts, hasMore:hasMore||items.length>count };
  }
  async function saveClientNote(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!client||busy)return;
    setBusy(true);setError("");
    try{const updated=await api("/clients/"+client.id+"/notes",{method:"PATCH",body:JSON.stringify({notes:noteText})});setClient({...client,notes:updated.notes});setClients(items=>items.map(item=>item.id===client.id?{...item,notes:updated.notes}:item));setNoteOpen(false)}
    catch(reason){setError((reason as Error).message)}finally{setBusy(false)}
  }
  function conversationDetailPath(clientId: string) {
    return `/communications/${clientId}`;
  }
  function toggleSocialFilter(item: SocialChannel) {
    setSocialFilters(current=>current.includes(item)?current.filter(channel=>channel!==item):[...current,item]);
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
  async function loadClientDetail(clientId: string) {
    const request = ++clientDetailRequest.current;
    setContextLoading(true);
    try {
      const contextOrderId=clientId===initialClientId.current?initialOrderId.current:undefined;
      const detail = await api("/clients/" + clientId+(contextOrderId?`?orderId=${encodeURIComponent(contextOrderId)}`:"")) as ClientDetail;
      if (request !== clientDetailRequest.current || selectedClientId.current !== clientId) return detail;
      if(contextOrderId&&!detail.orders?.some(order=>order.id===contextOrderId)){setError(ui.contextOrderUnavailable);initialOrderId.current=undefined;clearInboxContextAction()}
      setClientDetail(detail);
      setSelectedAthleteId(current => detail.athletes.some(athlete => athlete.id === current) ? current : detail.athletes[0]?.id);
      return detail;
    } finally {
      if (request === clientDetailRequest.current && selectedClientId.current === clientId) setContextLoading(false);
    }
  }
  async function openOrderFromChat() {
    if (!client || client.status === "LEAD") return;
    const request = { clientId: client.id, version: ++orderRequestVersion.current };
    setError("");
    try {
      const detail = clientDetail?.id === client.id ? clientDetail : await loadClientDetail(client.id);
      if (!isCurrentInboxDetailRequest(request, selectedClientId.current, orderRequestVersion.current)) return;
      if (!detail.athletes.length) {
        setAddingAthlete(true);
        return;
      }
      setClientDetail(detail);
      setSelectedAthleteId(current => detail.athletes.some(athlete => athlete.id === current) ? current : detail.athletes[0]?.id);
      setOrdering(true);
    } catch (e) {
      if (!isCurrentInboxDetailRequest(request, selectedClientId.current, orderRequestVersion.current)) return;
      setError((e as Error).message);
    }
  }
  async function openTaskFromChat() {
    if (!client || client.status === "LEAD") return;
    const request = { clientId: client.id, version: ++taskRequestVersion.current };
    setError("");
    try {
      const board = taskBoard || await api("/tasks/board?archived=false") as TaskBoard;
      if (!isCurrentInboxDetailRequest(request, selectedClientId.current, taskRequestVersion.current)) return;
      if (!board.columns.length) throw new Error(ui.noTaskColumns);
      setTaskBoard(board);
      setTasking(true);
    } catch (e) {
      if (!isCurrentInboxDetailRequest(request, selectedClientId.current, taskRequestVersion.current)) return;
      setError((e as Error).message);
    }
  }
  async function open(c: Client) {
    setMobileClientListOpen(false);
    if (shouldResetAttachmentForClient(selectedClientId.current, c.id)) {
      if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
      setAttachment(undefined);
      setAttachmentPreview("");
      pendingSend.current = {};
      pendingAiSend.current = {};
    }
    selectedClientId.current = c.id;
    volatileDrafts.current.clear();
    clientDetailRequest.current++;
    orderRequestVersion.current++;
    taskRequestVersion.current++;
    summaryRequestSequence.current++;
    setClientDetail(undefined);
    setSelectedAthleteId(undefined);
    setContextLoading(c.status !== "LEAD");
    setAddingAthlete(false);
    setOrdering(false);
    setTasking(false);
    setConversationSummaries([]);setSummaryProgress(undefined);setSummaryFirstMessageDate("");setSummaryDate("");setSummaryCalendarOpen(false);setSummaryLoading(false);setSummaryGenerating(false);
    composeEpoch.current++;
    draftSequence.current++;composerDraftId.current=undefined;composerDraftKey.current=undefined;draftSavePromise.current=null;lastAutosavedText.current="";setDraftStatus("IDLE");setText("");
    aiOperationSequence.current++;
    setSelectedMessageIds([]);setReplyInstruction("");setReplyMode(false);setEmailReplyTarget(undefined);setSocialReplyTarget(undefined);setDeleteTarget(undefined);setAiReply(null);setAiDraftText("");setTranslatingId(null);setAiPreparing(false);setReactionBusyIds(new Set());setBusy(false);
    const request = { clientId: c.id, version: ++detailVersion.current };
    manualLoading.current = true;
    setClient(c);
    setNewMessageCount(0);
    const openingChannel=latestConversation(c)?.channel||channel(c);
    setActiveChannel(openingChannel);
    autoScrollPending.current = true;
    stickToBottom.current = true;
    setMessagesLoading(true);
    setError("");
    if (c.status !== "LEAD") void loadClientDetail(c.id).catch(e => {
      if (selectedClientId.current === c.id) setError((e as Error).message);
    });
    try {
      void markClientRead(c);
      const x = await api(conversationDetailPath(c.id));
      if (
        isCurrentInboxDetailRequest(
          request,
          selectedClientId.current,
          detailVersion.current,
        )
      ){
        const nextMessages=x.messages||[],prepared=prepareInboxMessages(nextMessages,openingChannel);
        setMessages(nextMessages);
        setText(prepared.draft?.content||"");composerDraftId.current=prepared.draft?.id;composerDraftKey.current=prepared.draftKey;lastAutosavedText.current=prepared.draft?.content||"";setDraftStatus(prepared.draft?"SAVED":"IDLE");
        const firstForChannel=nextMessages.find((message:Message)=>message.channel===(latestConversation(c)?.channel||channel(c)))||nextMessages[0];
        const initialDate=localDateKey(firstForChannel?.createdAt||new Date());
        setSummaryDate(initialDate);setSummaryMonth(new Date(`${initialDate}T12:00:00`));
      }
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
  async function loadClients(id?: string, requestedCount=visibleClientCount, requestedSearch=search, requestedChannels=socialFilters, requestedOrderScope=orderScope, requestedConversationScope=conversationScope) {
    refreshRequestSequence.current++;
    const request=++listRequestSequence.current;
    listLoading.current=true;
    setLoading(true);
    setError("");
    try {
      const page = await fetchClientWindow(requestedCount, requestedSearch, requestedChannels, requestedOrderScope,requestedConversationScope,id);
      if(request!==listRequestSequence.current)return;
      const data = sortClients(page.items);
      setClients(data);
      setClientsHasMore(page.hasMore);
      setClientTotal(page.total);setChannelTotals(page.channelCounts);
      const selected = id ? data.find((x) => x.id === id) : data[0];
      if(id&&!selected&&id===initialClientId.current){setError(ui.contextClientUnavailable);initialClientId.current=undefined;initialOrderId.current=undefined;clearInboxContextAction()}
      if (selected&&selected.id===selectedClientId.current)setClient(selected);
      else if(id&&selected)await open(selected);
      else if(!selectedClientId.current&&selected)await open(selected);
      else if(!selectedClientId.current) {
        selectedClientId.current = undefined;
        setClient(undefined);
        setMessages([]);
      }
      return selected;
    } catch (e) {
      if(request===listRequestSequence.current)setError((e as Error).message);
      return undefined;
    } finally {
      if(request===listRequestSequence.current){setLoading(false);listLoading.current=false}
    }
  }
  async function refreshInbox() {
    if (listLoading.current||!canRefreshInbox(manualLoading.current, refreshing.current)) return;
    refreshing.current = true;
    const refreshRequest=++refreshRequestSequence.current;
    const observedReadVersion = readVersion.current;
    try {
      const page = await fetchClientWindow(currentClientCount.current, currentSearch.current, currentSocialFilters.current, currentOrderScope.current,currentConversationScope.current);
      setConnectionLost(false);
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
      if (!isCurrentInboxRefresh(refreshRequest,refreshRequestSequence.current,observedReadVersion,readVersion.current)) return;
      setClients(data);
      setClientsHasMore(page.hasMore);
      setClientTotal(page.total);setChannelTotals(page.channelCounts);
      const selected = data.find((x) => x.id === selectedClientId.current);
      if (selected) {
        const request = {
          clientId: selected.id,
          version: ++detailVersion.current,
        };
        const detail = await api(conversationDetailPath(selected.id));
        if (
          isCurrentInboxDetailRequest(
            request,
            selectedClientId.current,
            detailVersion.current,
          )
        ) {
          setClient(selected);
          const nextMessages=detail.messages||[],knownIds=new Set(currentMessages.current.map(message=>message.id)),newMessages=nextMessages.filter((message:Message)=>message.status!=="DRAFT"&&!knownIds.has(message.id)).length;
          if(newMessages&&!stickToBottom.current)setNewMessageCount(current=>current+newMessages);
          else if(stickToBottom.current)autoScrollPending.current=true;
          setMessages(nextMessages);
        }
      }
    } catch {
      setConnectionLost(true);
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
      setContextCollapsed(localStorage.getItem("communications-context-collapsed")==="true");
    } catch {
      localStorage.removeItem("communications-widths");
    }
    void loadClients(initialClientId.current,15,search,socialFilters,orderScope);
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
  useEffect(()=>{if(emojiOpen)requestAnimationFrame(()=>emojiPicker.current?.querySelector<HTMLButtonElement>("button")?.focus())},[emojiOpen]);
  useEffect(()=>{
    if(!deleteTarget)return;
    requestAnimationFrame(()=>deleteClose.current?.focus());
    const handleKey=(event:globalThis.KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();closeDeleteDialog();return}
      if(event.key!=="Tab"||!deleteDialog.current)return;
      const focusable=Array.from(deleteDialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if(!focusable.length){event.preventDefault();deleteDialog.current.focus();return}
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    };
    window.addEventListener("keydown",handleKey);
    return()=>window.removeEventListener("keydown",handleKey);
  },[deleteTarget?.id,deleteBusy]);
  useEffect(()=>{if(messagesLoading||!client)return;scrollMessagesToLatest()},[messagesLoading,client?.id,messages.length]);
  useEffect(()=>{if(!error)return;showInboxErrorNotification(error);setError("")},[error]);
  useEffect(()=>{
    if(messagesLoading||!client||currentComposerText.current||composerDraftId.current!==undefined)return;
    const prepared=prepareInboxMessages(messages,activeChannel);
    if(!prepared.draft)return;
    setText(prepared.draft.content);composerDraftId.current=prepared.draft.id;composerDraftKey.current=prepared.draftKey;lastAutosavedText.current=prepared.draft.content;setDraftStatus("SAVED");
  },[messagesLoading,client?.id,messages,activeChannel]);
  useEffect(()=>{
    const content=text.trim();
    if(autosaveTimer.current){clearTimeout(autosaveTimer.current);autosaveTimer.current=undefined}
    if(!client||!content||busy||splitBusy||content===lastAutosavedText.current){if(!content)setDraftStatus("IDLE");return}
    autosaveTimer.current=setTimeout(()=>{autosaveTimer.current=undefined;const previous=draftSavePromise.current,promise=(async()=>{if(previous)await previous;await autosaveDraft(content)})();draftSavePromise.current=promise;void promise.finally(()=>{if(draftSavePromise.current===promise)draftSavePromise.current=null})},900);
    return()=>{if(autosaveTimer.current){clearTimeout(autosaveTimer.current);autosaveTimer.current=undefined}};
  },[text,client?.id,activeChannel,busy,splitBusy]);
  const visibleClients=clients;
  useEffect(()=>{
    if(skipNextFilterReload.current){skipNextFilterReload.current=false;return}
    selectedClientId.current=undefined;
    setClient(undefined);
    setMessages([]);
    const timer=setTimeout(()=>{setVisibleClientCount(15);void loadClients(undefined,15,search,socialFilters,orderScope,conversationScope)},250);
    return()=>clearTimeout(timer);
  },[search,socialFilters,orderScope,conversationScope]);
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
  function promoteClient(clientId:string,message:Message){
    refreshRequestSequence.current++;
    setClients(current=>sortClients(current.map(item=>{
      if(item.id!==clientId)return item;
      let updated=false;
      const conversations=item.conversations.map(conversation=>{
        if(conversation.channel!==message.channel)return conversation;
        updated=true;
        return {...conversation,lastMessageAt:message.createdAt,messages:[{content:message.content,createdAt:message.createdAt}]};
      });
      return updated?{...item,conversations}:item;
    })));
  }
  async function save(action: "DRAFT" | "SEND",contentOverride?:string) {
    const messageText=(contentOverride??text).trim();
    if (!client || (!messageText && !attachment)) return false;
    if(action==="SEND"&&draftSavePromise.current)await draftSavePromise.current;
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
        const draftId=action==="SEND"&&content?composerDraftId.current:undefined;
        const result = await api("/communications/" + client.id + "/messages", {
          method: "POST",
          body: JSON.stringify({ ...(content ? { content } : {}), ...(file ? { attachment: file } : {}), channel: activeChannel, action, ...(action === "SEND" ? { clientRequestId: requestId || crypto.randomUUID(), ...(draftId?{draftMessageId:draftId}:{}), ...(activeChannel === "EMAIL" && emailReplyTarget ? { replyToMessageId: emailReplyTarget.id } : {}), ...(["FACEBOOK","INSTAGRAM","WHATSAPP"].includes(activeChannel) && socialReplyTarget ? { replyToMessageId:socialReplyTarget.id } : {}) } : {}) }),
        });
        if(isActive())setMessages((current) => {const next=socialReplyTarget&&["FACEBOOK","INSTAGRAM","WHATSAPP"].includes(activeChannel)?{...result,replyToMessage:{id:socialReplyTarget.id,content:socialReplyTarget.content,metadata:{attachments:socialReplyTarget.metadata?.attachments}}}:result;return draftId&&current.some(message=>message.id===draftId)?current.map(message=>message.id===draftId?next:message):[...current,next]});
        return result as Message;
      };
      const sent: Message[] = [];
      if (action === "DRAFT") {
        sent.push(await sendOne(messageText || undefined, uploaded));
      } else {
        if (activeChannel === "EMAIL" && uploaded && !pendingSend.current.attachmentDelivered) {
          const attempt = prepareAttachmentAttempt(pendingSend.current, () => crypto.randomUUID());
          pendingSend.current = attempt.state;
          const result = await sendOne(messageText || undefined, uploaded, attempt.requestId);
          if(!isActive())return false;
          sent.push(result);
          pendingSend.current = settleAttachmentAttempt(pendingSend.current, result.status);
        } else if (uploaded && !pendingSend.current.attachmentDelivered) {
          const attempt = prepareAttachmentAttempt(pendingSend.current, () => crypto.randomUUID());
          pendingSend.current = attempt.state;
          const { requestId } = attempt;
          const attachmentContent=activeChannel==="WHATSAPP"?messageText||undefined:undefined;
          const result = await sendOne(attachmentContent, uploaded, requestId);
          if(!isActive())return false;
          sent.push(result);
          pendingSend.current = settleAttachmentAttempt(pendingSend.current, result.status);
        }
        if (((activeChannel!=="WHATSAPP"||!uploaded)&&activeChannel !== "EMAIL" && !sent.some((message) => message.status === "FAILED") && messageText) || (activeChannel === "EMAIL" && !uploaded && messageText)) {
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
      const delivered=action==="SEND"?latestSuccessfulMessage(sent):undefined;
      if(delivered)promoteClient(operationClientId,delivered);
      if (failed) {
        if(failed.id===composerDraftId.current){draftSequence.current++;draftSavePromise.current=null;composerDraftId.current=undefined;composerDraftKey.current=undefined;lastAutosavedText.current="";setDraftStatus("IDLE")}
        setError(sendFailureText(failed.metadata?.reason, activeChannel));
        return false;
      }
      else {
        setText("");
        volatileDrafts.current.delete(activeChannel);
        composerDraftId.current=undefined;composerDraftKey.current=undefined;lastAutosavedText.current="";draftSequence.current++;setDraftStatus("IDLE");
        setEmailReplyTarget(undefined);
        setSocialReplyTarget(undefined);
        setEmojiOpen(false);
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
    if(file&&!attachmentMimeTypes.includes(file.type)){setError(ui.unsupportedAttachmentType);return}
    const maxBytes=file?.type==="video/mp4"?COMMUNICATION_VIDEO_MAX_BYTES:COMMUNICATION_FILE_MAX_BYTES;
    if(file&&file.size>maxBytes){setError(ui.attachmentTooLarge.replace("{size}",file.type==="video/mp4"?"16 МБ":"5 МБ"));return}
    setError("");
    setAttachment(file);
    pendingSend.current = {};
    setAttachmentPreview(file&&(file.type.startsWith("image/")||file.type.startsWith("video/")) ? URL.createObjectURL(file) : "");
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
  async function deleteMessage(mode:"CRM"|"CLIENT"){
    if(!client||!deleteTarget||deleteBusy)return;
    const target=deleteTarget,operationClientId=client.id,operationEpoch=composeEpoch.current,targetWasSelected=selectedMessageIds.includes(deleteTarget.id);
    if(mode==="CLIENT"&&!(target.channel==="CHATWOOT"&&target.status==="SENT"&&Boolean(target.externalId)))return;
    setDeleteBusy(true);setError("");
    try{
      await api(`/communications/messages/${encodeURIComponent(target.id)}/delete`,{method:"POST",body:JSON.stringify({mode,resolveDelivery:target.status==="DRAFT"||target.status==="FAILED"})});
      if(target.id===composerDraftId.current){draftSequence.current++;draftSavePromise.current=null;composerDraftId.current=undefined;composerDraftKey.current=undefined;lastAutosavedText.current="";setDraftStatus("IDLE");setText("")}
      setSelectedMessageIds(current=>current.filter(id=>id!==target.id));
      if(targetWasSelected||aiReply?.messageIds.includes(target.id)){invalidateAiOperation();setAiReply(null);setAiDraftText("")}
      const [page,detail]=await Promise.all([
        fetchClientWindow(currentClientCount.current,currentSearch.current,currentSocialFilters.current,currentOrderScope.current,currentConversationScope.current),
        api(conversationDetailPath(operationClientId)),
      ]) as [ClientPage,{messages?:Message[]}];
      if(selectedClientId.current!==operationClientId||composeEpoch.current!==operationEpoch)return;
      setClients(sortClients(page.items));setClientsHasMore(page.hasMore);setClientTotal(page.total);setChannelTotals(page.channelCounts);
      const updatedClient=page.items.find(item=>item.id===operationClientId);if(updatedClient)setClient(updatedClient);
      setMessages(detail.messages||[]);
      setDeleteTarget(undefined);requestAnimationFrame(()=>deleteTrigger.current?.focus());
    }catch(reason){
      if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setError((reason as Error).message||ui.deleteMessageError);
    }finally{
      if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setDeleteBusy(false);
    }
  }
  async function generateSelectedReply(){
    if(!client||!selectedMessageIds.length)return;
    const operationClientId=client.id,operationEpoch=composeEpoch.current,operationSequence=++aiOperationSequence.current;
    setAiPreparing(true);setError("");
    try{const x=await api("/ai-assistant/generate",{method:"POST",body:JSON.stringify({action:"REPLY",text:"",instructions:replyInstruction,clientId:operationClientId,messageIds:selectedMessageIds})});if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence){setAiDraftText(x.text);setAiReply({messageIds:[...selectedMessageIds],phase:"RUSSIAN",aiRunId:x.aiRunId})}}
    catch(e){if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setError((e as Error).message)}finally{if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setAiPreparing(false)}
  }
  async function prepareAiTranslation(){
    if(!client||!aiReply||!aiDraftText.trim())return;
    const operationClientId=client.id,operationEpoch=composeEpoch.current,operationSequence=++aiOperationSequence.current,sourceText=aiDraftText.trim();
    setAiPreparing(true);setError("");
    try{const x=await api("/ai-assistant/generate",{method:"POST",body:JSON.stringify({action:"FINALIZE_REPLY",text:sourceText,clientId:operationClientId,messageIds:aiReply.messageIds,aiRunId:aiReply.aiRunId})});if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence){setAiDraftText(x.text);setAiReply({...aiReply,phase:"TRANSLATED",sourceText,targetLanguage:x.targetLanguage,aiRunId:x.aiRunId})}}
    catch(e){if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setError((e as Error).message)}finally{if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch&&aiOperationSequence.current===operationSequence)setAiPreparing(false)}
  }
  async function sendConfirmedAiReply(){
    if(!aiReply||aiReply.phase!=="TRANSLATED")return;
    if(!client||!aiDraftText.trim())return;
    const operationClientId=client.id,operationEpoch=composeEpoch.current,content=aiDraftText.trim(),requestId=pendingAiSend.current.textContent===content&&pendingAiSend.current.textRequestId?pendingAiSend.current.textRequestId:crypto.randomUUID();
    pendingAiSend.current={textContent:content,textRequestId:requestId};setBusy(true);setError("");
    try{const result=await api("/communications/"+operationClientId+"/messages",{method:"POST",body:JSON.stringify({content,channel:activeChannel,action:"SEND",clientRequestId:requestId,aiRunId:aiReply.aiRunId})});if(selectedClientId.current!==operationClientId||composeEpoch.current!==operationEpoch)return;setMessages(current=>[...current,result]);if(result.status==="FAILED"){pendingAiSend.current={};setError(sendFailureText(result.metadata?.reason,activeChannel));return}promoteClient(operationClientId,result);pendingAiSend.current={};setSelectedMessageIds([]);setReplyInstruction("");setReplyMode(false);setAiReply(null);setAiDraftText("")}
    catch(e){if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setError((e as Error).message)}finally{if(selectedClientId.current===operationClientId&&composeEpoch.current===operationEpoch)setBusy(false)}
  }
  async function saveAsTemplate(content:string,channel:string,language="ru"){
    const suggested=content.replace(/\s+/g," ").trim().slice(0,60),entered=window.prompt(ui.templateNamePrompt,suggested);
    const name=entered?.trim().slice(0,120);if(!name||!content.trim())return;
    setTemplateBusy(true);setError("");
    try{const created=await api("/communications/templates",{method:"POST",body:JSON.stringify({name,content:content.trim(),channel,language})});setTemplates(current=>[...current,created].sort((a,b)=>a.name.localeCompare(b.name,"ru")));showInboxNotification(ui.templateSaved)}
    catch(e){setError((e as Error).message)}finally{setTemplateBusy(false)}
  }
  async function archiveTemplate(template:Template){
    if(!window.confirm(ui.deleteTemplateConfirm.replace("{name}",template.name)))return;
    setTemplateBusy(true);setError("");
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
      setSearch("");onSearchChange?.("");
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
  const availableChannels = client ? clientBadges(client) : [],
    active = availableChannels.find(item=>item.key===activeChannel)||{...sourceBadge({source:activeChannel} as Client),accountName:undefined as string|undefined},
    activeOrders=client?.orders||[],
    contextOrders=clientDetail?.orders?.length?clientDetail.orders:activeOrders,
    focusedContextOrder=contextOrders.find(order=>order.id===initialOrderId.current),
    orderedContextOrders=focusedContextOrder?[focusedContextOrder,...contextOrders.filter(order=>order.id!==focusedContextOrder.id)]:contextOrders,
    displayedContextOrders=contextTab==="CLIENT"?orderedContextOrders.slice(0,1):orderedContextOrders,
    nextTask=clientDetail?.workTasks?.[0],
    purchaseTotals=(client?.buyerSummary?.paymentTotals||[]).map(total=>[total.currency,total.amountMinor] as const),
    channelCounts=Object.fromEntries(socialChannels.map(item=>[item,channelTotals[item]||0])) as Record<SocialChannel,number>,
    preparedMessages=prepareInboxMessages(messages,activeChannel),
    displayMessages=preparedMessages.visible,
    conversationFiles=displayMessages.flatMap(message=>(message.metadata?.attachments||[]).map((attachment,index)=>({messageId:message.id,index,attachment}))),
    activeSummary=conversationSummaries.find(item=>item.fromDate===summaryDate),
    firstSummaryDate=summaryFirstMessageDate||localDateKey(displayMessages.find(message=>message.channel===activeChannel)?.createdAt||displayMessages[0]?.createdAt||new Date()),
    grid = `min(${left}px,23vw) 4px minmax(320px,1fr) ${contextCollapsed?"0px 46px":`4px min(${right}px,25vw)`}`;
  const attachmentMimeTypes=activeChannel==="WHATSAPP"?whatsappAttachmentMimeTypes:commonAttachmentMimeTypes;
  const attachmentAccept=attachmentMimeTypes.join(",");
  return (
    <div className="communications-page">
      {connectionLost&&<div className="communications-connection-state" role="status">{ui.connectionLost}</div>}
      <section
        className="communications-grid"
        style={{ gridTemplateColumns: grid }}
        aria-label={ui.workspace}
      >
        {mobileClientListOpen&&<button type="button" className="communications-mobile-clients-backdrop" aria-label={ui.close} onClick={()=>setMobileClientListOpen(false)}/>}
        <aside className={`communications-clients${mobileClientListOpen?" mobile-open":""}`} aria-label={ui.clientsList}>
      <header className="communications-list-header">
        <div className="communications-inbox-heading">
          <h1>{ui.title}</h1>
          <span>{ui.subtitle}</span>
        </div>
        <div className="communications-header-actions">
          <CrmButton className="communications-create-client" aria-label={ui.createClient} onClick={() => setCreating(true)}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          </CrmButton>
          <CrmMenu className="communications-header-menu" label={ui.moreActions} children="•••" items={[{label:ui.resetWidths,onClick:() => {
              widths.current = { ...defaults };
              setLeft(defaults.left);
              setRight(defaults.right);
              setContextCollapsed(false);
              localStorage.removeItem("communications-widths");
              localStorage.removeItem("communications-context-collapsed");
            }}]}/>
        </div>
      </header>
          <CrmSearchField
            className="communications-search-field"
            value={search}
            onValueChange={(value) => {setSearch(value);onSearchChange?.(value)}}
            placeholder={ui.search}
            ariaLabel={ui.search}
            clearLabel={ui.clearSearch}
          />
          <div className="communications-social-filters" role="group" aria-label={ui.socialNetworkFilter}>
            <button type="button" className="communications-social-filter communications-channel-filter-all" aria-pressed={!socialFilters.length} onClick={()=>setSocialFilters([])}><span>{ui.allChannels}</span><strong>{clientTotal}</strong></button>
            {socialChannels.map(item=>{const label=item==="EMAIL"?ui.gmail:ui.sources[item];return <button type="button" key={item} className={`communications-social-filter source-${item.toLowerCase()}`} aria-label={`${label}: ${channelCounts[item]}`} title={label} aria-pressed={socialFilters.includes(item)} onClick={()=>toggleSocialFilter(item)}><span aria-hidden="true">{icons[item]}</span><strong aria-hidden="true">{channelCounts[item]}</strong></button>})}
          </div>
          <div className="communications-order-filters communications-secondary-filters" role="group" aria-label={ui.orderFilter}>
            <button type="button" aria-pressed={conversationScope==="ALL"&&!orderScope} onClick={()=>{setConversationScope("ALL");setOrderScope(undefined)}}>{ui.allChannels}</button>
            <button type="button" aria-pressed={conversationScope==="UNREAD"} onClick={()=>setConversationScope(current=>current==="UNREAD"?"ALL":"UNREAD")}>{ui.unreadChats}</button>
            <button type="button" aria-pressed={conversationScope==="CLIENTS"} onClick={()=>setConversationScope(current=>current==="CLIENTS"?"ALL":"CLIENTS")}>{ui.clientFilter}</button>
            <CrmNativeSelect className="communications-order-scope" aria-label={ui.orderFilter} value={orderScope||""} onChange={event=>setOrderScope((event.target.value||undefined) as typeof orderScope)} data={[{value:"",label:ui.orderScopeMenu},{value:"WITH_ORDERS",label:ui.clientsWithOrders},{value:"ACTIVE_ORDERS",label:ui.clientsWithActiveOrders}]}/>
          </div>
          <div className="communications-client-list">
          {loading ? (
            <InboxSkeleton kind="conversations" rows={6}/>
          ) : (
            visibleClients.map((c) => {
              const badges = clientBadges(c),
                unread = c.conversations.reduce(
                  (sum, x) => sum + (x.unreadCount || 0),
                  0,
                ),
                latest = latestConversation(c),
                last = latest?.messages?.[0],
                primaryBadge=badges.find(badge=>badge.key===latest?.channel)||badges[0],
                purchaseCount=c.buyerSummary?.purchaseCount||0,
                activeOrderCount=c.orders?.length||0;
              return (
                <button
                  key={c.id}
                  className={client?.id === c.id ? "active" : ""}
                  onClick={() => void open(c)}
                >
                  <span className="communications-client-avatar-wrap">
                    <ClientAvatar className="communications-avatar" displayName={c.displayName} avatarUrl={c.avatarUrl} />
                    {primaryBadge&&<span className={`communications-avatar-source source-${primaryBadge.key.toLowerCase()}`} title={primaryBadge.label} aria-label={primaryBadge.label}>{primaryBadge.icon}</span>}
                    {purchaseCount>0&&<span className={`communications-client-order-count ${activeOrderCount>0?"is-active":"is-completed"}`} title={`${ui.orderCount}: ${purchaseCount}. ${activeOrderCount>0?ui.activeOrderBadge:ui.completedOrderBadge}`} aria-label={`${ui.orderCount}: ${purchaseCount}. ${activeOrderCount>0?ui.activeOrderBadge:ui.completedOrderBadge}`}>{purchaseCount>99?"99+":purchaseCount}</span>}
                  </span>
                  <div>
                    <span className="communications-client-name">
                      <b>{c.displayName}</b>
                      {badges.length>1&&<span className="communications-source-icons">{badges.filter(badge=>badge.key!==primaryBadge?.key).map(badge=><span key={badge.key} className={`communications-source-icon source-${badge.key.toLowerCase()}`} title={badge.label} aria-label={badge.label}>{badge.icon}</span>)}</span>}
                    </span>
                    <small className="communications-client-preview">
                      {last?.content || badges.map((b) => b.label).join(" · ")}
                    </small>
                    <span className="communications-client-tags">{c.status!=="LEAD"&&<span>{ui.clientFilter}</span>}{activeOrderCount>0&&<span className="has-order">{ui.activeOrdersShort} {activeOrderCount}</span>}{c.hasSummary&&<span className="has-summary">{ui.contextSummary}</span>}</span>
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
          {!loading&&clientsHasMore&&<button type="button" className="communications-load-more" aria-label={ui.loadMoreChats} onClick={()=>{const next=visibleClientCount+15;setVisibleClientCount(next);void loadClients(selectedClientId.current,next,search,socialFilters,orderScope,conversationScope)}}><span aria-hidden="true">＋</span><b>{ui.loadMoreChats}</b></button>}
          {!loading && !visibleClients.length && (
            <State text={orderScope ? ui.noOrderFilterResults : socialFilters.length ? ui.noSocialNetworkResults : search ? ui.noSearchResults : ui.noClients} />
          )}
          </div>
        </aside>
        <Resizer
          side="left"
          value={left}
          onPointer={resize}
          onKey={resizeByKeyboard}
        />
        <main className="communications-chat">
          <header className="communications-chat-header">
            <button type="button" className="communications-mobile-list-toggle" aria-expanded={mobileClientListOpen} onClick={()=>setMobileClientListOpen(true)}>{ui.openClientList}</button>
            <span className="communications-chat-client" ref={clientIdentityRef} tabIndex={-1}>
              {client && <ClientAvatar className="communications-avatar" displayName={client.displayName} avatarUrl={client?.avatarUrl} />}
              <span className="communications-chat-client-copy">
                <b>{client?.displayName || ui.selectClient}</b>
                {client&&<span className="communications-chat-badges">{availableChannels.map(item=>{const channelText=`${item.label}${item.accountName?` / ${item.accountName}`:""}`;return <span className="is-channel" aria-label={channelText} title={channelText} key={item.key}><i aria-hidden="true">{item.icon}</i><b>{item.label}</b>{item.accountName&&<small> / {item.accountName}</small>}</span>})}{client.country&&<span><InboxCountryFlag country={client.country}/> {client.country}</span>}{client.status!=="LEAD"&&<span>{ui.clientFilter}</span>}{activeOrders.length>0&&<span className="success">{activeOrders.length} {ui.activeOrdersShort}</span>}{client.hasSummary&&<span className="success">{ui.contextSummary}</span>}</span>}
                {accountUrl && <a className="communications-chat-account" href={accountUrl} target="_blank" rel="noopener noreferrer" title={ui.openInSocialNetwork}><span>{ui.openConversationByChannel[activeChannel as keyof typeof ui.openConversationByChannel] || ui.openInSocialNetwork} ↗</span></a>}
              </span>
            </span>
            {client?.mergedClients?.length?<CrmActionIcon ref={splitTriggerRef} type="button" className="communications-split-client" variant="light" color="violet" size={40} aria-label={ui.splitAccounts} title={ui.splitAccounts} onClick={()=>{setSplitError("");setSplitSourceId(client.mergedClients?.[0]?.sourceClientId||"");setSplitOpen(true)}}>⇄</CrmActionIcon>:null}
            {client && (availableChannels.length > 1 ? (
              <CrmNativeSelect label={ui.replyChannel} value={activeChannel} onChange={event=>{volatileDrafts.current.set(activeChannel,text);const nextChannel=event.target.value,prepared=restoreInboxDraft(messages,nextChannel,volatileDrafts.current.get(nextChannel));draftSequence.current++;summaryRequestSequence.current++;composerDraftId.current=prepared.draft?.id;composerDraftKey.current=prepared.draftKey;lastAutosavedText.current=prepared.draft?.content||"";setText(prepared.content);setDraftStatus(prepared.draft?"SAVED":"IDLE");setActiveChannel(nextChannel);setConversationSummaries([]);setSummaryProgress(undefined);setSummaryFirstMessageDate("");setSummaryDate("");setSummaryCalendarOpen(false);setSummaryLoading(false);setSummaryGenerating(false);setEmailReplyTarget(undefined);setSocialReplyTarget(undefined);setEmojiOpen(false)}} data={availableChannels.map(item=>({value:item.key,label:`${item.icon} ${item.label}${item.accountName?` / ${item.accountName}`:""}`}))}/>
            ) : (
              <span className="communications-active-channel" title={`${active.label}${active.accountName?` / ${active.accountName}`:""}`} aria-label={`${active.label}${active.accountName?` / ${active.accountName}`:""}`}>{active.icon} {active.label}{active.accountName?` / ${active.accountName}`:""}</span>
            ))}
            {client&&<button type="button" className="communications-context-toggle" aria-expanded={contextOpen} onClick={()=>setContextOpen(true)}>{ui.clientCard}</button>}
          </header>
          <div className="communications-messages" ref={messagesViewport} onScroll={updateMessagesScrollIntent}>
            <div className="communications-message-stack">
            {messagesLoading ? (
              <InboxSkeleton kind="messages" rows={4}/>
            ) : (
              displayMessages.map((message,messageIndex) => {
                const attachments = message.metadata?.attachments || [];
                const hasVisualAttachment = attachments.some((attachment) => ["image", "sticker", "video"].includes(attachment.type));
                const canSelectForReply = replyMode && !hasVisualAttachment && message.direction === "INBOUND";
                const externalReply = message.direction === "OUTBOUND" && ["META","META_ECHO","CHATWOOT","GMAIL"].includes(message.metadata?.source || "");
                const replyContext=message.metadata?.replyTo;
                const engagement=message.metadata?.engagement;
                const customerReaction=message.metadata?.reactions?.customer,businessReaction=message.metadata?.reactions?.business;
                const reactionEmojis=reactionEmojisByChannel[message.channel]||[],canReact=message.direction==="INBOUND"&&Boolean(message.externalId)&&reactionEmojis.length>0;
                const canSocialReply=message.direction==="INBOUND"&&Boolean(message.externalId)&&(["INSTAGRAM","WHATSAPP"].includes(message.channel)||(message.channel==="FACEBOOK"&&Boolean(engagement)));
                const replyMedia=message.replyToMessage?.metadata?.attachments?.find(item=>item.url&&["image","sticker","video"].includes(item.type));
                const storyUrl=safeAttachmentUrl(replyContext?.storyUrl),replyMediaUrl=safeAttachmentUrl(replyMedia?.url),engagementMediaUrl=safeAttachmentUrl(engagement?.mediaUrl),engagementPermalink=safeAttachmentUrl(engagement?.permalinkUrl);
                const previousCreatedAt=displayMessages[messageIndex-1]?.createdAt,showDay=!previousCreatedAt||messageDayKey(previousCreatedAt)!==messageDayKey(message.createdAt);
                return (<Fragment key={message.id}>
                  {showDay&&<div className="communications-date-separator"><span>{formatMessageDay(message.createdAt)}</span></div>}
                  <article
                    className={`${message.direction === "OUTBOUND" ? "out" : "in"}${canSelectForReply ? " selectable" : ""}${hasVisualAttachment&&!message.content?" media-only":""}`}
                  >
                    {message.direction==="INBOUND"&&client&&<span className="communications-message-avatar" aria-hidden="true"><ClientAvatar className="communications-avatar" displayName={client.displayName} avatarUrl={client.avatarUrl}/></span>}
                    {message.direction==="OUTBOUND"&&<span className="communications-message-avatar is-business" aria-hidden="true">{businessLogoUrl?<img className="communications-business-logo" src={businessLogoUrl} alt=""/>:"Y"}</span>}
                    <span className="communications-message-actions">
                      <button type="button" aria-label={ui.copyMessage} title={ui.copyMessage} onClick={()=>void navigator.clipboard.writeText(message.content).then(()=>showInboxNotification(ui.messageCopied)).catch(()=>setError(ui.copyFailed))}>⧉</button>
                      <details className="communications-message-more"><summary aria-label={ui.moreActions} title={ui.moreActions}>⋯</summary><span role="menu"><button type="button" role="menuitem" onClick={()=>void navigator.clipboard.writeText(message.content).then(()=>showInboxNotification(ui.messageCopied)).catch(()=>setError(ui.copyFailed))}>{ui.copyMessage}</button>{canSocialReply&&<button type="button" role="menuitem" onClick={()=>{setSocialReplyTarget(message);requestAnimationFrame(()=>composerTextarea.current?.focus())}}>{ui.reply}</button>}{message.direction==="INBOUND"&&!hasVisualAttachment&&shouldOfferInboundTranslation(message.language)&&<button type="button" role="menuitem" disabled={translatingId===message.id} onClick={()=>void translateMessage(message)}>{ui.translate}</button>}{message.direction==="OUTBOUND"&&<button type="button" role="menuitem" className="communications-message-delete" onClick={event=>{const details=event.currentTarget.closest("details");deleteTrigger.current=details?.querySelector("summary")||event.currentTarget;details?.removeAttribute("open");setDeleteTarget(message)}}>{ui.deleteMessage}</button>}</span></details>
                    </span>
                    {canSelectForReply && <label className="communications-message-select"><input type="checkbox" checked={selectedMessageIds.includes(message.id)} onChange={()=>toggleMessage(message.id)} aria-label={ui.selectMessageForReply}/></label>}
                    {externalReply && <small className="communications-external-message-source">{ui.externalReplyByChannel[message.channel as keyof typeof ui.externalReplyByChannel] || ui.externalReplyOutsideCrm}</small>}
                    {engagement&&<div className="communications-engagement-context">
                      <b>{engagement.kind==="comment"?(engagement.surface==="story"?ui.commentOnStory:engagement.surface==="reel"?ui.commentOnReel:engagement.surface==="live"?ui.commentOnLive:engagement.surface==="comment"?ui.replyToComment:ui.commentOnPost):engagement.kind==="mention"?ui.mentionInContent:engagement.kind==="share"?ui.sharedSocialContent:(engagement.action==="remove"?ui.removedReaction:ui.reactionOnContent)}</b>
                      {engagementMediaUrl&&<ReplyMedia url={engagementMediaUrl} label={ui.socialContentMedia} onOpen={(event,type)=>{previewTrigger.current=event.currentTarget;setPreview({url:engagementMediaUrl,type})}} onLoad={scrollMessagesToLatest}/>}
                      {engagementPermalink&&<a href={engagementPermalink} target="_blank" rel="noreferrer">{ui.openSocialContent} ↗</a>}
                    </div>}
                    {(replyContext||message.replyToMessage)&&<div className="communications-reply-context"><b>{replyContext?.kind==="story"?ui.storyReply:ui.messageReply}</b>{storyUrl&&<ReplyMedia url={storyUrl} type={replyContext?.storyMediaType==="video"?"video":"image"} label={ui.storyMedia} onOpen={(event,type)=>{previewTrigger.current=event.currentTarget;setPreview({url:storyUrl,type})}} onLoad={scrollMessagesToLatest}/>} {replyMediaUrl&&<ReplyMedia url={replyMediaUrl} type={replyMedia?.type==="video"?"video":"image"} label={ui.quotedMedia} onOpen={(event,type)=>{previewTrigger.current=event.currentTarget;setPreview({url:replyMediaUrl,type})}} onLoad={scrollMessagesToLatest}/>} {message.replyToMessage?<span>{message.replyToMessage.content}</span>:replyContext?.kind==="message"?<span>{ui.originalMessageUnavailable}</span>:null}</div>}
                    {message.channel==="EMAIL"&&message.metadata?.emailHtml?<div className="communications-message-content email-rich-content" dangerouslySetInnerHTML={{__html:message.metadata.emailHtml}}/>:<span className="communications-message-content">{message.content}</span>}
                    {attachments.length > 0 && (
                      <div className={`communications-attachments${attachments.length>1?" is-gallery":""}`}>
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
                              {attachment.type==="video"?<video src={url} preload="metadata" muted playsInline aria-label={label} onLoadedMetadata={scrollMessagesToLatest}/>:<img src={url} alt={label} onLoad={scrollMessagesToLatest}/>}
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
                    {(customerReaction||businessReaction)&&<div className="communications-message-reactions">
                      {customerReaction&&<span title={ui.customerReaction}>{customerReaction.emoji||"❤️"}</span>}
                      {businessReaction&&<button type="button" className="business" disabled={reactionBusyIds.has(message.id)} aria-label={ui.removeReaction} title={ui.removeReaction} onClick={()=>void setReaction(message,businessReaction.emoji)}>{businessReaction.emoji||"❤️"}</button>}
                    </div>}
                    {(canReact||canSocialReply)&&<span className="communications-reaction-control" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setReactionPickerMessageId(current=>current===message.id?undefined:current)}}>
                      {canSocialReply&&<button type="button" className="communications-message-reply" aria-label={ui.replyToSocialMessage} title={ui.replyToSocialMessage} onClick={()=>{setSocialReplyTarget(message);requestAnimationFrame(()=>composerTextarea.current?.focus())}}>↩</button>}
                      {canReact&&<button type="button" className="communications-reaction-trigger" disabled={reactionBusyIds.has(message.id)} aria-label={ui.reactToMessage} title={ui.reactToMessage} aria-haspopup="dialog" aria-expanded={reactionPickerMessageId===message.id} onClick={()=>setReactionPickerMessageId(current=>current===message.id?undefined:message.id)}>☺</button>}
                      {canReact&&reactionPickerMessageId===message.id&&<span className="communications-reaction-picker" role="dialog" aria-label={ui.reactionPanel} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();setReactionPickerMessageId(undefined)}}}>{reactionEmojis.map(emoji=><button type="button" key={emoji} className={businessReaction?.emoji===emoji?"selected":undefined} disabled={reactionBusyIds.has(message.id)} aria-label={`${businessReaction?.emoji===emoji?ui.removeReaction:ui.addReaction} ${emoji}`} onClick={()=>void setReaction(message,emoji)}>{emoji}</button>)}</span>}
                    </span>}
                    <small className="communications-message-meta">
                      {message.status === "FAILED" ? ui.failed : ""}{message.status === "FAILED" ? " · " : ""}
                      {formatMessageDateTime(message.createdAt)}
                      {message.direction === "OUTBOUND" && message.metadata?.metaReadAt && <span className="communications-message-read" title={ui.messageRead} aria-label={ui.messageRead} role="img"></span>}
                    </small>
                    {message.direction === "INBOUND" && !hasVisualAttachment && shouldOfferInboundTranslation(message.language) && <button type="button" className="communications-message-translate" aria-label={translatingId===message.id?ui.translating:message.metadata?.translation?.text?ui.translateAgain:ui.translate} title={translatingId===message.id?ui.translating:message.metadata?.translation?.text?ui.translateAgain:ui.translate} disabled={translatingId===message.id} onClick={()=>void translateMessage(message)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M8.5 3v3c0 4-2 7-5 9M6 10.5c1.4 2.1 3.5 3.7 6 4.5M13 21l4-10 4 10M14.5 17.5h5"/></svg></button>}
                    {message.channel==="EMAIL"&&message.direction==="INBOUND"&&message.metadata?.messageId&&<button type="button" className="communications-email-reply" aria-label={`${ui.replyToEmail}: ${message.metadata.subject||ui.emailWithoutSubject}`} onClick={()=>{setEmailReplyTarget(message);requestAnimationFrame(()=>composerTextarea.current?.focus())}}>{ui.replyToEmail}</button>}
                    {message.direction === "OUTBOUND" && <button type="button" className="communications-save-template" aria-label={ui.saveAsTemplate} title={ui.saveAsTemplate} disabled={templateBusy} onClick={()=>void saveAsTemplate(message.content,message.channel)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.75L6 21V4.75Z"/><path d="M12 7v6M9 10h6"/></svg></button>}
                  </article>
                </Fragment>
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
            {!messagesLoading && client && !displayMessages.length && (
              <State text={ui.emptyMessages} />
            )}{" "}
            {!client && !loading && <State text={ui.selectClientHint} />}
            </div>
            {newMessageCount>0&&<button type="button" className="communications-new-messages" onClick={()=>{setNewMessageCount(0);autoScrollPending.current=true;scrollMessagesToLatest()}}>↓ {newMessageCount} {ui.newMessages}</button>}
          </div>
          <footer>
            <div className="communications-ai">
              <button type="button" className="communications-request-measurements" disabled={!client||!templates.some(template=>/мерк|measure/i.test(template.name))} onClick={()=>{const template=templates.find(item=>/мерк|measure/i.test(item.name));if(template)chooseTemplate(template)}}>{ui.requestMeasurements}</button>
              <details className="communications-composer-more"><summary aria-label={ui.moreActions}>⋯</summary><button type="button" disabled={busy||aiPreparing||!client} onClick={()=>void ai("IMPROVE")}>{ui.improve}</button></details>

              <button type="button" className="communications-ai-reply" disabled={busy||!client} onClick={()=>{if(replyMode){invalidateAiOperation();setSelectedMessageIds([]);setReplyInstruction("");setAiReply(null);setAiDraftText("")}setReplyMode(!replyMode)}}>{replyMode?ui.cancelReplySelection:ui.replyAi}{selectedMessageIds.length?` (${selectedMessageIds.length})`:""}</button>
              {(
                [
                  ["TRANSLATE", ui.translate],
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
                  {ui.templatesButton}
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
            {activeChannel==="EMAIL"&&emailReplyTarget&&<div id="email-reply-target" role="status" className="communications-email-reply-target"><span><b>{ui.replyingToEmail}: {emailReplyTarget.metadata?.subject||ui.emailWithoutSubject}</b><small>{shortMessagePreview(emailReplyTarget.content)}</small></span><button type="button" aria-label={ui.cancelEmailReply} title={ui.cancelEmailReply} onClick={()=>{setEmailReplyTarget(undefined);requestAnimationFrame(()=>composerTextarea.current?.focus())}}>×</button></div>}
            {["FACEBOOK","INSTAGRAM","WHATSAPP"].includes(activeChannel)&&socialReplyTarget&&<div id="social-reply-target" role="status" className="communications-social-reply-target"><span><b>{socialReplyTarget.metadata?.engagement?.kind==="comment"?ui.replyingToComment:ui.replyingToMessage}</b><small>{shortMessagePreview(socialReplyTarget.content)}</small></span><button type="button" aria-label={ui.cancelSocialReply} title={ui.cancelSocialReply} onClick={()=>{setSocialReplyTarget(undefined);requestAnimationFrame(()=>composerTextarea.current?.focus())}}>×</button></div>}
            {attachment && (
              <div className="communications-selected-attachment">
                {attachmentPreview && (attachment?.type.startsWith("video/")?<video src={attachmentPreview} aria-label={ui.selectedAttachment} preload="metadata" muted playsInline/>:<img src={attachmentPreview} alt={ui.selectedAttachment} />)}
                <span><b>{attachment.name}</b><small>{formatBytes(attachment.size)}</small></span>
                <button type="button" onClick={() => chooseAttachment()} aria-label={ui.removeAttachment}>×</button>
              </div>
            )}
            <div className="communications-compose">
              <label className="communications-attach" aria-label={ui.attachFile}>
                <span aria-hidden>＋</span>
                <input ref={attachmentInput} type="file" accept={attachmentAccept} disabled={!client || busy} onChange={(event) => { chooseAttachment(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
              {["FACEBOOK", "INSTAGRAM", "WHATSAPP", "CHATWOOT"].includes(activeChannel) && <span className="communications-emoji-control" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setEmojiOpen(false)}}><button ref={emojiTrigger} type="button" className="communications-emoji-trigger" aria-label={ui.chooseEmoji} aria-haspopup="dialog" aria-expanded={emojiOpen} disabled={!client||busy} onClick={()=>setEmojiOpen(value=>!value)}>☺</button>{emojiOpen&&<div ref={emojiPicker} className="communications-emoji-picker" role="dialog" aria-label={ui.emojiPanel} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();setEmojiOpen(false);emojiTrigger.current?.focus()}}}>{standardEmojis.map(emoji=><button type="button" key={emoji} onClick={()=>insertEmoji(emoji)} aria-label={`${ui.insertEmoji} ${emoji}`}>{emoji}</button>)}</div>}</span>}
              <textarea
                ref={composerTextarea}
                rows={1}
                aria-describedby={activeChannel==="EMAIL"&&emailReplyTarget?"email-reply-target":socialReplyTarget&&["FACEBOOK","INSTAGRAM","WHATSAPP"].includes(activeChannel)?"social-reply-target":undefined}
                value={text}
                onChange={(e) => {invalidateAiOperation();setText(e.target.value);e.currentTarget.style.height="auto";e.currentTarget.style.height=`${Math.min(e.currentTarget.scrollHeight,140)}px`}}
                onPaste={handleComposerPaste}
                onKeyDown={handleComposerKeyDown}
                aria-keyshortcuts="Control+Enter Meta+Enter"
                title={ui.sendShortcut}
                placeholder={client?ui.writeToClient.replace("{name}",client.displayName):ui.messagePlaceholder}
                disabled={!client}
              />
              <span className={`communications-draft-status is-${draftStatus.toLowerCase()}`} role="status">{draftStatus==="SAVING"?ui.draftAutosaving:draftStatus==="SAVED"?ui.draftAutosaved:draftStatus==="ERROR"?ui.draftAutosaveFailed:""}</span>
              {["FACEBOOK", "INSTAGRAM", "WHATSAPP", "CHATWOOT", "EMAIL"].includes(activeChannel) && (
                <button
                  disabled={busy || !client || (!text.trim() && !attachment)}
                  onClick={() => void save("SEND")}
                >
                  {busy ? ui.sending : ui.sendMessage}
                </button>
              )}
              <details className="communications-send-options"><summary aria-label={ui.sendOptions}>⌄</summary><button type="button" disabled={templateBusy||!client||!text.trim()} onClick={()=>void saveAsTemplate(text,activeChannel)}>{ui.saveAsTemplate}</button></details>
            </div>
            <div className="communications-compose-shortcuts" aria-label={ui.composerShortcuts}>
              <button type="button" disabled={!client||busy} onClick={()=>attachmentInput.current?.click()}>＋ {ui.attachFileShort}</button>
              <button type="button" disabled={!client||busy} onClick={()=>attachmentInput.current?.click()}>▧ {ui.attachPhotoVideo}</button>
              <button type="button" disabled={!activeOrders[0]} onClick={()=>activeOrders[0]&&onNavigate?.("finance",{action:"new-invoice",orderId:activeOrders[0].id})}>▤ {ui.invoiceShortcut}</button>
              <button type="button" disabled={!client||client.status==="LEAD"} onClick={()=>client&&onNavigate?.("clients",{clientId:client.id})}>⌁ {ui.measurementsShortcut}</button>
              <button type="button" disabled={!templates.length} onClick={()=>setTemplatesOpen(true)}>▣ {ui.quickReply}</button>
            </div>
          </footer>
        </main>
        {contextCollapsed?<span className="communications-context-collapsed-spacer" aria-hidden="true"/>:<Resizer
          side="right"
          value={right}
          onPointer={resize}
          onKey={resizeByKeyboard}
        />}
        {contextOpen&&<button type="button" className="communications-context-backdrop" aria-label={ui.closeClientCard} onClick={()=>setContextOpen(false)}/>}
        <aside className={`communications-orders communications-context-panel${contextOpen?" open":""}${contextCollapsed?" collapsed":""}`} aria-label={ui.clientCard}>
          <button type="button" className="communications-context-collapse" aria-label={contextCollapsed?ui.expandClientCard:ui.collapseClientCard} aria-expanded={!contextCollapsed} onClick={()=>{const next=!contextCollapsed;setContextCollapsed(next);localStorage.setItem("communications-context-collapsed",String(next))}}>{contextCollapsed?"‹":"›"}</button>
          <button type="button" className="communications-context-close" aria-label={ui.closeClientCard} onClick={()=>setContextOpen(false)}>×</button>
          {client&&<>
          <ContextTabs active={contextTab} onChange={setContextTab}/>
          <div id="communications-context-tabpanel" className="communications-context-tabpanel" role="tabpanel" aria-labelledby={`communications-context-tab-${contextTab.toLowerCase()}`} data-active-tab={contextTab}>
          <section className="communications-context-profile communications-buyer-card"><ClientAvatar className="communications-avatar" displayName={client.displayName} avatarUrl={client.avatarUrl}/><div><b>{client.displayName}</b><span className="communications-profile-channel">{active.icon} {active.label}</span>{accountUrl&&<a className="communications-profile-link" href={accountUrl} target="_blank" rel="noopener noreferrer">{ui.openConversationByChannel[activeChannel as keyof typeof ui.openConversationByChannel]||ui.openInSocialNetwork} ↗</a>}<small>{client.status==="LEAD"?ui.unsavedBuyer:ui.savedBuyer}</small></div><div className="communications-profile-facts">{client.phone&&<p><span>{ui.phone}</span><b>{client.phone}</b></p>}{client.email&&<p><span>{ui.email}</span><b>{client.email}</b></p>}{client.city&&<p><span>{ui.city}</span><b>{client.city}</b></p>}{client.country&&<p><span>{ui.country}</span><b><InboxCountryFlag country={client.country}/> {client.country}</b></p>}{client.timezone&&<p><span>{ui.timezone}</span><b title={client.timezone}>{clientLocalTime(client.timezone)}</b></p>}{client.language&&<p><span>{ui.language}</span><b>{client.language}</b></p>}{client.instagramUsername&&<p><span>{ui.instagramUsername}</span><b>{instagramHandle(client.instagramUsername)}</b></p>}{client.instagram&&<p><span>{isInstagramScopedId(client.instagram)?ui.instagramSid:ui.instagram}</span><b>{client.instagram}</b></p>}{client.facebook&&<p><span>{ui.facebookSid}</span><b>{client.facebook}</b></p>}</div>{client.status==="LEAD"?<button type="button" onClick={()=>setCreating(true)}>{ui.saveBuyer}</button>:<div className="communications-purchase-summary"><span>{ui.purchaseHistory}: {client.buyerSummary?.purchaseCount||0}</span>{purchaseTotals.map(([currency,total])=><strong key={currency}>{(total/100).toFixed(2)} {currency}</strong>)}</div>}</section>
          {client.status!=="LEAD"&&<section className="communications-context-section communications-context-athletes"><header><b>{ui.athletes}</b><small>{clientDetail?.athletes.length||0}</small><button ref={addAthleteTriggerRef} type="button" onClick={()=>setAddingAthlete(true)}>＋ {ui.add}</button></header>{contextLoading?<small>{ui.loadingAthletes}</small>:clientDetail?.athletes.length?<div>{clientDetail.athletes.map(athlete=><label key={athlete.id}><input type="radio" name="chat-athlete" checked={selectedAthleteId===athlete.id} onChange={()=>setSelectedAthleteId(athlete.id)}/><span><b>{athlete.firstName} {athlete.lastName||""}</b>{athlete.discipline&&<small>{athlete.discipline}</small>}{athlete.measurements[0]&&<small>{ui.latestMeasurements}: {new Date(athlete.measurements[0].measuredAt).toLocaleDateString("ru-RU")}</small>}{athlete.measurements[0]&&<span className="communications-athlete-measurements">{inboxMeasurements(athlete.measurements[0]).map(({field,value,unit})=><span key={field}><small>{ui.measurementFields[field]}</small><b>{value} <small>{unit}</small></b></span>)}</span>}</span></label>)}</div>:<small>{ui.noAthletes}</small>}</section>}
          {client.status!=="LEAD"&&<section className="communications-context-section communications-context-actions"><header><b>{ui.quickActions}</b></header><div><button type="button" onClick={()=>void openTaskFromChat()}>✓ <span>{ui.createTask}</span></button><button ref={orderTriggerRef} type="button" onClick={()=>void openOrderFromChat()}>▣ <span>{ui.createOrder}</span></button><button type="button" disabled={!activeOrders[0]} onClick={()=>activeOrders[0]&&onNavigate?.("finance",{action:"new-invoice",orderId:activeOrders[0].id})}>₴ <span>{ui.createInvoice}</span></button><button type="button" onClick={()=>{setNoteText(client.notes||"");setNoteOpen(true)}}>✎ <span>{ui.addNote}</span></button></div></section>}
          {client.status!=="LEAD"&&<section className="communications-context-section communications-context-note"><header><b>{ui.chatNote}</b><button type="button" onClick={()=>{setNoteText(client.notes||"");setNoteOpen(true)}}>{client.notes?ui.edit:ui.add}</button></header>{client.notes?<p>{client.notes}</p>:<small>{ui.noChatNote}</small>}</section>}
          {client.status!=="LEAD"&&<section className="communications-context-section communications-context-orders"><header><b>{ui.activeOrders}</b><small>{activeOrders.length}</small><button type="button" aria-label={ui.createOrder} onClick={()=>void openOrderFromChat()}>＋</button></header>
          {displayedContextOrders.map((o) => (
            <article className={o.id===initialOrderId.current?"is-context":undefined} key={o.id}>
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
                <small className="communications-order-payment is-paid">{ui.paid}: {(orderPaidMinor(o)/100).toFixed(2)} {o.currency}</small>
                <small className="communications-order-payment is-balance">{ui.balance}: {(Math.max(0,o.priceMinor-orderPaidMinor(o))/100).toFixed(2)} {o.currency}</small>
              </div>
            </article>
          ))}
          {contextTab==="CLIENT"&&activeOrders.length>1&&<button type="button" className="communications-more-orders" onClick={()=>setContextTab("ORDERS")}>{ui.moreOrders.replace("{count}",String(activeOrders.length-1))}</button>}
          {!activeOrders.length && <State text={ui.noActiveOrders} />}</section>}
          {client.status!=="LEAD"&&<section className="communications-context-section communications-context-next"><header><b>{ui.nextAction}</b>{nextTask&&<button type="button" onClick={()=>onNavigate?.("tasks",{clientId:client.id,taskId:nextTask.id})}>{ui.edit}</button>}</header>{nextTask?<p style={{borderLeftColor:nextTask.markerColor}}><b>{nextTask.title}</b>{nextTask.description&&<span>{nextTask.description}</span>}{nextTask.dueAt&&<small>{new Date(nextTask.dueAt).toLocaleString("ru-RU",{dateStyle:"medium",timeStyle:"short"})}</small>}{nextTask.assignee&&<small>{ui.responsible}: {nextTask.assignee.displayName}</small>}</p>:client.nextActionAt?<p><b>{ui.contactClient}</b><small>{new Date(client.nextActionAt).toLocaleString("ru-RU",{dateStyle:"medium",timeStyle:"short"})}</small></p>:<p><span>{ui.noNextAction}</span><button type="button" onClick={()=>void openTaskFromChat()}>{ui.createTask}</button></p>}</section>}
          <section className="communications-context-section communications-context-files"><header><b>{ui.contextFiles}</b><small>{conversationFiles.length}</small></header>{conversationFiles.length?<div className="communications-context-file-grid">{conversationFiles.map(({messageId,index,attachment})=>{const url=safeAttachmentUrl(attachment.url),label=attachment.name||ui.attachmentTypes[attachment.type as keyof typeof ui.attachmentTypes]||ui.attachmentTypes.fallback,isMedia=["image","sticker","video"].includes(attachment.type);return url&&isMedia?<button type="button" className={`communications-context-file-preview${attachment.type==="video"?" is-video":""}`} key={`${messageId}-${index}`} aria-label={`${ui.openAttachment}: ${label}`} title={label} onClick={event=>{previewTrigger.current=event.currentTarget;setPreview({url,type:attachment.type==="video"?"video":"image"})}}>{attachment.type==="video"?<video src={url} preload="metadata" muted playsInline aria-label={label}/>:<img src={url} alt={label}/>}<span>{label}</span></button>:url?<a className="communications-context-file-card" key={`${messageId}-${index}`} href={url} target="_blank" rel="noopener noreferrer" title={label}><b aria-hidden="true">▧</b><span>{label}</span></a>:null})}</div>:<small>{ui.noContextFiles}</small>}</section>
          <section className="communications-context-section communications-context-summary" data-active-tab="SUMMARY"><header><div><b>{ui.contextSummary}</b><small>{active.label}</small></div></header>
            <div className="communications-summary-controls">
              <span className="communications-summary-date-picker"><button ref={summaryDateButtonRef} type="button" aria-haspopup="grid" aria-expanded={summaryCalendarOpen} onClick={()=>setSummaryCalendarOpen(value=>!value)}>{ui.summaryFromDate}: <b>{new Date(`${summaryDate||firstSummaryDate}T12:00:00`).toLocaleDateString("ru-RU")}</b> ▾</button>{summaryCalendarOpen&&<SummaryCalendar month={summaryMonth} onMonth={setSummaryMonth} selected={summaryDate||firstSummaryDate} minimum={firstSummaryDate} maximum={localDateKey(new Date())} generated={new Set(conversationSummaries.map(item=>item.fromDate))} onSelect={date=>{setSummaryDate(date);setSummaryCalendarOpen(false);queueMicrotask(()=>summaryDateButtonRef.current?.focus())}} onClose={()=>{setSummaryCalendarOpen(false);queueMicrotask(()=>summaryDateButtonRef.current?.focus())}}/>}</span>
              <button type="button" className="phase2-primary communications-summary-generate" disabled={summaryGenerating||summaryLoading||!summaryDate} onClick={()=>void generateConversationSummary()}>{summaryGenerating?ui.generatingSummary:summaryProgress?.fromDate===summaryDate?ui.continueSummary:activeSummary?ui.refreshSummary:ui.generateSummary}</button>
            </div>
            {summaryLoading?<State text={ui.loadingSummary}/>:summaryProgress?.fromDate===summaryDate?<div className="communications-summary-stale is-progress" role="status">{ui.summaryProgress} {summaryProgress.processedChunks||0}/{summaryProgress.totalChunks||0}. {ui.summaryContinueHint}</div>:activeSummary?.summary?<article className="communications-summary-result">{!activeSummary.isCurrent&&<div className="communications-summary-stale" role="status">{ui.summaryStale}</div>}<SummaryText text={activeSummary.summary}/><footer>{ui.summaryGenerated}: {new Date(activeSummary.generatedAt).toLocaleString("ru-RU",{dateStyle:"medium",timeStyle:"short"})}{activeSummary.messageCount?` · ${ui.summaryMessages}: ${activeSummary.messageCount}`:""}</footer></article>:<State text={ui.summaryEmpty}/>}</section>
          </div>
          </>}
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
      {noteOpen&&client&&<div className="phase2-overlay"><form className="phase2-modal communications-note-modal" role="dialog" aria-modal="true" aria-labelledby="communications-note-title" onSubmit={saveClientNote}><div><h2 id="communications-note-title">{ui.chatNote}</h2><button type="button" aria-label={ui.close} onClick={()=>setNoteOpen(false)}>×</button></div><label>{ui.note}<textarea autoFocus maxLength={2000} rows={6} value={noteText} onChange={event=>setNoteText(event.target.value)}/></label><footer><button type="button" onClick={()=>setNoteOpen(false)}>{ui.cancel}</button><button className="phase2-primary" disabled={busy}>{busy?ui.saving:ui.save}</button></footer></form></div>}
      <Modal opened={splitOpen&&Boolean(client)} onClose={()=>{if(!splitBusy){setSplitOpen(false);setSplitError("")}}} title={ui.splitAccounts} centered closeOnEscape={!splitBusy} closeOnClickOutside={!splitBusy} closeButtonProps={{"aria-label":ui.close,disabled:splitBusy}}><div className="communications-split-modal"><p>{ui.splitAccountsHint}</p><NativeSelect autoFocus size="md" label={ui.splitAccount} value={splitSourceId} onChange={event=>{setSplitError("");setSplitSourceId(event.target.value)}} data={client?.mergedClients?.map(item=>({value:item.sourceClientId,label:`${item.displayName}${item.channels.length?` — ${item.channels.map(value=>ui.sources[value as keyof typeof ui.sources]||value).join(", ")}`:""}`}))||[]}/>{client?.mergedClients?.find(item=>item.sourceClientId===splitSourceId)?.splitMode==="CHANNELS_ONLY"&&<Alert color="orange" className="communications-split-warning">{ui.splitLegacyWarning}</Alert>}{splitError&&<Alert color="red" role="alert">{splitError}</Alert>}<footer><Button type="button" size="md" variant="default" disabled={splitBusy} onClick={()=>{setSplitOpen(false);setSplitError("");requestAnimationFrame(()=>splitTriggerRef.current?.focus())}}>{ui.cancel}</Button><Button type="button" size="md" loading={splitBusy} disabled={!splitSourceId} onClick={()=>void splitClient()}>{ui.splitConfirm}</Button></footer></div></Modal>
      {deleteTarget&&<div className="phase2-overlay communications-delete-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)closeDeleteDialog()}}><section ref={deleteDialog} tabIndex={-1} className="phase2-modal communications-delete-modal" role="dialog" aria-modal="true" aria-labelledby="communications-delete-title"><div><h2 id="communications-delete-title">{deleteTarget.status==="DRAFT"||deleteTarget.status==="FAILED"?ui.clearLocalMessage:ui.deleteMessageTitle}</h2><button ref={deleteClose} type="button" aria-label={ui.close} disabled={deleteBusy} onClick={closeDeleteDialog}>×</button></div><p>{deleteTarget.status==="DRAFT"||deleteTarget.status==="FAILED"?ui.clearLocalMessageHint:ui.deleteMessageHint}</p><footer><button type="button" disabled={deleteBusy} onClick={closeDeleteDialog}>{ui.cancel}</button><button type="button" className="phase2-primary communications-delete-from-crm" disabled={deleteBusy} onClick={()=>void deleteMessage("CRM")}>{deleteBusy?ui.deleting:deleteTarget.status==="DRAFT"||deleteTarget.status==="FAILED"?ui.clearLocalMessage:ui.deleteMessageFromCrm}</button>{deleteTarget.channel==="CHATWOOT"&&deleteTarget.status==="SENT"&&Boolean(deleteTarget.externalId)&&<button type="button" className="phase2-primary communications-delete-for-client" disabled={deleteBusy} onClick={()=>void deleteMessage("CLIENT")}>{deleteBusy?ui.deleting:ui.deleteMessageForClient}</button>}</footer></section></div>}
      {ordering&&client&&clientDetail&&<OrderPanel client={clientDetail} request={api} initialAthleteId={selectedAthleteId} onClose={()=>{setOrdering(false);orderTriggerRef.current?.focus()}} onSaved={async()=>{setOrdering(false);await Promise.all([loadClientDetail(client.id),loadClients(client.id,currentClientCount.current,currentSearch.current,currentSocialFilters.current,currentOrderScope.current)])}}/>}
      {tasking&&client&&taskBoard&&<TaskDialog
        task={{columnId:taskBoard.columns[0]?.id,type:"CLIENT",markerColor:"#7047eb",labels:[],client:{id:client.id,displayName:client.displayName}}}
        columns={taskBoard.columns}
        users={taskBoard.users}
        saving={taskSaving}
        close={()=>!taskSaving&&setTasking(false)}
        save={async payload=>{
          setTaskSaving(true);setError("");
          try{
            await api("/tasks",{method:"POST",body:JSON.stringify(payload)});
            setTasking(false);
            await loadClients(client.id,currentClientCount.current,currentSearch.current,currentSocialFilters.current);
          }catch(e){setError((e as Error).message)}finally{setTaskSaving(false)}
        }}
      />}
      {addingAthlete&&client&&<AddAthlete clientId={client.id} request={api} returnFocusRef={addAthleteTriggerRef} close={()=>setAddingAthlete(false)} done={()=>{setAddingAthlete(false);void loadClientDetail(client.id).catch(e=>setError((e as Error).message))}}/>}
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
  return <div className="communications-state" role="status" aria-live="polite">{text}</div>;
}
function InboxSkeleton({kind,rows}:{kind:"conversations"|"messages";rows:number}){return <div className={`communications-skeleton is-${kind}`} aria-label={kind==="conversations"?ui.loading:ui.loadingMessages}>{Array.from({length:rows},(_,index)=><span key={index}/>)}</div>}
function ContextTabs({active,onChange}:{active:ContextTab;onChange:(tab:ContextTab)=>void}){
  const tabs:{key:ContextTab;label:string}[]=[{key:"CLIENT",label:ui.contextClient},{key:"ORDERS",label:ui.contextOrders},{key:"NOTES",label:ui.contextNotes},{key:"FILES",label:ui.contextFiles},{key:"SUMMARY",label:ui.contextSummary}];
  return <div className="communications-context-tabs" role="tablist" aria-label={ui.clientCard}>{tabs.map((tab,index)=><button id={`communications-context-tab-${tab.key.toLowerCase()}`} type="button" role="tab" key={tab.key} aria-controls="communications-context-tabpanel" aria-selected={active===tab.key} tabIndex={active===tab.key?0:-1} onClick={()=>onChange(tab.key)} onKeyDown={event=>{let next=index;if(event.key==="ArrowRight")next=(index+1)%tabs.length;else if(event.key==="ArrowLeft")next=(index-1+tabs.length)%tabs.length;else if(event.key==="Home")next=0;else if(event.key==="End")next=tabs.length-1;else return;event.preventDefault();onChange(tabs[next]!.key);const buttons=event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');queueMicrotask(()=>buttons?.[next]?.focus())}}>{tab.label}</button>)}</div>
}
function SummaryText({text}:{text:string}){return <div className="communications-summary-text">{text.split("\n").map((line,index)=>line.startsWith("### ")?<h4 key={index}>{line.slice(4)}</h4>:line.trim()?<p key={index}>{line}</p>:null)}</div>}
function SummaryCalendar({month,onMonth,selected,minimum,maximum,generated,onSelect,onClose}:{month:Date;onMonth:(value:Date)=>void;selected:string;minimum:string;maximum:string;generated:Set<string>;onSelect:(value:string)=>void;onClose:()=>void}){
  const year=month.getFullYear(),monthIndex=month.getMonth(),first=new Date(year,monthIndex,1),offset=(first.getDay()+6)%7,days=new Date(year,monthIndex+1,0).getDate(),cellCount=Math.ceil((offset+days)/7)*7,cells=Array.from({length:cellCount},(_,index)=>index<offset||index>=offset+days?null:index-offset+1),weeks=Array.from({length:cellCount/7},(_,index)=>cells.slice(index*7,index*7+7));
  const moveFocus=(event:KeyboardEvent<HTMLButtonElement>)=>{const grid=event.currentTarget.closest('[role="grid"]'),buttons=[...(grid?.querySelectorAll<HTMLButtonElement>('[role="gridcell"]:not(:disabled)')||[])],index=buttons.indexOf(event.currentTarget);let next=index;if(event.key==="ArrowRight")next=index+1;else if(event.key==="ArrowLeft")next=index-1;else if(event.key==="ArrowDown")next=index+7;else if(event.key==="ArrowUp")next=index-7;else if(event.key==="Home")next=0;else if(event.key==="End")next=buttons.length-1;else return;event.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,next))]?.focus()};
  return <div className="communications-summary-calendar" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();onClose()}}}><header><button type="button" aria-label={ui.previousMonth} onClick={()=>onMonth(new Date(year,monthIndex-1,1))}>‹</button><b>{month.toLocaleDateString("ru-RU",{month:"long",year:"numeric"})}</b><button type="button" aria-label={ui.nextMonth} onClick={()=>onMonth(new Date(year,monthIndex+1,1))}>›</button></header><div className="communications-summary-weekdays" aria-hidden="true">{["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(day=><span key={day}>{day}</span>)}</div><div className="communications-summary-days" role="grid" aria-label={ui.summaryCalendarLabel}>{weeks.map((week,weekIndex)=><div role="row" key={`week-${weekIndex}`}>{week.map((day,index)=>{if(day===null)return <span key={`blank-${weekIndex}-${index}`} role="gridcell"/>;const value=`${year}-${String(monthIndex+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,disabled=value<minimum||value>maximum;return <button type="button" role="gridcell" key={value} disabled={disabled} tabIndex={value===selected?0:-1} className={`communications-summary-day ${value===selected?"is-selected ":""}${generated.has(value)?"is-generated":""}`.trim()} aria-selected={value===selected} aria-label={new Date(`${value}T12:00:00`).toLocaleDateString("ru-RU",{dateStyle:"long"})} onKeyDown={moveFocus} onClick={()=>onSelect(value)}>{day}</button>})}</div>)}</div><small>{ui.summaryCalendarHint}</small></div>
}
function ReplyMedia({url,type,label,onOpen,onLoad}:{url:string;type?:"image"|"video";label:string;onOpen:(event:MouseEvent<HTMLButtonElement>,type:"image"|"video")=>void;onLoad:()=>void}){
  const[video,setVideo]=useState(type==="video");
  return <button type="button" className={video?"communications-video-preview":undefined} aria-label={ui.openAttachment+": "+label} onClick={event=>onOpen(event,video?"video":"image")}>{video?<video src={url} preload="metadata" muted playsInline aria-label={label} onLoadedMetadata={onLoad}/>:<img src={url} alt={label} onLoad={onLoad} onError={()=>setVideo(true)}/>}</button>
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

function InboxCountryFlag({country}:{country:string}){
  const aliases:Record<string,string>={netherlands:"nl",нидерланды:"nl",ukraine:"ua",украина:"ua",україна:"ua",france:"fr",франция:"fr",italy:"it",италия:"it",spain:"es",испания:"es",germany:"de",германия:"de",poland:"pl",польша:"pl","united kingdom":"gb","united states":"us",usa:"us"};
  const normalized=country.trim().toLowerCase(),code=aliases[normalized]||(/^[a-z]{2}(?:\s|$)/.test(normalized)?normalized.slice(0,2):"");
  return code?<span className={`fi fi-${code}`} aria-hidden="true"/>:null;
}
function clientLocalTime(timezone:string){try{return new Intl.DateTimeFormat("ru-RU",{timeZone:timezone,hour:"2-digit",minute:"2-digit",timeZoneName:"shortOffset"}).format(new Date())}catch{return timezone}}
function clearInboxContextAction(){const url=new URL(window.location.href);for(const key of["action","clientId","clientName","orderId"])url.searchParams.delete(key);window.history.replaceState(null,"",url)}
