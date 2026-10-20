---
status: resolved
trigger: "Сообщения Meta Facebook не всегда доходят во Входящие, а ответы из CRM не доставляются обратно; требуется исправить код, покрыть тестами и добиться рабочего двустороннего канала."
created: 2026-08-24
updated: 2026-08-24
---

# Symptoms

- expected: Входящие Facebook сообщения появляются в CRM с именем, каналом, текстом и вложениями; ответ из CRM доставляется в тот же Messenger-диалог один раз.
- actual: Некоторые входящие сообщения отсутствуют; исходящие ответы сохраняются как FAILED и Facebook отклоняет отправку.
- errors: Интерфейс показывает безопасную ошибку разрешения отправки; предыдущая диагностика обнаружила неполный набор разрешений Page token.
- timeline: Реальный inbound частично работал 22 августа 2026; реальная отправка из CRM добавлена 23 августа 2026, но live-send остаётся неуспешным.
- reproduction: Отправить сообщение Facebook Page, проверить Входящие; выбрать этот диалог в CRM и отправить ответ.

# Current Focus

- hypothesis: Handover Protocol отдаёт диалог другому приложению; CRM не подписана на standby и не перехватывает thread control перед отправкой.
- test: RED/GRЕЕN тесты standby webhook, обязательной standby-подписки и однократного take_thread_control + retry.
- expecting: Standby-сообщение сохраняется как обычное входящее, а code 10/subcode 2018300 приводит к take_thread_control и ровно одному повтору.
- next_action: deploy, нажать «Проверить и включить доставку сообщений», затем выполнить ручной inbound/outbound live smoke.
- reasoning_checkpoint: Production code 10/subcode 2018300 однозначно связывает обе жалобы с Handover Protocol; отсутствие webhook POST за 48 часов при активной messages-подписке подтверждает потерю standby-событий.
- tdd_checkpoint: RED — 5 targeted failures, затем GREEN — 21/21 Meta tests; дополнительный RED/GREEN для обязательного standby subscription.

# Evidence

- timestamp: 2026-08-24T00:00:00+03:00
  observation: Production Page token действителен, содержит pages_show_list, pages_messaging, pages_read_engagement и pages_manage_metadata; Page ID совпадает.
- timestamp: 2026-08-24T00:01:00+03:00
  observation: Production subscription содержит messages, messaging_postbacks, message_reads, messaging_optins, но не standby; Nginx не зафиксировал webhook POST за последние 48 часов.
- timestamp: 2026-08-24T00:02:00+03:00
  observation: Последние реальные отправки FAILED с Meta code 10 и subcode 2018300; токен не истёк.
- timestamp: 2026-08-24T00:03:00+03:00
  observation: Targeted RED воспроизвёл отсутствие entry.standby, классификации 2018300 и thread-control retry (5 failures).
- timestamp: 2026-08-24T00:04:00+03:00
  observation: После исправления targeted Meta tests 21/21, API suite 136/136, API и web typecheck PASS.
- timestamp: 2026-08-24T00:05:00+03:00
  observation: Business review потребовал отдельную историю внешней мутации thread control; RED подтвердил отсутствие callbacks и записей (4 failures), GREEN targeted 48/48.
- timestamp: 2026-08-24T00:06:00+03:00
  observation: Аудит thread control привязан к conversationId и содержит только безопасные clientId/pageId/outcome; targeted contracts 29/29 и API typecheck PASS.


# Eliminated

- Истёкший токен: debug token valid, expiresAt=0.
- Неверный Page ID: Graph identity совпадает с настроенным Page ID.
- Отсутствие pages_messaging: разрешение присутствует.
- Потеря из-за парсинга обычного entry.messaging: реальные фото ранее успешно сохранялись; провал зависит от владельца thread control.


# Resolution

- root_cause: Messenger Handover Protocol передал диалог другому приложению. CRM была подписана только на messages, поэтому не видела entry.standby, а Send API отклонял ответ code 10/subcode 2018300.
- fix: Добавлена standby-подписка и нормализация standby-входящих; перед ответом на 2018300 CRM один раз вызывает /me/take_thread_control и повторяет отправку ровно один раз. Успех и отказ thread control отдельно и атомарно записываются в Activity и AuditLog без токена, PSID и текста. Ошибки 2018300/2018171 получили отдельную безопасную причину.
- verification: Targeted Meta/communications 48/48; полный API 136/136; API/web typecheck PASS; API/web build PASS. Реальный live smoke требует deployment и повторной проверки подписки пользователем.
- files_changed: apps/api/src/communications/meta-webhook.ts, meta-send.ts, meta-delivery.ts, communications.service.ts; apps/api/tests/communications-contract.test.mjs, meta-webhook.test.mjs, meta-send.test.mjs, meta-delivery.test.mjs; apps/web/lib/i18n.ts.
