---
status: resolved
trigger: "Проверить почему не импортируются данные аватара у клиентов из facebook и исправить"
created: 2026-09-05
updated: 2026-09-05
---

# Symptoms

- expected: При входящем Facebook Messenger сообщении CRM получает доступный профильный аватар клиента, сохраняет безопасную ссылку или локальную копию по действующему контракту и отображает её во «Входящих» и карточке клиента.
- actual: Facebook-диалоги и имена импортируются, но у клиентов отображаются буквенные заглушки вместо аватаров.
- errors: Пользовательская ошибка не показана; требуется проверить диагностические события и ответы Graph API без раскрытия токенов или персональных данных.
- timeline: Ранее аватары Facebook-клиентов импортировались и отображались. После обновления версии CRM импорт/отображение аватаров пропало; позднее имена Facebook были исправлены через fallback Page Conversations API, но восстановление аватаров не было подтверждено.
- reproduction: Открыть существующий Facebook-диалог в production CRM и сравнить аватар с доступным профилем клиента в Meta Business Suite.

# Current Focus

- hypothesis: Fallback Page Conversations API возвращает участника и имя, но текущий код не запрашивает либо не переносит поле picture/avatar в Client.avatarUrl.
- test: Проследить Graph fields, нормализацию профиля и запись Client; добавить failing regression test для avatar в fallback-ответе.
- expecting: Найти точку, где доступный avatar URL теряется между Graph response и условным обновлением клиента.
- next_action: Выполнить production backfill и подтвердить число восстановленных аватаров.
- reasoning_checkpoint: Production aggregate показал 34 Facebook-клиента без avatarUrl; Graph fallback использовался, но ошибок lookup не было, поэтому потеря была внутри разрешённого fallback-контракта.
- tdd_checkpoint: Failing-first тест подтвердил, что participant.picture терялся; после исправления meta-webhook suite PASS 59/59.

# Evidence

- Production: 36 активных Facebook-клиентов, 34 без `avatarUrl`, 2 с Meta-managed URL.
- Logs: `META_PROFILE_CONVERSATIONS_FALLBACK=3`, `META_PROFILE_LOOKUP_FAILED=0`.
- Код запрашивал `fields="id,participants"`, поэтому fallback мог сохранить имя, но не аватар.
- После исправления запрашивается `participants{id,name,picture}`, точный PSID выбирается без подстановки Page participant.

# Eliminated

- UI не скрывает сохранённые аватары: два существующих Meta URL отображались и отвечали JPEG/HTTP 200.
- Массовый backfill не падал на Graph-ошибках; проблема не была общей недоступностью endpoint.

# Resolution

- root_cause: После обновления CRM резервный путь Page Conversations API сохранял только имя участника и не запрашивал/не переносил `picture.data.url`.
- fix: Расширен Graph fields и нормализатор fallback; backfill отдельно считает аватары User Profile и Conversations.
- verification: Failing-first regressions, API suite 59/59, полный `pnpm quality:check`, desktop/mobile browser review. Live provider verification выполняется после deployment.
- files_changed: `communications.service.ts`, `meta-webhook.ts`, `meta-webhook.test.mjs`, `settings-workspace.tsx`.
