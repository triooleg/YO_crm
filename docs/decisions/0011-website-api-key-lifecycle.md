# ADR0011 — Scoped website API key lifecycle

Date: 2026-10-21. Status: accepted for local implementation by the owner; production rollout requires separate authorization.

## Context

CheckoutV2 currently authenticates with a server environment token. OWNER needs named credentials, independent revocation and rotation without downtime. The integration already has a canonical source account and strictly bounded ingress; staff sessions and business transactions must retain their behavior.

## Decision

Add persisted website keys bound to the canonical website source. Keys use a recognizable versioned prefix, independent random public selector and 32 random secret bytes. Store a domain-separated SHA256 digest of the complete token and its algorithm version, never plaintext. A cryptographically random 256-bit secret does not have the low-entropy properties of a human password; a password KDF or a new production HMAC pepper is unnecessary here. Verification compares fixed-size digests in constant time after selector lookup.

OWNER management uses an actual active staff session, exact configured browser origin, JSON, session-bound CSRF, explicit confirmation and fresh password reauthentication. Mutations and safe metadata audit share one transaction. Revocation preserves history. Creation and rotation return the secret exactly once after commit; a lost response requires revocation and a new credential, not recovery.

Rotation is parallel creation. The owner may bind the replacement to another canonical website hostname; the original key and its account remain unchanged. No automatic revoke, global token replacement or mutation of another credential occurs. Authenticated requests receive a server-only principal; source validation precedes the existing order transaction. Last-used metadata is conditionally updated at a five-minute interval and is not a per-order delivery receipt.

The existing environment token is checked independently before database access and retains its existing source allowlist and error contracts. A database outage cannot disable a valid legacy token. Database keys need not be added to the legacy allowlist, but authorize only their own permitted source. No API key grants staff or general CRM access.

## Consequences

One additive table and API/web rollout are required. No business data is rewritten. Keep the key table and audit on rollback; once callers rely solely on database keys, an env-only binary is no longer a compatible rollback target. Successful authentication before revocation may finish in flight; subsequent requests must be rejected. Production credential creation and WordPress acceptance remain separate operator actions.
