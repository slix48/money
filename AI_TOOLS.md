# MoneyOS AI Tool Architecture

MoneyOS AI is a read-only financial investigation layer. It does not receive a database client, arbitrary SQL, provider credentials, or mutation functions.

## Request Flow

1. The API authenticates the session and rejects foreign origins.
2. Zod validates and bounds the question.
3. The application creates a FinancialToolContext with the authenticated user ID and user-scoped repository.
4. A planner selects names from the fixed tool registry.
5. Every input is validated again by that tool's schema.
6. The tool calculates a structured result from the user's snapshot.
7. The answer formatter uses only those structured results for financial facts and exposes tool provenance.

The context caches one snapshot per question so multiple tools reason over a consistent view without duplicate repository reads.

## Registered Read Tools

Accounts and net worth:

- getAccountBalances
- getAccounts
- getNetWorth
- getNetWorthHistory

Transactions and spending:

- getTransactions
- searchTransactions
- getSpendingByCategory
- getSpendingByMerchant
- getLargestExpenses
- compareSpendingPeriods

Income and cash flow:

- getIncome
- getIncomeStreams
- compareIncomePeriods
- calculateCashFlow
- getCashFlow

Recurring charges:

- getRecurringExpenses
- getSubscriptions
- getSubscriptionChanges

Investments:

- getPortfolio
- getHolding
- getPortfolioAllocation
- getInvestmentActivity
- getInvestmentContributions
- getInvestmentPerformance
- getDividends

Goals and scenarios:

- getGoals
- calculateGoalScenario
- calculatePurchaseScenario

Insights:

- getWhatChanged

Every catalog entry has READ access. Unknown tools fail closed. Tool names related to transfer, trade, payment, or cancellation are intentionally absent.

## Grounding Rules

- Numeric answers come from tool results, never language-model memory.
- Pending transactions are excluded unless a tool explicitly permits and receives includePending=true.
- Transfers, card payments, refunds, and investment cash flows retain the semantics in FINANCIAL_CALCULATIONS.md.
- Missing data produces an unavailable/uncertain answer, not an estimate disguised as fact.
- Cost-basis-dependent performance remains unavailable when cost basis is incomplete.
- Demo portfolio answers disclose that tracked prices are not live.
- Goal and purchase answers are scenarios, not decisions or guarantees.

The deterministic planner currently covers the product's supported question families without an external model credential. An external AIProvider may later plan calls or improve wording, but its output remains untrusted and must pass the same allowlist and Zod schemas.

## Data Isolation

The browser never supplies a user ID. The tool context receives identity from the authenticated session. Its repository snapshot is tenant scoped, and database relationships include user ownership. Tests exercise a second user and verify that tools return the same non-enumerating not-found behavior as repositories.

Do not send an entire snapshot to an external model. Execute tools locally and send only the minimum structured results needed for the answer. Provider contracts must define retention, training use, regional processing, deletion, incident notification, and subprocessors before launch.

Before a tool result can reach an external AI provider, the execution boundary recursively removes internal userId fields and serializes dates. Account and entity identifiers remain only where they are required for a user-requested lookup or scenario.

## Untrusted Content

Merchant names, descriptions, notes, and provider metadata can contain prompt-injection text. Treat them as data fields, never instructions. Do not concatenate imported text into a system/developer prompt that can change tool permissions. Render answers as escaped React text, not HTML.

## Future Action Flow

src/providers/action-provider.ts defines:

- FinancialAction
- ActionProposal
- ActionPermission
- ActionConfirmation
- ActionExecutionResult

Any future action must follow:

~~~text
AI or user proposes
  -> application validates identifiers, amount, capability, and policy
  -> authenticated user reviews an immutable preview
  -> user explicitly confirms, with step-up authentication when required
  -> trusted provider executes once using an idempotency key
  -> application records and reconciles the result
~~~

The proposal is not authorization. The AI cannot create a valid confirmation nonce, approve policy, or invoke an execution provider. V1ActionsUnavailable fails closed during preparation and execution. SubscriptionActionProvider also exposes capability, preparation, and execution separately, but cancellation is unavailable in V1.

## Evaluation

src/ai/tool-registry.test.ts verifies the required demo questions, arithmetic receipts, allowlist enforcement, tool selection, merchant search, goal scenarios, investment separation, and cross-user isolation. Future model adapters need adversarial evaluations for fabricated numbers, prompt injection, unsupported actions, ambiguous periods, missing data, and contradictory provider records.
