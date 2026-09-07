# MoneyOS Operations

This runbook covers the inexpensive single-application, single-PostgreSQL deployment. It contains no claim that MoneyOS is ready for real financial data without vendor approval, legal/privacy review, managed secrets, tested backups, and an incident owner.

## Production Gate

Set NODE_ENV=production and DEMO_MODE=false, then run:

~~~bash
npm run verify:production-env
~~~

The command validates the PostgreSQL scheme, strong session secret, canonical HTTPS origin, provider configuration, token key ring, production Plaid HTTPS endpoints, and queue secret. It reports only enabled/disabled state and key version, never values. Apply migrations with prisma migrate deploy before switching traffic. CI proves both zero-state and previous-state migration paths against PostgreSQL.

CI also audits the production dependency tree at high severity. Weekly grouped Dependabot PRs cover npm and GitHub Actions; never merge an automated update without migration, PostgreSQL integration, static, unit, and build checks.

## Minimal Topology

- One canonical Vercel project runs pages, APIs, verified webhooks, and the protected queue drain.
- One managed PostgreSQL database stores application records, sync work, aggregate usage, and hashed rate buckets.
- Plaid is optional until real connections are enabled. Dashboard renders never call it.
- No Redis, Kafka, Elasticsearch, always-running worker, external LLM, or market feed is currently required.

The repository cannot identify or disconnect dashboard-side Vercel Git integrations. Verify domains, environment variables, traffic, and deployment history; retain money as canonical only after that review, then pause/disconnect money-o9u5. Configure a queue schedule on exactly one project.

## Queue Operations

Send Authorization: Bearer CRON_SECRET to POST /api/internal/sync/drain. One request starts no more than five jobs and stops starting jobs after 20 seconds. Individual claimed jobs retain two-minute leases and retry at most three times.

Use authenticated GET on the same route for payload-free counts:

- queued, processing, failed, retrying, and stale-lease jobs
- oldest queued, processing, failed, and overall pending times
- oldest pending age, maximum retry count, and next eligible job time
- 24-hour run count plus average/maximum processing duration
- seven-day failures grouped by safe category
- active provider-token counts by encryption scheme and key version
- count still using older key versions

Alert on sustained queued work, any stale lease, repeated failures, old successful-sync timestamps, and provider Items that remain active after users disconnect. Do not log response bodies from financial APIs or raise high-cardinality labels from user/connection IDs.

The drain deletes successful jobs after 30 days, terminal failed jobs after 90 days, expired authentication challenges/sessions, and rate-limit buckets after their safety window. These operational defaults are not a legal-retention policy.

## Passkey Operations

Passkeys are an optional second factor in PostgreSQL mode. Enrollment requires the current password. Once enrolled, login requires Argon2 password verification followed by WebAuthn user verification; no session is issued between those steps. The relying-party ID and expected origin derive from APP_URL, so keep APP_URL stable and use HTTPS outside localhost.

- Challenges expire after five minutes, are referenced by a random opaque token stored only as a hash, and are consumed before signature verification.
- Registration challenges are also bound to the authenticated session and tenant by a composite foreign key.
- Multiple credentials are supported. Enroll at least two devices for recovery; there is no password-only MFA bypass.
- First enrollment marks the current session MFA-verified and revokes other sessions. Global session revocation still removes every stored session.
- Removing a passkey requires the password, MFA within 15 minutes, and another enrolled passkey.

Losing every authenticator currently requires a separately reviewed recovery process that is not implemented. Before broad launch, add verified contact channels, session/device inventory, identity-proofing recovery, and security-event notifications. Recovery must never silently downgrade an MFA account.

## Provider-Token Rotation

1. Convert a legacy key to PROVIDER_TOKEN_ENCRYPTION_KEYS with that same value at version 1; set PROVIDER_TOKEN_ENCRYPTION_KEY_VERSION=1.
2. Deploy and verify connection sync/reconnect/disconnect.
3. Add a new random version while retaining version 1, then change the current version.
4. Normal provider-token use decrypts the stored version and compare-and-swap re-encrypts it with the current version.
5. Monitor the protected health endpoint until no live connection uses the old version.
6. Retain old keys until every database backup containing old ciphertext has expired or been safely re-encrypted and restore-tested.

Do not place keys in repository files. The environment key ring is a transition control, not a replacement for KMS envelope encryption. Before material production, use managed KMS, least-privilege decrypt rights, rotation audit trails, and tested recovery.

FinancialConnection stores encryption scheme separately from numeric key version. The protected health endpoint aggregates both, allowing local and future KMS ciphertext to coexist. A future implementation should implement ProviderTokenCipher, write a new scheme, create a unique data-encryption key per token, store only KMS-wrapped key material with the envelope, and lazily compare-and-swap old ciphertext. Retain the local decryptor and old keys until live rows and all retained backups migrate.

## Privacy Operations

Settings lets an authenticated user download an immediate JSON archive, revoke all server-side sessions, delete financial data, or delete the account. The export uses explicit selections and omits passwords, session hashes, credential IDs/public keys, access tokens, cursors, provider Item IDs, and provider transaction IDs. It includes non-secret passkey device metadata. The routes are canonical-origin checked, shared-rate-limited, non-cacheable, and audited where a user record remains.

Destructive operations require the current password; passkey-enabled accounts also require MFA within 15 minutes. Deletion first marks the user unavailable, cancels queued/leased sync jobs, and requests provider revocation. Local deletion stops if revocation cannot be confirmed. A Plaid `INVALID_ACCESS_TOKEN` response is treated as an idempotent revocation success because the token no longer grants provider access; other provider failures remain blocking. Full deletion cascades authentication records and sessions. Financial-only deletion removes financial, provider, AI, sync, usage, and audit records, then restores empty default categories while preserving login/passkeys/sessions.

Application-controlled data is removed immediately in the transaction. Hashed rate-limit identifiers can remain through their short cleanup window and cannot reconstruct identity. Exports are streamed and not retained by MoneyOS. Platform logs, replicas, backups, browser downloads, and provider records are outside that transaction; configure payload-free logging, provider revocation, and written vendor retention/expiry schedules. Add paginated asynchronous export before histories can exceed serverless limits. Consent history, legal retention, backup expiry, and privacy notices remain launch gates.

## Database And Backups

- Use TLS, connection pooling supported by the selected provider, least-privilege runtime/migration roles, encrypted storage, and point-in-time recovery.
- Test restoration into an isolated project and verify schema, provider-token key availability, tenant constraints, and session invalidation.
- Track table/index growth for Transaction, AuditEvent, SyncRun, SyncJob, RateLimitBucket, and AIMessage.
- The queue drain deletes rate buckets only after they have been expired for 24 hours; a small deterministic sample of requests performs the same indexed cleanup when no drain is configured.
- Never run development seeds against production.

### Local/CI Logical Restore Drill

`npm run db:verify:restore` creates a custom-format logical dump, validates its catalog, restores with `--single-transaction --exit-on-error`, verifies required tables and completed migrations, compares per-table row counts plus a SHA-256 digest of representative aggregates, and runs Prisma migration status. It never drops a database. The destination must already exist, be empty, begin with `moneyos_restore_`, differ from the source, and match an explicit host/database confirmation.

~~~bash
createdb moneyos_restore_20260905
export BACKUP_SOURCE_DATABASE_URL='postgresql://.../moneyos_source'
export RESTORE_DATABASE_URL='postgresql://.../moneyos_restore_20260905'
export RESTORE_DATABASE_CONFIRM='db-host:5432/moneyos_restore_20260905'
npm run db:verify:restore
dropdb moneyos_restore_20260905
~~~

Run against a quiescent source or provider snapshot so concurrent writes cannot produce a safe false failure. The temporary dump is deleted even after failure. `PG_DUMP_BIN` and `PG_RESTORE_BIN` can select matching clients. Corrupt catalogs, partial restores, missing tables, failed migrations, row-count changes, and representative aggregate mismatches exit nonzero.

CI runs this after migrations and seed against isolated PostgreSQL. This proves MoneyOS logical recovery; it does not prove a managed provider's snapshot/PITR system. Before live launch, repeatedly restore an actual retained production backup into a new isolated database/project, deny application traffic, run migration/integrity/tenant checks, verify key availability without exposing tokens, record RPO/RTO evidence, and destroy the environment. Never point RESTORE_DATABASE_URL at production.

## Plaid Sandbox Validation

Normal CI and development skip external calls. `npm run test:plaid:sandbox` activates only with `RUN_PLAID_SANDBOX_E2E=true`. It refuses production mode, requires `PLAID_ENV=sandbox`, and requires a pre-migrated database named `moneyos_sandbox_e2e_*` plus exact `PLAID_SANDBOX_DATABASE_CONFIRM`.

The run creates a disposable tenant, creates a Link token, creates/exchanges a Sandbox public token, drains initial sync, verifies encrypted connection storage, normalized data, repository visibility, and the grounded account-balance AI tool, then revokes the Item and deletes the tenant. It logs only counts/status. Set `PLAID_SANDBOX_FIRE_WEBHOOK=true` only when PLAID_WEBHOOK_URL is publicly reachable.

~~~bash
export NODE_ENV=test
export DEMO_MODE=false
export RUN_PLAID_SANDBOX_E2E=true
export DATABASE_URL='postgresql://.../moneyos_sandbox_e2e_local'
export PLAID_SANDBOX_DATABASE_CONFIRM='localhost:5432/moneyos_sandbox_e2e_local'
export PLAID_ENV=sandbox
export PLAID_CLIENT_ID='...'
export PLAID_SECRET='...'
export PROVIDER_TOKEN_ENCRYPTION_KEY='32-byte-key-as-base64'
npm run test:plaid:sandbox
~~~

Tests never use real bank credentials. Credential absence is a documented skip, not a passing external integration claim. If cleanup reports failure, revoke the Sandbox Item before discarding the test database.

## Incident Minimum

Assign an incident owner before live connections. Prepare procedures for leaked secrets, webhook failures, provider outages, stuck queues, cross-tenant suspicions, incorrect reconciliation, lost keys, and failed disconnect/revocation. Rotate exposed secrets, stop sync safely, preserve payload-free evidence, notify providers/users as legally required, and never hide unavailable data as zero.
