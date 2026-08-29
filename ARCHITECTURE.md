# MoneyOS Architecture

## System Shape

MoneyOS is a Next.js App Router application with a modular server-side core. The V1 web application is one deployable unit, but its domain, repository, provider, and AI boundaries are designed for reuse behind future mobile clients.

```text
React pages and clients
        |
Next.js route handlers and server pages
        |
Auth DAL + Zod boundary validation
        |
Financial repository interface
   |                      |
Demo repository      Prisma repository
   |                      |
Mock providers          PostgreSQL
        |
Deterministic calculations and insight engine
        |
Permissioned read-only AI tool registry
```

## Modules

- `src/domain`: provider-neutral types, integer-cents calculations, demo fixtures, insight ranking, and What Changed analysis.
- `src/data`: the `FinancialRepository` contract plus demo and Prisma implementations. Repository methods always accept or derive a user identifier.
- `src/providers`: replaceable financial-data, market-data, and future action-provider contracts. Mock quotes are explicitly marked as demo data.
- `src/auth`: password hashing, session creation, cookie handling, and the server-only data access layer.
- `src/ai`: allowlisted financial read tools, query planning, structured results, and grounded answer composition.
- `src/app/api`: authenticated HTTP boundaries for sign-in, registration, logout, goals, transactions, and financial questions.
- `src/components`: responsive product UI, charts, tables, drawers, dialogs, Money Flow, and assistant surfaces.
- `prisma`: relational schema, generated migration, and idempotent development seed.

## Request And Ownership Flow

1. `proxy.ts` performs an optimistic session-cookie presence check for protected routes.
2. A server page or route handler calls the auth DAL. The DAL verifies the session and returns a minimal user object.
3. Inputs are parsed with Zod and mutation requests pass the same-origin check.
4. The repository receives the authenticated `userId`; caller-supplied user identities are never trusted.
5. Prisma queries include `userId` in ownership filters. Owned related records, such as a goal's linked account, are revalidated.
6. Domain calculations consume normalized records and return structured results to UI or AI layers.

The proxy is not an authorization boundary. The DAL and repository are authoritative.

## Data Model

The schema covers `User`, `Session`, `Account`, `Category`, `Transaction`, `RecurringTransaction`, `IncomeStream`, `InvestmentAccount`, `Holding`, `InvestmentTransaction`, `NetWorthSnapshot`, `Goal`, `Insight`, `AIConversation`, `AIMessage`, and `AuditEvent`.

Financial tables carry `userId`, indexed for tenant-scoped access. Parent relationships and uniqueness constraints prevent ambiguous records. Historical net-worth snapshots are stored rather than reconstructed from current balances.

## Financial Calculation Policy

- Money is represented as integer cents; percentages are calculated only at presentation/analysis boundaries.
- Pending transactions are visible but excluded from settled totals.
- Internal transfers and credit-card payments do not count as income or spending.
- Refunds are negative expenses and reduce the corresponding merchant/category total.
- Investment contributions are cash-flow allocations, not investment returns.
- Loan principal payments are debt allocations rather than ordinary consumption where classified as such.
- Portfolio weight is current holding value divided by total portfolio value.
- Goal completion estimates use the configured/current contribution pace and never assume market returns.
- Recurring changes compare observed charges and apply deterministic materiality rules.

These policies live in `src/domain/calculations.ts`, not in UI components or model prompts.

## AI Financial Intelligence

The assistant cannot issue arbitrary SQL or receive a database handle. `src/ai/tool-registry.ts` exposes a fixed set of read tools such as balances, net worth, spending, income, recurring charges, portfolio allocation, goals, cash flow, and period comparisons.

Each tool executes with an authenticated `ToolContext` and a user-scoped repository snapshot. The assistant planner selects tools from this registry, and answer composition uses only returned structured values. Numeric answers include a calculation receipt and tool provenance. Output is rendered as plain React text, not trusted HTML.

The action-provider contract is separate and intentionally unavailable in V1. Future writes require explicit confirmation, policy checks, idempotency, and a trusted execution service.

## Provider Strategy

`FinancialDataProvider` and `MarketDataProvider` isolate aggregation and quote sources from application logic. A Plaid-like provider or market-data vendor can be added behind those contracts, normalize external payloads into domain types, and preserve the repository and calculation layers.

Provider ingestion should be asynchronous, idempotent, observable, and retain source identifiers. Webhook verification and reconciliation belong in the provider adapter, not in route components.

## Deployment Direction

The current unit can deploy as a Node.js service with PostgreSQL. Before horizontal scaling, replace process-local rate limiting with a shared store and add a job queue for provider syncs and insight refreshes. Mobile applications should consume versioned authenticated APIs over the same domain and tool services rather than duplicate finance logic.
