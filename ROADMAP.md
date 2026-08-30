# MoneyOS Roadmap

The roadmap preserves a strict separation between financial intelligence and regulated financial actions. Dates and capabilities should follow validated user needs, security readiness, and partner constraints rather than feature pressure.

## Phase 1: Tracking And AI Financial Intelligence

- Complete read-only personal-finance tracking across accounts, spending, income, recurring charges, net worth, investments, and goals.
- Harden deterministic calculations, data quality, reconciliation, What Changed, and material insight ranking.
- Add production observability, accessibility, privacy controls, exports, account recovery, MFA/passkeys, and distributed security controls.
- Integrate an external model only through the permissioned read-tool layer with data-minimization and retention controls.

Current repository scope: this phase has a connected V1 foundation with mock providers, tenant-enforced PostgreSQL schema, audited calculations, persistent transaction/recurring/income/goal workflows, investment analytics, attention/health summaries, scenario tools, and grounded read-only AI.

Recommended next hardening work:

- Run migration/repository integration tests against disposable PostgreSQL in CI.
- Add paginated transaction read APIs and database-side dashboard aggregates before large real histories.
- Add holding and investment-activity import/edit workflows with reconciliation and cost-basis quality states.
- Add goal editing/deletion with explicit unlink rules and complete focus-trapped dialogs.
- Add passkeys/MFA, recovery, session/device management, distributed limits, privacy export/deletion, and production observability.
- Add a durable provider-sync queue and idempotent normalization/reconciliation pipeline before any real connection.

## Phase 2: Real Bank And Brokerage Connections

- Add regulated data-aggregation partners behind `FinancialDataProvider`.
- Add licensed market data and read-only brokerage sync behind `MarketDataProvider` and `BrokerageDataProvider`.
- Implement verified webhooks, background synchronization, consent lifecycle, reconnect flows, deduplication, reconciliation, and provider health.
- Preserve clear freshness labels and never describe delayed quotes as live.

This phase requires vendor contracts, privacy review, data-security assessment, operational support, and compliance analysis.

## Phase 3: Approved Financial Actions

- Consider supported subscription cancellation through vetted action providers.
- Require an explicit preview and user confirmation for every action.
- Add idempotency, policy checks, step-up authentication, immutable audit events, status tracking, rollback/exception handling, and provider reconciliation.
- Keep the AI assistant outside the trusted execution path.
- Persist and operationalize the existing proposal, permission, confirmation, result, and subscription-capability contracts only after approval.

Cancellation availability depends on provider support, consumer-protection obligations, legal review, security assessment, and reliable operational escalation.

## Phase 4: Potential Brokerage And Trading Integration

- Evaluate brokerage functionality only through properly regulated broker-dealer and clearing partners.
- Build suitability/appropriateness controls where applicable, disclosures, order previews, confirmations, market-hours behavior, surveillance support, statements, tax reporting, and customer support.
- Never allow autonomous AI trading or imply guaranteed returns.

This phase requires extensive legal, regulatory, licensing/partner, compliance, capital, cybersecurity, and operational work. It is not an extension of the V1 tool registry.

## Phase 5: Potential Banking Products

- Evaluate deposit, card, payment, or lending products only through appropriate banking infrastructure and regulated partners.
- Add ledger-grade accounting, reconciliation, fraud/risk operations, disputes, identity verification, sanctions screening, disclosures, complaints, funds-flow controls, and resilient support.

This phase requires banking partnerships and substantial legal, regulatory, security, compliance, risk, treasury, audit, and operational programs.

## Permanent Product Rules

- Investment returns are never guaranteed.
- Contributions and market returns remain separate.
- AI explains and investigates; deterministic services calculate.
- AI never autonomously transfers money, trades, pays bills, or changes accounts.
- Every action requires an authenticated, explicit, reviewable user decision through a trusted execution layer.
