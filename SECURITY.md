# MoneyOS Security

MoneyOS handles sensitive financial metadata. This document describes implemented controls and the work required before a public production launch.

## Security Invariants

- Every financial record belongs to one user.
- A route never trusts a `userId` supplied by the browser.
- A missing or foreign record returns a non-enumerating not-found response.
- The assistant has read-only allowlisted tools and no direct database or mutation access.
- No transfer, trade, payment, cancellation, or account action is available in V1.
- Secrets stay server-side and sensitive financial payloads are not intentionally logged.

## Authentication And Sessions

- Passwords are hashed with Argon2id.
- PostgreSQL mode issues cryptographically random opaque session tokens and stores only their SHA-256 hashes.
- Session cookies are `HttpOnly`, `SameSite=Lax`, path-scoped to `/`, and `Secure` in production.
- Session responses use `Cache-Control: no-store`.
- Demo mode uses a signed HMAC session without a database. That mechanism is for local demo use only.
- Production requires a `SESSION_SECRET` of at least 32 characters.

`proxy.ts` only redirects obviously unauthenticated navigation. Protected pages and APIs revalidate sessions in the server-only DAL.

## Authorization And Tenant Isolation

Prisma repository reads and writes include the authenticated `userId`. Transaction updates use an ownership-constrained lookup. Goal creation verifies that any linked account belongs to the same user. Tests explicitly attempt cross-user reads and mutations.

Database roles should receive only the privileges needed by the application. A production deployment should add defense in depth such as PostgreSQL row-level security after operational tooling and migration behavior have been validated against it.

## Request Security

- Zod validates all exposed mutation/query payloads.
- JSON bodies have a size limit.
- State-changing and AI-query routes enforce same-origin requests.
- Login, registration, and assistant queries have fixed-window rate limits.
- Errors are mapped to safe client messages; implementation details remain server-side.
- Next.js response headers disable MIME sniffing, framing, unnecessary referrers, and sensitive browser capabilities.

Current rate limits are in process memory. They are appropriate for local V1 development, not for horizontally scaled production. Replace them with Redis or an equivalent shared, atomic limiter before deployment.

## AI Security

- The tool registry separates reads from future action operations.
- Tool execution receives the authenticated user context, never a model-provided tenant identity.
- Structured tool output is the only source for numeric financial answers.
- Model output is treated as untrusted and rendered without HTML execution.
- The model cannot mutate records, call providers directly, or execute financial actions.
- Future action requests must use a separate trusted service with explicit confirmation, policy enforcement, idempotency keys, limits, audit events, and provider reconciliation.

Prompt-injection defenses must also be applied to future imported merchant text and provider metadata. External-model integrations should minimize payloads, document retention settings, and avoid training use contractually where required.

## Data And Secrets

- Monetary values are stored as integer cents to avoid floating-point ambiguity.
- `.env*` files are ignored except `.env.example`.
- Database, provider, session, email, and model credentials must use a managed secret store in production.
- PostgreSQL connections must use TLS outside a trusted local network.
- Encryption at rest, encrypted backups, key rotation, restore testing, and retention policies are infrastructure responsibilities and are not claimed by this repository.
- Avoid attaching raw transaction payloads to logs, traces, error reporting, or analytics.

## Auditability

The schema includes `AuditEvent` for security-relevant and future action events. Before production, define an immutable event taxonomy, integrity/retention controls, operator-access logs, alerts, and incident-response procedures. Do not put raw balances or full transaction descriptions in routine audit messages.

## Verification

The test suite covers password and session behavior, same-origin controls, rate limiting, repository authorization boundaries, finance calculations, recurring changes, goal ownership, and AI tool scoping. The visual smoke suite checks authenticated routes and primary mutations without browser console errors.

## Production Launch Checklist

- Complete an independent application security review and penetration test.
- Add MFA/passkeys, email verification, account recovery, session/device management, and breach-response flows.
- Deploy distributed rate limiting, abuse monitoring, bot controls, and alerting.
- Add a strict production Content Security Policy with deployment-specific nonces/hashes.
- Configure TLS, database least privilege, encrypted backups, secret rotation, and restore exercises.
- Add dependency, container, SAST, secret, and infrastructure scanning in CI.
- Establish privacy notices, consent, deletion/export, data retention, and support processes.
- Complete vendor reviews and applicable legal, regulatory, compliance, and partner approvals.

Do not enable financial actions until their separate threat model, confirmation flow, compliance controls, and regulated provider integration are complete.
