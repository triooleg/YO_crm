# Инвойсы — развёртывание 26.10.2026

По отдельной команде владельца обновление установлено на
[crm.yoleotard.com](https://crm.yoleotard.com/).

Финальный release-gatekeeper: `DEPLOYMENT ACCEPTED WITH DOCUMENTED LIMITATIONS`.
Блокирующих замечаний нет; непроверенные production-пути перечислены ниже.

## Версия и область

- Snapshot: `8889237c9ecd0a3b14850e1e52854e5ed04d16e9d46cf295ad58488f8bf9a297`.
- API: `sha256:7b8e347deb22d39d8a82cfb5100b345274ceeffee066d7c0ffafb5639342c525`.
- Web: `sha256:a83f9ea6950d30a70b11b7ae841737ce78e1b8928cc198d9bb61d2d7fc7b6c25`.
- В Compose закреплены точные image IDs; API запускается без seed/migrate.
- PostgreSQL, Redis и существующий reverse proxy сохранены. Миграций по-прежнему 48.
- Commit/push и изменение бизнес-данных не выполнялись.

## Проверки

| Проверка | Результат |
| --- | --- |
| Повторный `pnpm quality:check` перед релизом | PASS: API 1744/7 skipped, web 642/8 skipped, database 28/0; typecheck/build PASS |
| Frozen manifest и состав релиза | PASS: 1192 файла, 29 целевых путей; несвязанные изменения не включены |
| FULL backup | `20261026T115549Z-pre-invoice-simplification-afcb1c9f`, контрольные суммы и каталог PASS |
| Реальное восстановление FULL в изолированной БД | PASS, контрольные суммы строк совпали |
| Switch gate | PASS после фиксации frozen snapshot и точных IDs образов |
| Публичные `/` и `/api/health` | HTTP 200 |
| API/web/PostgreSQL/Redis | healthy, 0 рестартов |
| Логи запуска | Блокирующих ошибок нет |
| Заказы/позиции/платежи/налоги | Полные row fingerprints совпали: 510/587/844/996, архивных заказов 9 |
| Прежние Invoice/OrderDocument | Полные row fingerprints совпали |
| Авторизованный browser smoke | Активные INVOICE-шаблоны → English SEPA → готовый предпросмотр YO-671 |
| Сумма документа | 800 EUR, две позиции по 400; согласованная цена не менялась |
| PDF предпросмотра | Скачан, валидный PDFKit PDF, одна A4 страница, 17 776 байт; номер заказа и итог проверены извлечением текста |
| Настройки шаблонов | Раздел доступен владельцу |
| Консоль браузера | 0 errors/warnings |
| Retention и финальная проверка | PASS: 5 rollback-source, 5 release, по 5 API/web образов; публичная доступность и данные повторно проверены |

Скачивание не создало Invoice; в проверенном заказе осталось ноль сохранённых
документов. Создан только истекающий приватный preview. Заказы, оплаты, налоги,
шаблоны и существующие документы при smoke не изменялись.

## Границы проверки

Сохранение нового Invoice, повторное скачивание сохранённого документа и печать
на production не выполнялись; эти пути покрыты локальными тестами и остаются
UNVERIFIED на рабочей базе. Единственный прежний Invoice относится к августу и
находится в архиве: UI/PDF smoke для активного legacy-документа недоступен, архив
сохранён без изменений. Конкурентное сохранение на живом PostgreSQL не проверялось.

Приватные receipts и исходные доказательства: `.local/invoice-release-20261026/`
(`plan.json`, `manifest.json`, `stage-receipt.json`, `preswitch.json`,
`deploy-receipt.json`, `postcheck.json`, `retention.json`, `post-retention.json`,
`legacy-inventory.json`, `live-preview.pdf`, `live-preview.png`, `live-settings.png`).
Исходный отчёт разработки: [invoice-simplification-2026-10-26.md](invoice-simplification-2026-10-26.md).
