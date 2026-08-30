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

## Authentication And Sessions

- Passwords use Argon2id.
- Unknown database-mode credentials still perform Argon2 verification against a fixed non-secret sentinel hash, reducing obvious account-enumeration timing differences.
- PostgreSQL mode issues 256-bit random opaque tokens and stores only SHA-256 token hashes.
- Sessions have an absolute seven-day expiry and periodically update last-seen time.
- Cookies are HttpOnly, SameSite=Lax, path-scoped to the application, high priority, and Secure in production.
- Session responses use Cache-Control: no-store.
- Login and registration are origin checked and rate limited.
- Demo mode uses a signed HMAC token for a public mock identity. Public demo credentials and data are not a confidentiality boundary.

proxy.ts only redirects requests with no cookie. Pages and APIs validate the session in the server-only DAL.

Remaining launch work: passkeys/MFA, email verification, secure recovery, session/device inventory, revoke-all, reauthentication for sensitive settings, credential-stuffing defense, and breached-password controls.

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

The current CSP permits inline framework scripts/styles. Replace it with deployment-specific nonces or hashes after validating Next.js streaming and third-party integrations. Process-local rate limiting must move to Redis or another shared atomic limiter before multi-instance production. Only trust forwarding headers from the configured edge proxy.

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
- ignored local environment files
- hashed passwords and session tokens
- safe audit metadata containing changed field names rather than balances/descriptions
- no intentional financial-payload logging

Infrastructure must provide TLS, encrypted disks/databases/backups, managed secrets, rotation, restore testing, retention, and access audit logs.

Future field/application encryption should cover provider access/refresh tokens, account/routing identifiers, tax/identity data, raw provider payloads retained for reconciliation, and other high-impact identifiers. Use envelope encryption with a managed KMS, per-purpose keys, versioned ciphertext, rotation, and tightly scoped decrypt permissions. Passwords remain one-way hashes, not encrypted values. Searchable financial fields need a deliberate tokenization/index strategy rather than ad hoc deterministic encryption.

Before connecting real data, implement privacy notices, consent records, data inventory, purpose/retention limits, user export/deletion, provider revocation, backup deletion policy, support access controls, and vendor data-processing terms.

## Auditability And Logging

Financial repository mutations write AuditEvent entries with actor, action, entity type/ID, changed field names where applicable, and time. Do not put balances, full histories, account numbers, raw descriptions, tokens, or model payloads into normal logs or audit metadata.

Before action execution, define an immutable event taxonomy, event integrity/retention, request/idempotency correlation, operator access logs, anomaly alerts, reconciliation evidence, and incident response.

## Verification

The automated suite covers passwords, token integrity/expiry, environment fail-closed behavior, canonical origin and JSON body controls, rate limits, route and repository IDOR boundaries, provider isolation, action fail-closed behavior, accounting rules, recurring intelligence, goals, investments, insights, and grounded AI tools. Playwright checks authenticated desktop routes, priority mobile layouts, horizontal overflow, charts, dark mode, primary mutations, AI provenance, and browser errors.

## Production Checklist

- Independent threat model, application security review, and penetration test
- MFA/passkeys, recovery, session management, and abuse controls
- Distributed limits, durable queues, monitoring, alerting, and on-call procedures
- Nonce/hash CSP, dependency/SAST/secret/container/IaC scanning in CI
- Database least privilege and validated row-level security
- Managed secrets, encryption/key rotation, encrypted backups, and restore exercises
- Data export/deletion, consent/retention controls, privacy/legal review
- Vendor due diligence and applicable regulatory/compliance/partner approval
- Action-specific threat model, policy, step-up, audit, reconciliation, and support before enabling any action

Do not enable regulated or money-moving capabilities based only on this foundation.
