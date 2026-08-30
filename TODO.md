# Integration TODOs

These depend on credentials, durable production infrastructure, vendors, or regulated partners. V1 intentionally does not fake them.

## Financial Data

- Select and contract with an aggregation provider.
- Implement its adapter for connection sessions, server-side token exchange, encrypted token storage, consent/reconnect UX, verified webhooks, cursors, removals, and disconnect/revocation.
- Add a durable sync queue with retries, backoff, dead letters, per-connection locks, and freshness/health alerts.
- Implement idempotent external-ID upserts, pending-to-posted matching, duplicate detection, internal-transfer pairing, card-payment classification, refund matching, and reconciliation reports.
- Define raw-payload minimization, encryption, access, and retention.

## PostgreSQL And Scale

- Add CI integration tests that apply every migration to disposable PostgreSQL, run the seed, and test Prisma authorization/constraints.
- Add paginated repository queries for long transaction and activity histories.
- Move dashboard/insight recomputation to background summaries as data grows.
- Validate least-privilege roles and row-level security with application, worker, migration, support, and restore workflows.

## Market And Brokerage Data

- Select licensed quote/security-metadata sources and define delay/entitlement labels.
- Add symbol/security master mapping, corporate actions, splits, currencies/FX policy, historical prices, and reliable sector coverage.
- Implement a real read-only BrokerageDataProvider for holdings and activity.
- Reconcile positions, cash, fees, transfers, tax lots, and missing basis.
- Define and validate time-weighted/money-weighted performance before exposing those metrics.

## Investment Workflows

- Add authenticated import/manual workflows for holdings and all investment activity types.
- Add cost-basis quality states, reconciliation warnings, and account freshness.
- Add realized-gain handling for lots/sales where reliable.
- Add portfolio history independent from net-worth snapshots.

## AI Provider

- Select a model vendor after privacy/security/contract review.
- Implement AIProvider with strict tool-catalog validation, minimal structured payloads, retention controls, budgets/timeouts, and fallback.
- Add adversarial evaluations for fabrication, prompt injection in merchant/provider text, cross-user leakage, unsupported periods, ambiguous questions, and action requests.
- Persist conversations only with direct user ownership, retention/deletion controls, and redacted tool provenance.

## Identity, Privacy, And Platform

- Replace process-local limits with a shared atomic service.
- Add passkeys/MFA, email verification, recovery, session/device management, revoke-all, and step-up authentication.
- Add user data export/deletion, consent records, retention enforcement, provider revocation, and backup-deletion policy.
- Configure managed secrets/KMS, field encryption for provider credentials and high-impact identifiers, TLS, encrypted backups, key rotation, restore exercises, and support access controls.
- Add safe metrics/tracing, audit alerts, incident response, dependency/SAST/secret/container/IaC scanning, and production browser checks.
- Replace the compatible inline CSP with nonce/hash enforcement.
- Remove the temporary deepmerge-ts override after Prisma ships and the patched dependency is audited directly.

## Actions And Regulated Capabilities

- Keep all execution out of the AI read registry.
- Persist proposals, policy decisions, confirmations, idempotency state, results, and immutable audit transitions in a separate trusted service.
- Add action-specific ownership, limits, step-up, expiry/replay defenses, provider reconciliation, support, and exception handling.
- Do not enable subscription cancellation without a vetted provider, capability truth, consumer disclosures, and operational escalation.
- Do not implement transfers, payments, savings movement, or brokerage orders before legal, regulatory, compliance, partner, security, fraud/risk, insurance, and operational approval.

## Product Billing

- If monetization is added, use hosted processor checkout/customer portal behind a product-billing adapter.
- Verify billing webhooks, use idempotency, and store only customer/subscription references and entitlements.
- Keep MoneyOS product billing completely separate from user financial-action providers and never store raw card data.
