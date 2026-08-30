# MoneyOS Provider Readiness

Provider adapters translate external systems into MoneyOS domain records. Pages, calculations, and AI tools must not depend on a vendor SDK or payload shape.

## Current Contracts

FinancialDataProvider:

- creates a short-lived connection session
- reports consent and connection health
- supports initial and cursor-based incremental account/transaction sync
- reports removed external transaction IDs
- verifies provider webhooks inside the adapter
- disconnects a specific user-owned connection

BrokerageDataProvider:

- cursor-syncs holdings and investment activity
- preserves account/user ownership
- disconnects a specific brokerage connection

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

## Bank Connection Requirements

A real aggregation adapter needs:

1. A server-created link session scoped to the authenticated user and allowed redirect URI.
2. Server-side exchange of temporary credentials.
3. Encrypted storage of provider access/refresh tokens and connection identifiers.
4. Initial sync followed by durable cursor-based incremental sync.
5. Verified, replay-protected webhook intake that only enqueues work.
6. Idempotent upserts keyed by provider connection, source, and external ID.
7. Pending-to-posted reconciliation, removed transaction handling, duplicate detection, transfer pairing, and refund matching.
8. Connection-health, consent-expiry, reconnect, provider-outage, and disconnect UX.
9. Backoff, dead-letter handling, reconciliation reports, freshness metrics, and operator alerts.
10. Data export/deletion and provider-token revocation.

Never perform a large provider sync inside a user request. A queue worker should sync, normalize, reconcile, persist in a database transaction, update freshness, and recompute affected snapshots/insights.

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

## Product Billing

Charging users for MoneyOS is separate from moving their financial funds. For low operating complexity, use a hosted checkout and customer portal from a payment processor behind a future product-billing adapter. Annual plans reduce transaction count; ACH can be offered for suitable larger invoices. Processing fees cannot be made zero without becoming a payment processor, which MoneyOS should not attempt.

Do not store card data, build a card vault, or commingle subscription billing code with FinancialActionProvider. Verify billing webhooks, use idempotency, and store only processor customer/subscription references and entitlement state.

## Failure Semantics

Adapters should return stable internal error codes without leaking raw provider responses to clients. Distinguish retryable outage/rate-limit errors from consent, authentication, unsupported-account, and permanent data errors. Logs may contain request IDs, connection IDs after pseudonymization, counts, cursors after protection, and timing. They must not contain access tokens, raw payloads, full histories, balances, or account numbers.

MockFinancialDataProvider and MockBrokerageDataProvider exercise cursor contracts and reject other users. MockMarketDataProvider is for development only.
