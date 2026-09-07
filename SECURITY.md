# MoneyOS Security

MoneyOS handles sensitive financial metadata. These are implemented controls and explicit pre-production gaps, not a claim of certification.

## Invariants

- Every financial or AI record belongs to one user.
- Routes derive identity only from the authenticated session.
- Foreign and missing records receive the same non-enumerating response.
- Deterministic services calculate financial facts.
- AI has allowlisted read tools only and no database, mutation, credential, or provider execution access.
- V1 cannot transfer money, trade, pay bills, change accounts, or cancel subscriptions externally.
- Secrets and raw financial payloads are excluded from routine logs and client bundles.
- Provider cursors, access tokens, and webhook bodies never cross the AI or browser trust boundaries.

## Authentication And Sessions

- Passwords use Argon2id.
- Unknown database-mode credentials still perform Argon2 verification against a fixed non-secret sentinel hash, reducing obvious account-enumeration timing differences.
- PostgreSQL mode issues 256-bit random opaque tokens and stores only SHA-256 token hashes.
- Sessions have an absolute seven-day expiry and periodically update last-seen time.
- Cookies are HttpOnly, SameSite=Lax, path-scoped to the application, high priority, and Secure in production.
- Session responses use Cache-Control: no-store.
- Login and registration are origin checked and use atomic PostgreSQL limits in connected mode.
- Users can revoke all server-side sessions; the initiating browser cookie is cleared immediately.
- Optional passkeys add WebAuthn user verification after Argon2 password verification. Exact origin/RP checks, five-minute one-use challenges, session/tenant binding for enrollment, and counter compare-and-swap defend against replay and cross-tenant use.
- Multiple credentials are supported. Sensitive deletion and passkey changes require password reauthentication and recent MFA when passkeys exist.
- Demo mode uses a signed HMAC token for a public mock identity. Public demo credentials and data are not a confidentiality boundary.

proxy.ts only redirects requests with no cookie. Pages and APIs validate the session in the server-only DAL.

Remaining launch work: email verification, a reviewed recovery path that does not bypass MFA, session/device inventory, security notifications, credential-stuffing defense, and breached-password controls. Users should enroll two passkeys; no password-only MFA bypass exists.

## Authorization And Tenant Isolation

Repository methods accept the authenticated user ID and constrain every read/write. Mutations use updateMany/findFirst with both entity ID and user ID. Related selections such as goal-linked accounts are ownership checked.

The database adds defense in depth:

- direct userId ownership on financial records, goal contributions, and AI messages
- composite parent keys using id plus userId
- composite foreign keys preventing a child from referencing another tenant's account, category, recurring item, investment account, goal, or AI conversation
- a migration that fails if existing cross-tenant rows are detected

Tests attempt foreign snapshot reads, transaction edits, recurring/income edits, goal links/contributions, provider sync, route IDs, and AI tools. Foreign IDs never reveal whether another record exists.

Before public production, use a least-privilege application role and evaluate PostgreSQL row-level security with background jobs, migrations, support tooling, and backup/restore procedures.

## Request And Browser Security

- State-changing and assistant routes require the canonical origin.
- Production origin trust uses APP_URL or the platform-provided VERCEL_URL, not request-controlled forwarded hosts.
- JSON routes require a JSON media type and bounded body size.
- Zod validates entity IDs and all exposed payloads server side.
- Auth, mutations, and assistant queries have fixed-window limits.
- Errors map to safe client messages without stack traces or provider details.
- Security headers disable framing, MIME sniffing, sensitive referrers/capabilities, and cross-origin embedding.
- Production adds HSTS and a compatible CSP baseline.

The current CSP permits inline framework scripts/styles. Replace it with deployment-specific nonces or hashes after validating Next.js streaming and third-party integrations. Connected mode stores hashed fixed-window counters in PostgreSQL so concurrent Vercel instances share limits without Redis; the scheduled drain removes expired counters. Demo mode intentionally retains local counters because it has no database or confidential tenant data. Only trust forwarding headers from the configured edge proxy.

## Connected-Data Security

- Plaid client credentials and access tokens are server-only. Link returns a short-lived Link token; the browser sends a public token to a same-origin authenticated exchange route and never receives the resulting access token.
- Stored provider tokens use versioned AES-256-GCM authenticated encryption with a random nonce and 32-byte keys. A retained key ring decrypts old versions; normal token use rotates old ciphertext to the configured current version with a tenant-scoped compare-and-swap.
- Connection, refresh, reconnect, and disconnect lookups use both session-derived userId and connection ID. Foreign IDs return the same not-found response as missing IDs.
- Provider accounts and transactions use same-tenant composite foreign keys. The database rejects cross-user connection/account relationships even if application validation fails.
- Plaid webhooks are bounded, validated, and verified using the provider JWT public key and exact body hash. Stale/future signatures and altered bodies fail closed.
- Webhook signature/key identifiers are bounded, public-key cache growth is capped, body hashes use constant-time comparison, and replayed disconnection events are idempotently acknowledged.
- A SHA-256 digest of the verified signed webhook envelope becomes the queue dedupe key. Exact delivery replay is suppressed, while a later independently signed notification with the same JSON body remains eligible to sync. Cursor commits, account changes, and transaction changes are atomic; failed runs retain the old cursor.
- Sync jobs use leases and bounded retry. Safe failure categories reach the UI, not provider responses or raw error bodies.
- Manual refresh has a shared PostgreSQL rate limit plus a durable per-connection time-window dedupe key.
- Disconnect calls provider revocation first. Credentials are cleared only after confirmation; history is preserved and marked stale/disconnected.

The webhook endpoint is intentionally exempt from browser CSRF checks because provider signatures authenticate it. All user-controlled connection mutations still require canonical same-origin validation.

Remaining provider launch work: managed KMS envelope key generation/decryption, webhook/revocation incident exercises, verified production domains, least-privilege database/provider roles, provider vendor review, and privacy/retention operations.

## AI Security

- FinancialToolContext receives session identity, not a user ID from the question/model.
- Every tool is registered as READ and validates bounded input.
- Unknown tools fail closed.
- Structured results are the sole source of financial numbers.
- One cached snapshot gives a multi-tool answer a consistent data view.
- The tool execution boundary removes internal user IDs and serializes dates before results can reach an external model adapter.
- Missing cost basis or data produces an unavailable answer.
- Merchant text, descriptions, notes, and provider metadata are untrusted data, not instructions.
- Answers render as escaped React text, never trusted HTML.

External model use requires minimized payloads, retention/training controls, vendor/subprocessor review, prompt-injection evaluation, budgets/timeouts, and revalidation of every planned call.

## Action Security

FinancialAction, ActionProposal, ActionPermission, ActionConfirmation, and ActionExecutionResult encode a future trusted flow. SubscriptionActionProvider has a separate cancellation capability/preparation/execution contract.

An AI proposal is untrusted. It cannot authorize policy, create confirmation credentials, or execute. Future actions require:

- immutable preview bound to authenticated user and exact action parameters
- server-side ownership, capability, policy, amount, and limit validation
- step-up authentication where required
- explicit confirmation bound to a short expiry/nonce
- idempotency and replay protection
- immutable audit state transitions
- trusted provider execution and reconciliation
- exception handling, support, and incident controls

V1ActionsUnavailable fails closed at capability/preparation/execution. No current route exposes an action provider.

## Data Protection And Privacy

Implemented:

- server-only secrets and providers
- AES-256-GCM application encryption for financial-provider access tokens
- ignored local environment files
- hashed passwords and session tokens
- safe audit metadata containing changed field names rather than balances/descriptions
- no intentional financial-payload logging
- an authenticated JSON data export with explicit field allowlists that exclude password hashes, sessions, tokens, cursors, provider Item IDs, and provider transaction IDs
- user-controlled revocation of all server-side sessions
- password/recent-MFA-gated financial-data and account deletion, with provider revocation required before local deletion
- transactional tenant cleanup, including connection tokens and queued work; account deletion cascades authentication state

Infrastructure must provide TLS, encrypted disks/databases/backups, managed secrets, rotation, restore testing, retention, and access audit logs.

The current application token-encryption key must move to managed KMS envelope encryption before material production use. Future field/application encryption should also cover account/routing identifiers, tax/identity data, any raw provider payloads deliberately retained for reconciliation, and other high-impact identifiers. Use per-purpose keys, versioned ciphertext, rotation, and tightly scoped decrypt permissions. Passwords remain one-way hashes, not encrypted values. Searchable financial fields need a deliberate tokenization/index strategy rather than ad hoc deterministic encryption.

Before connecting real data, complete privacy notices, consent records, the data inventory, legal purpose/retention limits, backup deletion policy, support access controls, and vendor data-processing terms. Immediate deletion/export is implemented for early histories; move export to paginated/asynchronous generation before histories can exceed serverless response limits. Application deletion cannot instantly erase provider backups, replicas, browser downloads, or vendor records; vendor retention schedules must cover those systems.

## Auditability And Logging

Financial repository mutations write AuditEvent entries with actor, action, entity type/ID, changed field names where applicable, and time. Do not put balances, full histories, account numbers, raw descriptions, tokens, or model payloads into normal logs or audit metadata.

Before action execution, define an immutable event taxonomy, event integrity/retention, request/idempotency correlation, operator access logs, anomaly alerts, reconciliation evidence, and incident response.

## Verification

The automated suite covers passwords, passkey session gating/challenge replay and tenant constraints, session/token integrity/revoke-all, provider-token encryption/tamper/scheme/rotation, privacy export/deletion isolation, signed webhook validation/replay, environment fail-closed behavior, canonical origin and JSON controls, distributed limits, route/repository/provider IDOR boundaries, database tenant constraints, sync races/idempotency/cursor rollback, queue telemetry, pending-posted/removal lifecycles, reconciliation, disconnect preservation, accounting rules, investments, insights, and grounded AI tools. CI applies migrations to real PostgreSQL from zero and from the prior migration state, then proves seeded logical backup restoration.

Prisma 7.10.0 pins mysql2 for its multi-database CLI even though MoneyOS uses only PostgreSQL. package.json overrides that unused adapter dependency to the patched 3.24.3 release; migration, generation, test, and build checks guard compatibility until Prisma updates its pin.

CI rejects known high-severity production dependency advisories. Dependabot checks npm and GitHub Actions weekly with grouped minor/patch updates to limit review noise; dependency updates still require the complete CI gate.

## Production Checklist

- Independent threat model, application security review, and penetration test
- Passkey recovery, email verification, session inventory, security notifications, and breached-password controls
- Queue alerting, on-call procedures, and periodic limiter-table capacity review
- Managed KMS envelope encryption, key rotation, and provider-token recovery tests
- Nonce/hash CSP, dependency/SAST/secret/container/IaC scanning in CI
- Database least privilege and validated row-level security
- Managed secrets, KMS envelope encryption/key rotation, encrypted backups, and recurring managed-backup restore exercises
- Consent/legal-retention controls, backup expiry, scalable export generation, and privacy/legal review
- Vendor due diligence and applicable regulatory/compliance/partner approval
- Action-specific threat model, policy, step-up, audit, reconciliation, and support before enabling any action

Do not enable regulated or money-moving capabilities based only on this foundation.
