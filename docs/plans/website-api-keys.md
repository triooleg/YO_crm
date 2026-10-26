# CheckoutV2 API keys — local implementation contract

Human approval: local auth and additive Prisma implementation confirmed on 2026-10-21. Base: cff6bd91a4033cd36524854068fdc93196c5295e. No production access, deployment, credentials, real traffic, Git commits/push or issues are authorized.

## Problem and solution

OWNER needs to manage website credentials without editing server configuration or revealing existing secrets. Add named, revocable, source-bound keys to Settings → Account. Preserve the existing environment token and its allowlist as a legacy fallback. Rotation creates a parallel key and never revokes another key automatically.

## User stories

1. As OWNER, I create a named website credential after confirming my current password so access is deliberate and attributable.
2. As OWNER, I copy the secret once and see a clear permanent-hide warning so I can install it safely in WordPress.
3. As OWNER, I inspect status, source, authors and dates without retrieving secrets so operational review does not expose credentials.
4. As OWNER, I rotate to a parallel key so WordPress can switch without interrupting the old connection.
5. As OWNER, I explicitly revoke the old key after acceptance so rotation never causes an automatic outage.
6. As a staff member without OWNER rights, I cannot manage keys through either the UI or HTTP requests.
7. As the website integration, I can submit orders only for my bound account and cannot use that key as a staff session.
8. As the operator, I retain the legacy env-token path during database or Redis outages so the existing installation stays compatible.
9. As OWNER, I can recover from a failed password or lost response without an automatic duplicate create or a second secret reveal.
10. As the maintainer, I retain immutable key/audit history and reject unauthenticated traffic before costly body parsing or database lookup.

## Public interfaces and decisions

- OWNER-only GET `/auth/website-api-keys` returns `{ keys, csrfToken, legacyConfigured }`. Each key has id, name, selector, sourceAccount, createdAt, lastUsedAt, revokedAt, createdById, revokedById, rotatedFromId. No digest, password or full token.
- OWNER-only POST `/auth/website-api-keys` accepts name, sourceAccount, currentPassword, confirmed:true.
- OWNER-only POST `/auth/website-api-keys/:id/rotate` accepts name, sourceAccount, currentPassword, confirmed:true. The replacement may use another canonical hostname; the original key remains unchanged.
- OWNER-only POST `/auth/website-api-keys/:id/revoke` accepts currentPassword, confirmed:true. Revoke is idempotent after reauthentication.
- Create/rotate return `{ key, secret }` once after commit. Revoke returns `{ key }`. No reveal endpoint. All management responses are no-store.
- Tokens: `yo_crm_v1_<16 hex selector>_<43 base64url secret>`, 32 cryptographically random secret bytes; selector is independent random 8 bytes. Store only purpose-separated SHA256 of the complete token with digestVersion `sha256-v1`. High-entropy random credentials do not require password hashing or a new production pepper.
- Initial create sourceAccount: `calendar.yoleotard.com`. During rotation OWNER may choose another canonical hostname. Common canonical account normalization is shared with website order validation. Each DB key authorizes only its stored account, regardless of legacy allowlist; legacy behavior remains unchanged.
- Current password rechecked against a fresh active OWNER under the existing per-user advisory lock. Redis limits fail closed; use separate key-management actor/IP scopes. Require explicit confirmation, configured exact Origin, JSON and session-bound CSRF proof (`x-website-key-csrf`). Never trust request Host for origin.
- Authenticate website ingress before its existing bounded JSON parser; retain guard enforcement. Trusted in-process auth context alone permits scoped ingestion; untrusted JSON cannot grant scope. Throttle successful lastUsedAt writes to at most once per five minutes. No secret or digest in audit/errors/logs.
- Security review closure: DB-key authentication is limited to 120 attempts per source IP per 60 seconds, fail closed before selector lookup. Both middleware and guard fallback use the trusted Express IP (existing proxy configuration); missing IP shares an `unknown` bucket. Valid legacy credentials return before Redis or DB. Recognized malformed key namespaces return 401 even without a legacy token; unrelated disabled-legacy requests preserve 503. Middleware-established principals avoid a second rate debit in the guard.
- Add one additive WebsiteApiKey table with creator/revoker and rotation ancestry; no deletion, no modification of existing business data. Create/revoke audit is atomic with mutation.
- UI reuses Mantine and current CRM wrappers, Russian centralized i18n, responsive metadata list, password/confirmation dialogs and one-time secret panel. Clear secret on close/unmount; never local/session storage or query parameters. Old key remains active until explicit owner revoke after WordPress acceptance.

## Test seams

Management HTTP/service boundary: OWNER enforcement, password, CSRF/origin/confirmation, metadata secrecy, atomic audit, concurrent parallel rotation, no second reveal. Website ingress: malformed/valid/revoked/wrong-account keys, unchanged env fallback, early parser rejection, throttled lastUsedAt and no business mutation on rejection. Prisma migration on synthetic PostgreSQL only. Browser: one-time reveal/close/copy, mobile fit, accessibility and absence of persisted secrets. Existing website ingestion, orders, payments and tax tests are compatibility contracts. Full quality gate and independent compatibility/regression/security/visual/release reviews required.

## Out of scope

No production actions, WordPress installation, real keys, order/payment/tax/KeyCRM economic or correlation changes, legacy token replacement, automatic key expiry or revocation, public API expansion beyond website authentication.

## Future deployment and rollback plan (not executed)

After separate human approval: inventory installed source/schema; FULL backup plus isolated restore proof; apply additive migration with bounded locks; deploy paired API/web images; OWNER read/negative smoke first. Keep env fallback and existing keys. Generate a real key only through owner UI, install in WordPress separately and verify agreed non-duplicating flow before explicitly revoking old key. Roll back UI/API while preserving table, key records and audit; env fallback remains usable. Do not drop table, rewrite migration history, restore an old live database or silently invalidate WordPress credentials. If DB keys have become the sole active website credentials, retain a compatible auth reader or roll forward instead of reverting to env-only code.
