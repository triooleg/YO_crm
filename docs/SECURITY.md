# Security baseline

- Argon2id password hashing and generic login failure responses.
- HttpOnly, Secure, SameSite=Lax session cookies in production.
- Server-side RBAC and ownership checks for protected endpoints.
- Global DTO validation, request limits, security headers and rate limiting.
- CSRF defense for cookie-authenticated unsafe methods before internet launch.
- No public PostgreSQL/Redis ports, default passwords or committed secrets.
- Audit authentication, permission, financial and status mutations.
- Validate uploaded file types/sizes and use non-executable storage.
