# Integration TODOs

These items depend on external credentials, production infrastructure, or regulated providers. They are intentionally not faked in V1.

## Financial Data

- Select and contract with an account-aggregation provider.
- Implement provider OAuth/Link, token exchange, encrypted credential storage, webhook verification, sync cursors, retry queues, and item-health UX.
- Normalize provider transactions while preserving source IDs and raw-payload retention policy.
- Build deterministic deduplication, pending-to-posted matching, transfer pairing, refund matching, and reconciliation monitoring.

## Market And Brokerage Data

- Select a licensed market-data source and define quote delay/entitlement labels.
- Add symbol/security master mapping, corporate actions, splits, multiple currencies, and price history.
- Define performance methodology, including time-weighted and money-weighted returns, before exposing performance claims.
- Integrate read-only brokerage positions and activity through the provider contracts.

## AI Provider

- Select an approved model vendor and execute privacy/security review and contractual data-use terms.
- Add a model adapter that can select only registered read tools and validate every tool call.
- Minimize and redact payloads, enforce budgets/timeouts, record safe provenance, and evaluate grounding failures.
- Add prompt-injection testing for merchant descriptions and imported provider text.

## Production Platform

- Remove the temporary `deepmerge-ts` security override after Prisma ships an audited release that includes the patched major directly.
- Move rate limiting and session abuse state to a shared atomic store.
- Add job queues for provider synchronization and insight recomputation.
- Add email verification, password recovery, MFA/passkeys, device/session management, and user data export/deletion.
- Configure TLS, managed secrets, database least privilege, encrypted backups, rotation, restore testing, monitoring, and incident response.
- Add CI dependency/SAST/secret scanning and production browser tests.

## Actions And Regulated Capabilities

- Do not implement transfer, payment, trade, cancellation, or account-change execution in the AI tool registry.
- Define a separate action service with explicit confirmation, step-up authentication, idempotency, limits, audit logs, and reconciliation.
- Complete legal, regulatory, compliance, partner, insurance, security, and operational reviews before enabling any action.
- Keep subscription cancellation unavailable until an approved provider and exception-handling process exist.
