---
status: resolved
trigger: "При удалении реакции Instagram возникает ошибка; нужен Instagram-style picker и toggle, WhatsApp reactions и проверка сквозных входящих."
created: 2026-09-04
updated: 2026-09-04
---

# Symptoms

- Expected: hover/focus action opens a compact provider-aware emoji picker; clicking the active reaction removes it; reactions stay attached to their target message.
- Actual: Instagram unreact returns `Instagram не снял реакцию`; CRM only offers a hard-coded heart toggle; WhatsApp has no outbound reaction control and a coexistence reaction appeared as a separate `[Сообщение]`.
- Reproduction: click the existing business reaction badge in an Instagram conversation; inspect a WhatsApp reaction received through `smb_message_echoes`.

# Current Focus

- hypothesis: Instagram unreact payload incorrectly includes `reaction: love`; outbound handler is Instagram-only; WhatsApp echo reaction normalization does not cover the coexistence payload shape.
- test: add failing provider-payload, UI picker, channel capability, and WhatsApp echo/inbound normalization contracts.
- expecting: unreact omits the reaction field; Instagram exposes its supported heart while WhatsApp exposes the standard six emoji; both providers merge add/remove events into message metadata.
- next_action: deploy the verified commit and run a fresh production webhook smoke.

# Evidence

- 2026-09-04: `reactToMessage` rejects every channel except Instagram and hard-codes `reaction: love` for both react and unreact.
- 2026-09-04: UI `toggleReaction` is Instagram-only and sends no selected emoji.
- 2026-09-04: official Meta WhatsApp collection requires a reaction message body and uses an empty emoji to remove it; Instagram webhook documents `love` as the supported API reaction.

# Eliminated

- The separate WhatsApp `[Сообщение]` was not an ordinary text event: it was a `message_echoes` item with `type: reaction` entering the generic echo normalizer.
- The Instagram removal failure was not caused by missing permissions: the unreact request incorrectly retained `reaction: love`.

# Resolution

- Instagram unreact now omits `reaction`; WhatsApp add/remove uses the Cloud API reaction payload and an empty emoji for removal.
- WhatsApp reaction echoes are excluded from message creation and normalized as BUSINESS control events; inbound reactions remain CUSTOMER control events.
- Both providers merge reactions into the target message metadata, and the CRM UI renders one attached badge with repeat-click removal.
- Instagram exposes its supported heart; WhatsApp exposes `❤️ 😂 😮 😢 😡 👍` in an accessible hover/focus/touch picker.
- Quoted replies are scoped to an inbound message in the exact conversation, sent with the provider message ID, and persisted as `replyToMessageId` for inbound and external-app echoes.
- Verification: targeted reaction/reply suites 169/169 PASS; API 314/314, database 7/7 and web suite PASS; typecheck/build and `pnpm quality:check` PASS. Local browser smoke verified all six WhatsApp choices, attached placement, repeat-click removal and zero chat horizontal overflow (`clientWidth=scrollWidth=522`).
- Production inspection after the first release showed one historical `[Сообщение]` record created by the pre-fix generic WhatsApp echo path at 17:42. It is not a new post-release reaction, but remained visible because list previews and conversation history returned stored control records.
- Legacy rows with `messageType="reaction"` are now excluded from the client-facing preview and history queries while remaining intact in PostgreSQL and audit history. The regression test failed before the query filter and passes after it; full `pnpm quality:check` and `git diff --check` pass.
