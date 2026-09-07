# MoneyOS Provider Readiness

Provider adapters translate external systems into MoneyOS domain records. Pages, calculations, and AI tools must not depend on a vendor SDK or payload shape.

## Current Contracts

FinancialDataProvider:

- creates a short-lived connection session
- exchanges temporary connection credentials on the server
- supports initial and cursor-based incremental account/transaction sync
- reports removed external transaction IDs
- verifies provider webhooks inside the adapter
- disconnects a specific user-owned connection

BrokerageDataProvider:

- imports a bounded holdings snapshot and overlapping investment activity
- preserves provider account/security/activity identity and missing-data states
- remains read-only and separate from market/order execution

MarketDataProvider:

- returns quote time, currency, source, and delay status
- keeps mock quotes explicitly marked DEMO and delayed

AIProvider:

- may propose calls only from the supplied read-tool catalog
- receives minimal structured tool results for answer formatting
- remains outside database and action execution boundaries

FinancialActionProvider and SubscriptionActionProvider:

- report capability before preparation
- separate proposal, policy permission, explicit confirmation, and execution
- require idempotency and auditable results
- are implemented by V1ActionsUnavailable in the current product

## Current Adapters

PlaidFinancialDataProvider is implemented with the official Plaid SDK:

- Transactions is required and Investments is optional in Link
- public-token exchange and Item removal are server-only
- Plaid account types map into MoneyOS account types
- Transactions Sync supplies additions, modifications, removals, and cursors
- Plaid's positive-outflow convention is converted at the adapter boundary
- provider merchant/category data remains a hint and original descriptions are preserved
- webhook JWT, key ID, issued-at window, and exact body hash are verified
- signature/key identifiers and public-key cache are bounded; body hashes are compared in constant time

PlaidBrokerageDataProvider imports read-only holdings, security metadata, and investment activity. Institution values retain source/as-of/delay state. Missing basis remains missing.

MockFinancialDataProvider and MockBrokerageDataProvider remain deterministic development/test adapters. MockMarketDataProvider remains the only dedicated quote adapter, because adding an unlicensed or costly real-time feed is not justified for this phase.

## Bank Connection Lifecycle

The implemented Plaid path provides:

1. A server-created link session scoped to the authenticated user and allowed redirect URI.
2. Server-side exchange of temporary credentials.
3. AES-256-GCM storage of provider access tokens and isolated connection identifiers.
4. Initial sync followed by durable cursor-based incremental sync.
5. Signed, deduplicated webhook intake that only enqueues work.
6. Idempotent upserts keyed by provider connection, source, and external ID.
7. Pending-to-posted reconciliation, removed transaction handling, duplicate detection, transfer pairing, and refund matching.
8. Connection-health, consent-expiry, reconnect, provider-outage, and disconnect UX.
9. Bounded retry, leases, safe failure categories, freshness metadata, and provider call metrics.
10. Provider-token revocation with history-preserving disconnect.

Production still needs managed KMS key protection/rotation, operator alerts, dead-letter tooling, formal reconciliation reports, legal retention/consent policy, and provider/vendor launch approval. Immediate export and provider-aware deletion are implemented for early histories.

## Plaid Sandbox E2E

`npm run test:plaid:sandbox` is a credentialed opt-in validator and otherwise exits with an explicit skip. It refuses production and requires an exact confirmation for a disposable `moneyos_sandbox_e2e_*` PostgreSQL database. It covers Link-token creation, Sandbox public-token exchange, encrypted connection persistence, initial transaction sync, normalized repository visibility, grounded AI account balances, Item revocation, and tenant cleanup. Optional signed webhook firing requires a publicly reachable configured webhook URL. CI relies on provider fixtures and only checks the no-credential skip path; external success cannot be claimed without supplied Plaid Sandbox credentials.

Never perform a large provider sync inside a user request. The PostgreSQL queue syncs, normalizes, reconciles, persists atomically, updates freshness, and recomputes recurring/income records from a bounded 18-month history plus the current net-worth snapshot. See SYNC_ENGINE.md.

## Brokerage Requirements

Read-only brokerage sync must preserve external account/activity IDs, currency, trade date, settlement date where supplied, quantity precision, fees, and provider cost basis. Corporate actions, splits, transfers between brokers, options, multiple tax lots, and missing basis need explicit data-quality states.

Do not infer realized gain when a provider does not supply enough lot/cost information. Holdings values and activity cash flows require reconciliation because a current balance series is not a performance series.

Trading is a separate regulated phase and must never be added to BrokerageDataProvider or the AI read registry.

## Market Data Requirements

Choose a licensed source and define entitlements for real-time, delayed, end-of-day, historical, and derived values. Persist:

- provider security identifier and canonical ticker
- exchange, currency, asset class, and optional sector metadata
- price and as-of time
- source and delay status
- corporate actions and symbol changes

Sector concentration should appear only when coverage is reliable and missing metadata is disclosed. Multi-currency values require an explicit FX source and as-of policy.

## AI Provider Requirements

Before external-model use:

- complete vendor privacy/security and contractual review
- disable training use where required
- define retention and region controls
- minimize fields and redact unnecessary identifiers
- apply request budgets, timeouts, retry limits, and safe observability
- revalidate every planned call against the local registry
- evaluate fabrication, injection, cross-user leakage, and action requests

The deterministic provider-free planner remains the fallback.

## Cancellation And Other Actions

SubscriptionActionProvider reserves:

- getCancellationCapability
- prepareCancellation
- executeCancellation

Capability can be unavailable, API-based, assisted, or manual. Preparation must not cancel anything. Execution requires a validated ActionProposal, allowed ActionPermission, authenticated ActionConfirmation, idempotency key, audit trail, and post-action reconciliation.

Transfers, bill payments, savings transfers, and brokerage orders follow the same trusted flow but are not implemented. They require regulated partners, separate services, threat models, limits, support, exception handling, and legal/compliance approval.

## Failure Semantics

Adapters should return stable internal error codes without leaking raw provider responses to clients. Distinguish retryable outage/rate-limit errors from consent, authentication, unsupported-account, and permanent data errors. Logs may contain request IDs, connection IDs after pseudonymization, counts, cursors after protection, and timing. They must not contain access tokens, raw payloads, full histories, balances, or account numbers.

Provider pages render stored data and do not call adapters. Adapters return stable normalized records and safe internal failure categories without leaking SDK response bodies. UsageMetric and SyncRun record calls/counts/timing, never financial payloads. Mock providers are for development and CI only.
