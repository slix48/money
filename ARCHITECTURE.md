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
- src/auth: Argon2id passwords, opaque/signed sessions, cookies, and server-only DAL.
- src/ai: fixed read-tool catalog, deterministic planning, structured execution, and grounded answer composition.
- src/app/api: authenticated, origin-checked, rate-limited JSON boundaries for auth, transactions, recurring records, income streams, goals/contributions, and financial questions.
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

- User, Session, AuditEvent
- Account, Category, Transaction
- RecurringTransaction, IncomeStream
- InvestmentAccount, Holding, InvestmentTransaction
- NetWorthSnapshot
- Goal, GoalContribution
- Insight
- AIConversation, AIMessage

Financial and AI records carry direct user ownership. Parent tables have composite id/userId keys where needed, preventing a row from referencing another tenant's parent. AIMessage ownership is copied from and constrained to its conversation.

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

FinancialDataProvider and BrokerageDataProvider use connection-scoped cursors so initial and incremental sync share one contract. Webhook verification stays inside the adapter; verified events should enqueue background work rather than perform sync in a request. External IDs, source provenance, raw/normalized fields, and removal records support reconciliation.

MarketDataProvider returns source, as-of time, and delay state. Mock prices are delayed DEMO records. AIProvider is an untrusted planning/wording adapter. See PROVIDERS.md for connection, credential, webhook, downtime, and disconnection requirements.

## Performance Shape

Server pages load one user snapshot and calculate derived views in process. FinancialToolContext caches that snapshot per question, avoiding repeated repository loads for multi-tool answers. Common database paths are indexed and Prisma queries include related records in bounded batches rather than per-row calls.

The snapshot repository is appropriate for the current dataset but is not the final high-scale read model. Before large histories, add paginated transaction queries, database aggregates/materialized summaries, background snapshot/insight jobs, and bounded AI tool payloads.

## Deployment Direction

Deploy as a Node.js service with PostgreSQL. Vercel demo mode needs no database and derives its canonical origin from VERCEL_URL when APP_URL is absent. Before horizontal production scaling:

- replace process-local rate limiting with a shared atomic store
- add a durable queue and worker for provider sync/recomputation
- add observability that excludes financial payloads
- validate row-level security and least-privilege database roles
- add exports/deletion, recovery, MFA/passkeys, and session management

Mobile clients should call versioned authenticated APIs over the same domain and tool services, never duplicate accounting logic.
