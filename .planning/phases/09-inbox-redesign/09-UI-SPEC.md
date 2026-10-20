# UI-SPEC: Inbox workspace redesign

## 1. Intent and source of truth

Redesign the existing production Inbox into a compact daily communication workspace without replacing its data flows, provider integrations, permissions, or business actions.

Visual precedence:

1. User-provided reference `ChatGPT Image 4 сент. 2026 г., 23_23_15.png`.
2. Explicit requirements in the attached task text.
3. Existing selected sketches 010 (balanced inbox) and 013 (persistent context overview).
4. Existing CRM design tokens and reusable components.

The reference is directional, not sample data. Every production surface must render existing API data and preserve loading, empty, error, permission, and partial-data states.

## 2. Compatibility contract

- Preserve Facebook, Instagram, WhatsApp, Chatwoot, and Email conversations, replies, media, reactions, quoted replies, read state, external links, and polling semantics.
- Preserve existing client, order, athlete, task, note, AI draft, translation, template, attachment, and RBAC APIs unless an additive endpoint is needed for idempotent draft updates.
- Preserve existing Ctrl+Enter send, reaction toggling, short-video delivery, message lightbox, and client-list ordering/unread behavior.
- AI remains assistive: generated content is always an editable draft and requires a manager action to send.
- No Prisma migration is planned. If draft autosave cannot be made idempotent with the current message model, use an additive API operation over the existing draft record.
- Existing global navigation remains the application shell. This phase redesigns the Inbox workspace, not the whole CRM.

## 3. Desktop information architecture

The workspace fills the available viewport below the application shell and uses four functional columns:

1. Existing global navigation: unchanged.
2. Conversation rail: 320px preferred, resizable within 280–380px.
3. Conversation: `minmax(520px, 1fr)`.
4. Context panel: 324px preferred, resizable within 288–390px and collapsible.

There must be no page-level vertical scroll in normal desktop use. The conversation list, message viewport, and context panel scroll independently. The message composer stays pinned to the bottom of the conversation column. When a conversation has few messages, the message stack aligns naturally to the bottom instead of leaving a large blank region between messages and composer.

## 4. Visual tokens

Use existing Yoleotard purple branding and neutral surfaces.

- Font: existing application font stack; do not introduce a page-only font download.
- Page title: 26–28px, 700.
- Client/chat title: 16–18px, 700.
- Primary body and message text: 14px minimum, 1.4–1.5 line height.
- Secondary metadata: 11–12px; never below 10px.
- Control labels: 12–13px, 600.
- Grid spacing: 4, 8, 12, 16, 20, 24px.
- Small controls: 30–34px high; primary send control: 40–44px.
- Surface radius: 10–14px; message radius: 14–18px.
- Border: low-contrast cool neutral; active and focus state uses purple.
- Incoming bubble: neutral lavender/gray surface with dark text.
- Outgoing bubble: purple gradient/solid with white text.
- Success/read/client/order badges: green; warnings/next action: amber or red according to urgency.
- Shadows are shallow and reserved for popovers, sticky layers, and selected cards.

## 5. Conversation rail

### Header and search

- Compact title and subtitle with a single square action for adding/starting a client conversation.
- Search accepts name, phone, social handle, email, and order number using the existing search behavior.
- Primary channel filters are compact pills with real counts: All, Facebook, Instagram, WhatsApp, Chatwoot, Email.
- Secondary filters: All, Unread, Clients, Purchased, Active orders. Existing purchased/active-order semantics are retained.

### Conversation row

Each row contains:

- real avatar through `ClientAvatar`, initials fallback, and channel marker;
- client name and one-line latest-message preview;
- timestamp/date;
- unread count badge when non-zero;
- compact business tags derived from real state (client, order, payment/sport where available).

Rows remain sorted by latest activity; a new message for an existing client moves the row to the top. Selected, hover, keyboard-focus, unread, and loading states are visually distinct. Pagination/load-more remains available but visually secondary.

## 6. Conversation column

### Sticky header

Show avatar, client name, current channel, country (when present), client badge, and active-order badge. Keep external-provider navigation and compact utility actions. Missing optional data collapses without placeholder clutter.

### Message viewport

- Date separators divide days.
- Message groups render from oldest to newest and anchor at the bottom when content is shorter than the viewport.
- Incoming and outgoing messages retain their direction, provider status, translated content, quoted reply, reactions, attachments, timestamps, and external-send label.
- Hover/focus actions: Reply, Copy, Translate, React, More. Touch devices expose the same actions through a visible compact trigger.
- Reactions are attached to the source message, not rendered as standalone messages. Pressing the same reaction toggles it off according to provider support.
- Read/delivery state uses the existing compact green indicator convention.

### Media

- Multiple image/video attachments in one message form a compact gallery.
- Video shows a playable poster/control and duration when available.
- Files remain downloadable with human-readable filenames.
- Existing lightbox and safe attachment URLs are reused.

## 7. Composer and draft behavior

The composer is a compact sticky region with:

- contextual toolbar: AI reply, Translate, Templates, Request measurements, overflow;
- autosizing textarea;
- attachment and emoji controls;
- send button with current-channel behavior;
- contextual shortcuts for File, Photo/video, Invoice, Measurements table, Quick reply when supported by existing workflows.

Ctrl+Enter sends for every channel. Enter behavior remains compatible with the current editor.

The large `Save draft` button is removed. Drafts autosave after a short idle debounce only when content or draft-supported metadata changed. Autosave must:

- update one addressable draft rather than append duplicates;
- expose subtle states: `Сохранение…`, `Черновик сохранён`, and a recoverable error;
- never clear unsent text on a failed request;
- never race an in-flight send or overwrite a newer local edit;
- cancel or archive the saved draft after successful send using existing safe semantics.

## 8. Context panel

Tabs: Client, Orders, Notes, Files. Client is default. The panel can collapse on desktop and becomes a drawer on narrow screens.

### Client tab hierarchy

1. Identity card: avatar, name, provider/account identity, external link.
2. Available contact/profile data: country/flag, local time and timezone, email, phone, language, tags. Missing fields are omitted or shown as a quiet dash only where alignment requires it.
3. Next action card using existing Tasks data and actions. AI suggestions require explicit manager confirmation.
4. Active order card with number, model/design, stage, amount/deposit, readiness, and link.
5. Athlete/measurements card with sport and latest real snapshot.
6. Latest note with edit/create action.

### Other tabs

- Orders: active first, then recent, with empty state and create/open actions.
- Notes: existing notes, add/edit workflow, timestamps and authors when available.
- Files: attachments already present in loaded communication/order context; unsupported aggregation is represented by an honest empty state, not fabricated data.

## 9. Responsive behavior

Acceptance widths:

- 1920x1080 and 1680x1050: full conversation rail, chat, and context panel visible.
- 1440x900: compact rail/context widths; no horizontal page scroll; chat remains primary.
- 1366x768: context panel may collapse by default or overlay as a drawer; composer and chat header remain fully usable.
- 768–999px: conversation rail and chat use master/detail navigation; context is a drawer.
- <=480px: single-column flow, touch-safe controls >=40px, no hover-only essential action, attachment preview and send remain visible above the mobile viewport.

Resizers must preserve their current keyboard and pointer behavior and clamp widths to prevent unusable columns.

## 10. Accessibility and interaction states

- All icon-only controls have Russian accessible labels and tooltips where useful.
- Visible `:focus-visible` outline for controls, rows, tabs, message actions, and resizers.
- Tabs expose tab semantics; drawers/popovers maintain focus and close on Escape.
- Color is not the only carrier for unread, selected, error, or delivery state.
- Loading uses local skeleton/progress states without replacing the whole workspace.
- Errors remain actionable and do not destroy composer input.
- Empty list, no search results, no messages, no order, no task, no notes, and no files each have concise Russian empty states from `apps/web/lib/i18n.ts`.

## 11. Component topology

Progressively extract presentation and bounded interaction units from `communications-workspace.tsx` while leaving orchestration and API ownership stable:

- `CommunicationsSidebar`
- `ConversationFilters`
- `ConversationListItem`
- `ConversationHeader`
- `MessageTimeline`
- `MessageBubble`
- `MessageMediaGallery`
- `MessageActions`
- `MessageComposer`
- `InboxContextPanel`
- context tab cards for client/order/task/athlete/note/files

Extraction is incremental. Do not duplicate request state, polling timers, or provider dispatch logic across child components.

## 12. Implementation phases and quality gates

1. Contract tests and layout foundation: viewport grid, independent scrolling, bottom-anchored timeline, responsive rails.
2. Conversation rail: compact filters/counts, rows, tags, unread and ordering compatibility.
3. Conversation header and message presentation: grouping, gallery, actions, states.
4. Composer: compact controls, contextual shortcuts, idempotent autosave and status.
5. Context tabs and operational hierarchy using real existing data/actions.
6. Accessibility, responsive refinements, visual regression checks, and documentation handoff.

For functional changes, add a failing test before implementation. Before completion run affected tests, typecheck, build, `pnpm quality:check`, required review agents, and browser checks at all four desktop target sizes plus mobile. Deployment is a separate authorized step and cannot be inferred from implementation completion.

## 13. Definition of done

- Production Inbox matches the reference's density, hierarchy, and workflow while using real data.
- No large blank chat gap; latest messages and composer are immediately usable.
- Existing channel messages, media, replies, reactions, statuses, filters, ordering, and send flows do not regress.
- Draft autosave is idempotent and failure-safe.
- Context information and actions are accurate, permission-aware, and non-fabricated.
- Target desktop sizes and mobile are usable without clipped critical controls or page-level horizontal scroll.
- Automated quality gates and required reviews pass; live deployment, if requested separately, is verified end to end.
