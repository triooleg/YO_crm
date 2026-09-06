---
name: yoleotard-messaging
description: Work with the YO_crm unified inbox and Facebook, Instagram, WhatsApp, Chatwoot or email flows. Use for conversations, messages, replies, reactions, attachments, receipts, webhooks, provider IDs, polling or deduplication.
---

# Yoleotard messaging

Read the Communication section in `CONTEXT.md`,
`docs/META_BIDIRECTIONAL_MESSAGING.md`, the schema models from Conversation
through MessageDeliveryAttempt, and `apps/api/src/communications/`.

1. Trace both directions end to end: provider event/send → normalization →
   conversation mapping → message/delivery attempt → API response → Inbox UI.
2. Preserve channel/account/customer scope for external identities. A Meta PSID
   or Facebook SID is not an email address.
3. Keep provider message IDs scoped to their conversation and preserve
   `clientRequestId`, webhook payload hash and existing replay/idempotency rules.
4. Store reactions, replies, receipts and attachments on or with their target
   message according to the current provider contract; do not render control
   events as unrelated chat messages.
5. Preserve provider evidence and business history according to each current
   path. Ordinary inbound messages and Chatwoot/email synchronized outbound
   paths use envelopes; Meta `message_echo` currently persists the message
   without one, while control events may retain target metadata and limited
   audit evidence. Follow hide/delete and audit rules.
6. Keep secrets out of URLs, returned payloads, logs, docs and fixtures. Use
   signed synthetic webhook fixtures.
7. Validate normalization, duplicate delivery, reverse event ordering, account
   scope and UI polling. Local green tests do not replace a controlled real
   provider smoke when the acceptance criterion is provider delivery.
