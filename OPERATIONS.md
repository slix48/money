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

- queued, processing, failed, and stale-lease jobs
- oldest queued time
- active provider-token counts by key version
- count still using older key versions

Alert on sustained queued work, any stale lease, repeated failures, old successful-sync timestamps, and provider Items that remain active after users disconnect. Do not log response bodies from financial APIs or raise high-cardinality labels from user/connection IDs.

## Provider-Token Rotation

1. Convert a legacy key to PROVIDER_TOKEN_ENCRYPTION_KEYS with that same value at version 1; set PROVIDER_TOKEN_ENCRYPTION_KEY_VERSION=1.
2. Deploy and verify connection sync/reconnect/disconnect.
3. Add a new random version while retaining version 1, then change the current version.
4. Normal provider-token use decrypts the stored version and compare-and-swap re-encrypts it with the current version.
5. Monitor the protected health endpoint until no live connection uses the old version.
6. Retain old keys until every database backup containing old ciphertext has expired or been safely re-encrypted and restore-tested.

Do not place keys in repository files. The environment key ring is a transition control, not a replacement for KMS envelope encryption. Before material production, use managed KMS, least-privilege decrypt rights, rotation audit trails, and tested recovery.

## Privacy Operations

Settings lets an authenticated user download an immediate JSON archive and revoke all server-side sessions. The export uses explicit selections and omits passwords, session hashes, access tokens, cursors, provider Item IDs, and provider transaction IDs. Export and session routes are canonical-origin checked, shared-rate-limited, non-cacheable, and audited.

The immediate export is suitable only for early histories. Add asynchronous paginated export with short-lived encrypted object storage before records can exceed serverless memory/response limits. Account deletion, consent history, retention enforcement, provider revocation verification, backup expiry, and privacy/legal notices remain launch gates.

## Database And Backups

- Use TLS, connection pooling supported by the selected provider, least-privilege runtime/migration roles, encrypted storage, and point-in-time recovery.
- Test restoration into an isolated project and verify schema, provider-token key availability, tenant constraints, and session invalidation.
- Track table/index growth for Transaction, AuditEvent, SyncRun, SyncJob, RateLimitBucket, and AIMessage.
- The queue drain deletes rate buckets only after they have been expired for 24 hours; a small deterministic sample of requests performs the same indexed cleanup when no drain is configured.
- Never run development seeds against production.

## Incident Minimum

Assign an incident owner before live connections. Prepare procedures for leaked secrets, webhook failures, provider outages, stuck queues, cross-tenant suspicions, incorrect reconciliation, lost keys, and failed disconnect/revocation. Rotate exposed secrets, stop sync safely, preserve payload-free evidence, notify providers/users as legally required, and never hide unavailable data as zero.
