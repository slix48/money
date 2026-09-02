# MoneyOS Synchronization Engine

MoneyOS imports read-only financial data into provider-neutral domain models. Plaid is the first real adapter; demo mode uses mock adapters. Pages, calculations, recurring detection, insights, and AI tools read normalized stored data and do not depend on Plaid payloads.

## Connection Lifecycle

~~~text
authenticated user
  -> server creates short-lived Plaid Link token
  -> browser runs Plaid Link
  -> browser sends public token to MoneyOS server
  -> server exchanges public token
  -> server encrypts access token and stores connection
  -> durable SyncJob is queued
  -> initial account/transaction sync
  -> optional read-only investment sync
  -> stored normalized data powers the product
~~~

The browser never receives an access token, Plaid secret, sync cursor, or raw provider response. Every route derives userId from the validated session. For mobile/desktop OAuth bank handoff, only the short-lived Link token and mode are kept in tab-scoped session storage until the returned oauth_state_id is passed back to Link; that state is cleared on success or exit.

## Persistence

- FinancialConnection: tenant, provider Item, encrypted token, cursor, consent/health, timestamps.
- ProviderAccount: provider account metadata linked to a same-tenant MoneyOS Account.
- SyncJob: durable queue state, lease, retry count, dedupe key.
- SyncRun: duration, safe outcome category, record counts, provider-call counts.
- UsageMetric: daily aggregate request/unit counts without financial content.
- Transaction: provider ID, raw description, normalized merchant, provider hints, override flags, removal/pending/reconciliation metadata.

Composite foreign keys prevent cross-tenant connection/account/transaction relationships.

## Token Handling

Provider access tokens are encrypted with AES-256-GCM using a 32-byte server-only key. Ciphertext is versioned and includes a random nonce and authentication tag. Tokens:

- are never returned through APIs
- are never placed in audit metadata or logs
- are decrypted only in server-side connection/sync services
- are cleared after confirmed disconnect or provider revocation

PROVIDER_TOKEN_ENCRYPTION_KEY is an application-level early-stage control. Production should move the key hierarchy to managed KMS envelope encryption, restrict decrypt permissions to sync execution, version keys, rotate them, and test recovery. Database encryption at rest alone is not a sufficient long-term token control.

## Initial And Incremental Sync

FinancialSyncEngine.sync():

1. Loads the connection using authenticated userId plus connectionId.
2. Creates a SyncRun.
3. Loads provider accounts.
4. Requests transaction changes from the stored cursor until hasMore=false.
5. Restarts pagination once from the original cursor if Plaid reports a mutation-during-pagination conflict.
6. Normalizes and reconciles all received changes.
7. Atomically persists accounts, additions, modifications, removals, derived records, and the new cursor.
8. Records only counts, duration, and a safe result category.

The engine caps pagination at 100 pages per run. The cursor is not advanced until the database transaction succeeds. A provider or persistence failure therefore replays safely from the previous cursor.

External transaction identity is unique within a connection. Repeating the same page does not duplicate records. Removed transactions are soft-removed so audit/history semantics remain available.

## Pending To Posted

When a posted record carries the provider's pending transaction ID, MoneyOS updates the owned pending record to the posted external ID when safe. It does not count both records. User category/type overrides survive provider modifications.

## Classification And Reconciliation

Provider categories are untrusted hints. MoneyOS accounting semantics remain authoritative.

- Internal transfers need equal-and-opposite amounts, close dates, owned accounts, and transfer-description/category evidence.
- Credit-card payment pairs require owned bank/card accounts and payment evidence. The bank leg is debt repayment and the card leg is transfer, never new spending.
- Brokerage funding pairs become investment contribution plus transfer.
- Refunds are positive non-income transactions and inherit merchant/category context when a plausible prior purchase exists.
- Unexplained positive credits remain adjustments, not automatically income.
- Uncertain pairs remain unmatched and can be corrected by the user.

Reconciliation confidence and reason are stored. User overrides take precedence on later syncs.

## Webhooks

POST /api/providers/plaid/webhook:

1. Rejects oversized bodies.
2. Verifies Plaid's signed JWT and body hash inside the provider adapter.
3. Rejects stale or future-skewed signatures.
4. Resolves the opaque provider Item to an internal tenant-owned connection.
5. Deduplicates the provider event in SyncJob.
6. Enqueues work and acknowledges promptly.

The handler never performs full synchronization inline. Verification public keys are cached for 10 minutes. Webhook payloads are validated as untrusted input and are not stored wholesale.

Connection-error and consent-expiry events update safe health messages. Provider-revocation events clear the token and preserve imported history.

## Queue And Failure Recovery

The early-stage durable queue uses PostgreSQL:

- queued jobs are claimed with an expiring lease
- duplicate webhook IDs and refresh windows share a unique dedupe key
- retries use bounded exponential delay
- a job is attempted at most three times
- stale leases can be reclaimed
- disconnect cancels queued/processing jobs

Next.js after-processing starts low-latency best-effort work. POST /api/internal/sync/drain, protected by CRON_SECRET, drains queued work for scheduled recovery. The current repository intentionally does not include Vercel cron configuration because two Vercel projects are connected and duplicate schedules would double work. Configure one schedule only on the canonical project.

For larger scale or stricter delivery guarantees, keep the SyncJob contract and replace the processor with durable managed execution. Do not move provider synchronization into webhook or page requests.

Safe failure categories distinguish authentication, provider outage, rate limit, sync conflict, invalid response, configuration, and unknown failure. Balances become unavailable/stale where appropriate; the UI must not render unavailable data as $0.

## Investments

Plaid's read-only investment adapter imports accounts, holdings, securities, and activity where the connected institution supports them.

- Holdings include provider security ID, source, as-of time, currency, and delay state.
- Missing cost basis is stored as unavailable, never fabricated.
- Contributions, withdrawals, dividends, interest, fees, buys, and sells remain distinct.
- Investment sync uses a 45-day overlap after the first 24-month import and external-ID upserts.
- A product-not-supported response does not erase bank sync or existing investment data.
- Database persistence failures propagate for retry instead of appearing as no investment data.

No trading or order capability exists.

## Refresh And Disconnect

Manual refresh is session-authorized, same-origin protected, process-rate-limited, and deduplicated in PostgreSQL to one window per connection. It reads stored data while the refresh runs.

Disconnect policy is preserve-history:

1. Mark connection DISCONNECTING.
2. Ask the provider to revoke/remove the Item.
3. Only after provider confirmation, clear encrypted credentials/cursor.
4. Mark accounts disconnected/stale.
5. Preserve imported accounts, transactions, holdings, and analytics history.

If revocation fails, MoneyOS retains the encrypted token so the user can retry and does not claim that disconnection succeeded.

## Demo Mode

DEMO_MODE=true requires no database or Plaid credentials. It uses mock repository/providers and never attempts a real connection. Provider-backed route modules are loaded lazily so credential-free demo builds remain viable.

## Operations

Monitor:

- queued/failed/stale jobs
- sync duration and records changed
- provider calls by operation/day
- cursor age and last successful sync
- connections needing attention
- active Plaid Items versus expected connected users

Never log tokens, cursors, descriptions, balances, account numbers, raw webhook bodies, or provider responses. Use provider request IDs only if they can be stored safely and are needed for support.
