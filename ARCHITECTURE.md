# MoneyOS Architecture

## System Shape

MoneyOS is a Next.js App Router application with a modular server-side core. V1 is one deployable unit, while domain, repository, provider, and AI contracts can serve future versioned mobile APIs.

~~~text
React server/client UI
        |
Next.js pages and route handlers
        |
Session DAL + origin checks + Zod validation + rate limits
        |
User-scoped FinancialRepository
   |                          |
Demo repository          Prisma repository
   |                          |
Mock providers              PostgreSQL
        |
Deterministic calculations, recurring detection, and insights
        |
Allowlisted read-only AI tools

Future external systems:
FinancialDataProvider | BrokerageDataProvider | MarketDataProvider | AIProvider

Separate unavailable execution path:
proposal -> policy -> user confirmation -> trusted provider -> audit/reconcile
~~~

## Modules

- src/domain: provider-neutral records, integer-cent calculations, realistic fixtures, recurring detection, insight ranking, financial health, and What Changed.
- src/data: FinancialRepository plus demo and Prisma implementations. All reads and writes are scoped by authenticated user.
- src/providers: cursor-based bank/brokerage sync, quote provenance, external AI, subscription-action, and financial-action contracts.
- src/sync: connection lifecycle, durable PostgreSQL queue, cursor engine, normalization/reconciliation, Prisma persistence, and read-only investment import.
- src/auth: Argon2id passwords, WebAuthn passkey MFA, one-use ceremonies, opaque/signed sessions, cookies, and server-only DAL.
- src/privacy: explicitly allowlisted export, tenant-scoped session revocation, provider-aware financial-data deletion, and account deletion.
- src/ai: fixed read-tool catalog, deterministic planning, structured execution, and grounded answer composition.
- src/app/api: authenticated, origin-checked, rate-limited JSON boundaries for auth, privacy, transactions, recurring records, income streams, goals/contributions, and financial questions.
- src/app/api/connections and src/app/api/providers: Plaid Link exchange, tenant-scoped refresh/disconnect, signed webhooks, and protected queue recovery.
- src/components: preserved responsive product UI, accessible charts, filters/tables, drawers/dialogs, Money Flow, and chat.
- prisma: relational schema, tenant-integrity migrations, generated client, and idempotent development seed.

## Request And Ownership Flow

1. proxy.ts performs an optimistic session-cookie presence check for protected navigation.
2. A server page or route calls the DAL, which validates the session and returns a minimal user object.
3. Mutation and assistant requests must have the canonical origin and JSON media type. Bodies are bounded and parsed by Zod.
4. The repository receives user.id from the session. Browser-supplied user identity is never accepted.
5. Reads filter by userId. Writes use ownership-constrained updateMany/findFirst checks and non-enumerating not-found responses.
6. Composite foreign keys include child userId and parent userId for accounts, categories, recurring records, investment accounts, goals, contributions, and AI conversations/messages.
7. Domain services calculate structured results. UI and AI format those results without recomputing accounting logic.

The proxy is not authorization. DAL, repository, and database constraints are the layered boundaries.

## Data Model

Core models:

- User, Session, WebAuthnCredential, WebAuthnChallenge, AuditEvent, RateLimitBucket
- Account, Category, Transaction
- FinancialConnection, ProviderAccount, SyncJob, SyncRun, UsageMetric
- RecurringTransaction, IncomeStream
- InvestmentAccount, Holding, InvestmentTransaction
- NetWorthSnapshot
- Goal, GoalContribution
- Insight
- AIConversation, AIMessage

Financial and AI records carry direct user ownership. Parent tables have composite id/userId keys where needed, preventing a row from referencing another tenant's parent. AIMessage ownership is copied from and constrained to its conversation.

Provider metadata stays separate from MoneyOS accounts and transactions. Connection-scoped external IDs drive idempotency. Removed transactions are retained as soft removals; raw descriptions and normalized merchants are separate; user classification overrides survive provider updates. Account balances carry AVAILABLE, STALE, or UNAVAILABLE state so an outage cannot appear as a zero balance. Provider ciphertext records carry both encryption scheme and key version for mixed-scheme migration. SyncRun permits one RUNNING row per connection; SyncJob stores claim/finish times for lease and latency operations.

Indexes cover common user/date, user/type, user/category, merchant, pending-status, recurring-status, holding-value, and conversation access paths. Historical net worth is stored as snapshots instead of reconstructed from today's balances.

## Calculation Boundary

Database adapters map Decimal major-currency values to integer cents. src/domain/calculations.ts then owns:

- settled/pending policy
- net expense and refund handling
- income classification
- transfer and card-payment exclusions
- debt, cash-savings, and investment-contribution allocation
- net worth
- portfolio weights and contribution/return separation
- goal history and zero-return scenarios
- recurring cadence/confidence and price changes
- period comparisons

See FINANCIAL_CALCULATIONS.md for formulas and limitations.

## AI Financial Intelligence

The assistant has no SQL or repository mutation access. FinancialToolContext holds authenticated identity and a cached user-scoped snapshot. Each registered tool has READ access, a Zod input schema, a bounded result, and deterministic calculation logic.

The current planner is deterministic and needs no model credential. AIProvider reserves an external adapter without granting it authority: proposed calls must still pass the local allowlist/schema, and only minimal structured results may leave the application. Numeric answer receipts and tool names remain visible.

See AI_TOOLS.md for the catalog, grounding, isolation, and evaluation rules.

## Action Boundary

FinancialActionProvider models an immutable proposal, policy permission, authenticated confirmation, and execution result. SubscriptionActionProvider models cancellation capability, preparation, and execution separately. V1ActionsUnavailable reports unavailable and throws on preparation/execution.

No action provider is reachable from the AI registry or current routes. Future execution belongs in a trusted service with step-up authentication, idempotency, limits, audit events, provider reconciliation, and regulatory controls.

## Provider And Sync Strategy

PlaidFinancialDataProvider implements Link-token creation, server-side public-token exchange, account normalization, Transactions Sync pagination, signed-webhook verification, and provider revocation behind FinancialDataProvider. MockFinancialDataProvider remains the credential-free demo/test adapter.

FinancialSyncEngine fetches every cursor page before one atomic commit. It handles additions, modifications, removals, pending-to-posted replacement, provider conflict restart, and conservative transfer/card-payment/refund reconciliation. SyncJob provides durable deduplication, leases, and bounded retry in PostgreSQL. Next.js after-processing supplies low-latency execution; a protected scheduled drain supplies recovery without an always-running worker.

PlaidBrokerageDataProvider imports read-only holdings and investment activity. Cost basis remains nullable, values carry source/as-of/delay state, and investment product failure does not erase bank data. No provider exposes trading.

MarketDataProvider returns source, as-of time, and delay state. Mock prices are delayed DEMO records; synchronized institution values are clearly labeled and no separately licensed real-time market feed is claimed. AIProvider is an untrusted planning/wording adapter. See PROVIDERS.md and SYNC_ENGINE.md.

## Performance Shape

Server pages load stored synchronized records and calculate derived views in process; page renders never call a financial provider. FinancialToolContext caches one tenant-scoped snapshot per question, avoiding repeated repository loads for multi-tool answers. Common database paths are indexed. Account and holding sync loads existing records in batches before upserts rather than doing lookup queries per provider row.

The snapshot repository is appropriate for the current dataset but is not the final high-scale read model. Before large histories, add paginated transaction queries, database aggregates/materialized summaries, background snapshot/insight jobs, and bounded AI tool payloads.

## Deployment Direction

Deploy as a Node.js service with PostgreSQL. Provider-backed modules are lazy-loaded so Vercel demo mode needs no database and derives its canonical origin from VERCEL_URL when APP_URL is absent. GitHub Actions provisions PostgreSQL and verifies zero-state migrations, previous-to-current upgrade, seed, logical backup restoration with integrity manifests, integration tests, the optional Plaid skip path, the production environment contract, static checks, unit tests, and production build. Connected mode uses atomic hashed PostgreSQL rate buckets across instances; no Redis service is required. Before horizontal production scaling:

- decide whether the durable PostgreSQL queue needs a dedicated worker based on measured latency and failure rates
- move provider token key protection to managed KMS envelope encryption
- add alerts and tracing that exclude financial payloads; aggregate queue/key-version health already exists behind the internal bearer boundary
- validate row-level security and least-privilege database roles
- add reviewed passkey recovery, email verification, session/device inventory, consent, and legal retention/backup-expiry automation

Mobile clients should call versioned authenticated APIs over the same domain and tool services, never duplicate accounting logic.

The repository has no Vercel project-link configuration. Both money and money-o9u5 appear to be dashboard-side Git integrations for the same repository. Treat money as canonical by exact product name and manually disconnect or pause money-o9u5 only after verifying domains, environment variables, and traffic in the Vercel dashboard. Do not configure duplicate cron drains.
