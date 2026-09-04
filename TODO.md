# Integration TODOs

These depend on credentials, durable production infrastructure, vendors, or regulated partners. V1 intentionally does not fake them.

## Financial Data

- Obtain Plaid production approval/credentials and complete contract, pricing, privacy, security, and subprocessor review.
- Move the implemented versioned/lazy-rotation provider-token key ring to managed KMS envelope encryption and complete recovery procedures.
- Add queue/dead-letter operator views beyond the protected aggregate health endpoint, freshness alerts, reconciliation reports, and provider incident runbooks.
- Add consent records, user deletion, retention enforcement, scalable asynchronous exports, and verified provider-revocation operations.
- Evaluate transfer/card/refund reconciliation accuracy on de-identified production-like samples and add user correction workflows where missing.

## PostgreSQL And Scale

- Add paginated repository queries for long transaction and activity histories.
- Move dashboard/insight recomputation to background summaries as data grows.
- Validate least-privilege roles and row-level security with application, worker, migration, support, and restore workflows.
- Alert on the implemented queue backlog/lease health metrics and decide from measurements whether a dedicated worker is necessary.

## Market And Brokerage Data

- Select licensed quote/security-metadata sources and define delay/entitlement labels.
- Add symbol/security master mapping, corporate actions, splits, currencies/FX policy, historical prices, and reliable sector coverage.
- Validate Plaid read-only Investments coverage across supported institutions and reconcile positions, cash, fees, transfers, tax lots, and missing basis.
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

- Add passkeys/MFA, email verification, recovery, session/device inventory, and step-up authentication; revoke-all is implemented.
- Add user deletion, consent records, retention enforcement, provider revocation verification, backup-deletion policy, and asynchronous large-history export; immediate JSON export is implemented.
- Configure managed secrets/KMS envelope encryption, field encryption for high-impact identifiers, TLS, encrypted backups, key rotation, restore exercises, and support access controls.
- Add safe metrics/tracing, audit alerts, incident response, dependency/SAST/secret/container/IaC scanning, and production browser checks.
- Replace the compatible inline CSP with nonce/hash enforcement.
- Remove the temporary deepmerge-ts override after Prisma ships and the patched dependency is audited directly.
- Remove the temporary mysql2 override after Prisma pins a release containing the upstream authentication and decompression fixes.

## Actions And Regulated Capabilities

- Keep all execution out of the AI read registry.
- Persist proposals, policy decisions, confirmations, idempotency state, results, and immutable audit transitions in a separate trusted service.
- Add action-specific ownership, limits, step-up, expiry/replay defenses, provider reconciliation, support, and exception handling.
- Do not enable subscription cancellation without a vetted provider, capability truth, consumer disclosures, and operational escalation.
- Do not implement transfers, payments, savings movement, or brokerage orders before legal, regulatory, compliance, partner, security, fraud/risk, insurance, and operational approval.

## Deployment Operations

- In Vercel, confirm money is the canonical project, compare domains/environment variables/traffic, then manually disconnect or pause the duplicate money-o9u5 project.
- Configure the protected sync-drain schedule on only the canonical project and alert on queued/failed jobs.
- Add production browser coverage for Plaid Sandbox Link using provider fixtures where interactive automation is not available.
