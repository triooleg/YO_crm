# Девять вкладок развёрнутого заказа — локальный отчёт

Дата проверки: 2026-10-13. Область: только вкладки развёрнутого заказа на странице «Заказы» и необходимые серверные проекции/модели. Реализация выпущена в production как CRM 0.1.46, commit `f3ccc9ad426ffbbd384cd14d0db37e3e9ff80928`.

## Результат

- Реализованы вкладки «Детали», «Дизайны», «Измерения», «Клиент», «Финансы», «Производство», «Доставка», «Заметки» и «История» по утверждённому ТЗ и девяти PNG-эталонам.
- Сохранены legacy REST-проекции, KeyCRM, платежи, независимые sales/production/payment/shipping статусы и аудит.
- Добавлены стабильные физические экземпляры изделий, несколько посылок, структурированные заметки/теги/файлы и клиентские предпочтения/файлы.
- Производственные ограничения действуют как для общего заказа, так и для отдельного экземпляра: быстрые продажи не планируются, committed-статусы требуют предоплату, агрегаты остаются детерминированными.
- Финансовая категория доставки не создаётся и не активируется через менеджерский shipping endpoint.
- Уменьшение количества не архивирует экземпляр с производственной, доставочной, спортивной или измерительной историей.

## Проверки

- `pnpm quality:check`: PASS.
- API: 766/766; web: 428/428; database: 17/17.
- TypeScript typecheck: PASS для API, web и database.
- Production build: PASS для NestJS API и Next.js web.
- Targeted Playwright для девяти вкладок: 1/1 PASS.
- `git diff --check`: PASS; только ожидаемые предупреждения о CRLF.
- Девять скриншотов 1536×1024: `output/playwright/order-tabs-final/01-details.png` … `09-history.png`.

## Изменённые файлы

### API и доменная логика

- `apps/api/src/app.module.ts`
- `apps/api/src/keycrm/keycrm-shipment-policy.ts`
- `apps/api/src/keycrm/keycrm.service.ts`
- `apps/api/src/orders/order-currency.ts`
- `apps/api/src/orders/order-details.ts`
- `apps/api/src/orders/order-item-details.ts`
- `apps/api/src/orders/order-tabs.controller.ts`
- `apps/api/src/orders/order-tabs.dto.ts`
- `apps/api/src/orders/order-tabs.service.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/orders/production-context.ts`
- `apps/api/src/orders/production-status-graph.ts`
- `apps/api/src/shipping/shipping-finance.ts`
- `apps/api/src/shipping/shipping-status.ts`
- `apps/api/src/shipping/shipping.controller.ts`
- `apps/api/src/shipping/shipping.dto.ts`
- `apps/api/src/shipping/shipping.service.ts`

### Web

- `apps/web/app/orders-dashboard.css`
- `apps/web/components/orders-dashboard.tsx`
- `apps/web/components/orders/order-expanded-tabs.tsx`
- `apps/web/components/shipping-workspace.tsx`
- `apps/web/e2e/mantine-orders-controls.spec.ts`
- `apps/web/lib/i18n.ts`

### Database и решения

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261013120000_order_item_instances/migration.sql`
- `packages/database/prisma/migrations/20261013123000_order_tabs_notes_files/migration.sql`
- `packages/database/prisma/migrations/20261013130000_order_shipments_expand/migration.sql`
- `docs/decisions/0005-expand-orders-to-instances-and-multiple-shipments.md`
- `CONTEXT.md`
- `CHAT_HANDOFF.md`

### Тесты

- `apps/api/tests/keycrm-runtime.test.mjs`
- `apps/api/tests/keycrm-shipment-policy.test.mjs`
- `apps/api/tests/order-buyer-comment.test.mjs`
- `apps/api/tests/order-detail-read.test.mjs`
- `apps/api/tests/order-details-update.test.mjs`
- `apps/api/tests/order-file-policy.test.mjs`
- `apps/api/tests/order-item-details.test.mjs`
- `apps/api/tests/order-item-instance-write-paths.test.mjs`
- `apps/api/tests/order-item-instances.test.mjs`
- `apps/api/tests/order-item-measurement-write.test.mjs`
- `apps/api/tests/order-payment-transaction.test.mjs`
- `apps/api/tests/order-payments-contract.test.mjs`
- `apps/api/tests/order-shipments.test.mjs`
- `apps/api/tests/order-tabs-contract.test.mjs`
- `apps/api/tests/order-tabs-runtime.test.mjs`
- `apps/api/tests/orders-production-context.test.mjs`
- `apps/api/tests/orders-production-service.test.mjs`
- `apps/api/tests/production-slot-contract.test.mjs`
- `apps/api/tests/production-status-graph.test.mjs`
- `apps/api/tests/shipping-contract.test.mjs`
- `apps/api/tests/shipping-finance.test.mjs`
- `apps/api/tests/shipping-runtime.test.mjs`
- `apps/api/tests/website-sales-correction.test.mjs`
- `apps/web/tests/crm-status-badge.test.mjs`
- `apps/web/tests/order-currency-change.test.mjs`
- `apps/web/tests/order-image-edit.test.mjs`
- `apps/web/tests/order-type-edit.test.mjs`
- `apps/web/tests/orders-approved-redesign.test.mjs`
- `apps/web/tests/orders-client-tab-actions.test.mjs`
- `apps/web/tests/orders-expanded-complete.test.mjs`
- `apps/web/tests/orders-instance-assignment.test.mjs`
- `apps/web/tests/orders-multiple-shipments.test.mjs`
- `apps/web/tests/orders-nine-tabs-redesign.test.mjs`
- `apps/web/tests/orders-redesign.test.mjs`
- `apps/web/tests/orders-structured-notes.test.mjs`
- `apps/web/tests/orders-variant-a.test.mjs`
- `packages/database/tests/order-item-instances-schema.test.mjs`
- `packages/database/tests/order-shipments-expand.test.mjs`
- `packages/database/tests/order-tabs-notes-files-schema.test.mjs`

## Перед production

Нужны отдельное разрешение пользователя, FULL backup, dry-run трёх миграций на production-подобной PostgreSQL, проверка backfill/invariants и rollback rehearsal. Старые KeyCRM rollback-снимки версии v1 после появления экземпляров/нескольких посылок намеренно завершаются fail-closed; для production нужен явный сценарий rollback v2.
