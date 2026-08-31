---
status: resolved
trigger: "CRM показывает технический текст старого HTML-письма; кнопка ответа отображается на исходящих письмах"
created: 2026-08-31
updated: 2026-08-31
---

## Symptoms

- Историческое HTML-письмо Google отображалось через технический plain-text fallback.
- Кнопка «Ответить на это письмо» отображалась и на исходящих Gmail-сообщениях.
- RFC threading уже работал корректно и должен был сохраниться.

## Evidence

- Production Message `cmthcsc710087s15h2jay0ojr` не имел `metadata.emailHtml`, но указывал на сохранённый raw MIME.
- Raw MIME содержал `multipart/alternative` с `text/plain` и `text/html`.
- UI проверял только EMAIL + Message-ID, а API не ограничивал explicit reply направлением INBOUND.

## Resolution

- root_cause: письмо импортировано до сохранения очищенного HTML; UI и API принимали исходящий Message-ID как цель явного ответа.
- fix: добавлен идемпотентный audited backfill из сохранённого MIME с безопасной HTML-очисткой, постоянным retry-safe cursor и сохранением прежнего текста; UI и API допускают явный ответ только на INBOUND. Fallback threading напрямую ищет последнее входящее письмо без окна из 30 сообщений.
- verification: `pnpm quality:check` PASS (API 280/280, database 7/7, полный web suite, typechecks, builds); executable regressions покрывают MIME restore, cursor retry и 31 исходящее сообщение после входящего; четыре обязательных review PASS.
- files_changed: `apps/api/src/communications/email-html.ts`, `email-reply.ts`, `email-sync.service.ts`, `communications.service.ts`, API tests, `apps/web/components/communications-workspace.tsx`, web test.
