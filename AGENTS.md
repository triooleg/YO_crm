# Yoleotard CRM agent guide

## Mission

Build the internal production CRM/ERP used by Yoleotard for the complete
client-to-delivery lifecycle. This is Yoleotard-specific, not generic SaaS.

## Continuity

Read `CHAT_HANDOFF.md`, `PROJECT_BLUEPRINT.md`, and `ROADMAP.md` before
changes. Update the handoff after meaningful implementation or deployment.

## Business rules

- Client and athlete are separate; one client may manage several athletes.
- Measurements are immutable dated snapshots; orders reference snapshots.
- Normal custom-order deposit is 50 percent.
- Production slots remain tentative until the required deposit is received.
- Money is integer minor units plus ISO currency; never floating point.
- Business history, payments, messages, files and audit events do not disappear.
- Sales, production, payment and shipping statuses are separate dimensions.
- UI and stored text are Unicode-safe and mobile-friendly.

## Architecture and quality

- pnpm TypeScript monorepo; Next.js web, NestJS REST API, Prisma/PostgreSQL, Redis.
- Modular monolith only; no microservices or Kubernetes.
- Enforce permissions in API guards/services, not only UI.
- Use Argon2id and secure HttpOnly cookies.
- Prefer archive/soft delete and audit important mutations.
- For fixes and risky rules: failing test first, then implementation.
- Before completion run typecheck, tests, build and affected live smoke paths.

## Deployment

Target `trio@192.168.31.219`, directory `/home/trio/yoleotard-crm`, compose
project `yoleotard-crm`. Reuse saved credentials from
`D:\Projects\Yo_ai_manager\.local\server.ssh.json` without displaying them.
The existing Nginx Proxy Manager owns 80/443; never add another proxy.

# Р”РѕРїРѕР»РЅРµРЅРёРµ Рє РїСЂР°РІРёР»Р°Рј: СЂСѓСЃСЃРєРёР№ РёРЅС‚РµСЂС„РµР№СЃ

- РћСЃРЅРѕРІРЅРѕР№ СЏР·С‹Рє РїРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРѕРіРѕ РёРЅС‚РµСЂС„РµР№СЃР° вЂ” СЂСѓСЃСЃРєРёР№.
- Р’СЃРµ РЅРѕРІС‹Рµ РєРЅРѕРїРєРё, Р·Р°РіРѕР»РѕРІРєРё, СЃС‚Р°С‚СѓСЃС‹, РѕС€РёР±РєРё Рё РїСѓСЃС‚С‹Рµ СЃРѕСЃС‚РѕСЏРЅРёСЏ РґРѕР±Р°РІР»СЏСЋС‚СЃСЏ
  С‡РµСЂРµР· С†РµРЅС‚СЂР°Р»РёР·РѕРІР°РЅРЅС‹Р№ СЃР»РѕРІР°СЂСЊ `apps/web/lib/i18n.ts`.
- РђРЅРіР»РёР№СЃРєРёРµ enum-РєРѕРґС‹ СЂР°Р·СЂРµС€РµРЅС‹ С‚РѕР»СЊРєРѕ РєР°Рє РІРЅСѓС‚СЂРµРЅРЅРёРµ СЃС‚Р°Р±РёР»СЊРЅС‹Рµ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂС‹.
- Р”Р»СЏ РєР°Р¶РґРѕРіРѕ РЅРѕРІРѕРіРѕ enum-РєРѕРґР° РѕР±СЏР·Р°С‚РµР»СЊРЅР° СЂСѓСЃСЃРєР°СЏ РѕС‚РѕР±СЂР°Р¶Р°РµРјР°СЏ РїРѕРґРїРёСЃСЊ.
- РџРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёРµ РёРјРµРЅР°, Р°РґСЂРµСЃР° Рё СЃРѕРѕР±С‰РµРЅРёСЏ РЅРµ РїРµСЂРµРІРѕРґСЏС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.
- Production web URL: `https://crm.yoleotard.com/`.

## Mandatory review agents

Before a meaningful change is called complete, follow `.agents/README.md`.
Regression, business-rule, visual, and release reviews are mandatory. A release
must not be deployed while any reviewer reports a blocking finding or while
`pnpm quality:check` fails. Existing working behavior is a compatibility
contract unless the user explicitly approves its replacement.
