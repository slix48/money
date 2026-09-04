# MoneyOS Cost Architecture

Cost is an architectural constraint, after security and financial correctness. MoneyOS starts as one Next.js application, one PostgreSQL database, and one financial-data provider. It does not require Redis, Kafka, Elasticsearch, a separate analytics database, an always-running worker, or an LLM.

Vendor prices and allowances change. Confirm the linked vendor pages before committing to production. The formulas below are the durable planning model.

## Required Now

| Service | Purpose | Required | Current choice | Free/low-cost entry | Billing unit and growth driver | Cost control |
| --- | --- | --- | --- | --- | --- | --- |
| Application hosting | Next.js pages, APIs, webhooks, queue drain | Yes for hosted use | Vercel | Hobby is free but is for personal, non-commercial use. A startup should plan for an appropriate business plan. | Plan, function requests, CPU, memory duration, transfer, builds | One canonical project, spend alerts/hard limits, static assets/CDN, bounded handlers |
| PostgreSQL | Users, synchronized finance data, cursors, jobs, metrics | Yes outside demo mode | Provider-neutral PostgreSQL | Local PostgreSQL is free. Managed providers such as Neon or Supabase offer development tiers, with limits and weaker production guarantees. | Compute time, storage, transfer, backups, branches | One database, connection pooling, indexed tenant queries, no duplicate raw payload archive |
| Financial aggregation | Bank/card accounts and transactions; optional investments | Only for real connections | Plaid adapter | Sandbox is free. Plaid documents a limited Trial and pay-as-you-go entry, subject to region and approval. | Transactions and Investments are generally monthly subscription products per active Item; refresh endpoints may be per request | Webhooks plus incremental cursors, no page-load refresh, revoke disconnected Items, manual-refresh limits |
| Domain/auth/runtime | Accounting, recurring detection, assistant, sessions | Yes | MoneyOS TypeScript code | No external fee | Vercel/database usage only | Deterministic calculations, no external auth or AI service required |

Sources: [Vercel pricing](https://vercel.com/pricing), [Plaid billing](https://plaid.com/docs/account/billing/), [Neon pricing](https://neon.com/pricing), and [Supabase pricing](https://supabase.com/pricing). These links are authoritative; this file intentionally does not freeze their numeric prices.

## Optional Later

| Service | Purpose | Add only when | Main billing unit | Preferred control / alternative |
| --- | --- | --- | --- | --- |
| External AI provider | Natural-language planning and wording | Deterministic planner no longer meets measured answer-quality needs | Input/output tokens, cached tokens, tool calls | Route simple questions to cheaper models; send only compact tool results; hard per-user budgets; deterministic fallback |
| Market-data provider | Prices, security metadata, historical series | Plaid/institution values are insufficient and licensing is approved | Symbols, requests, delayed/real-time entitlements, redistribution | Batch symbols, central cache, delayed/end-of-day MVP, never fetch once per component |
| Dedicated job worker/queue | Longer or higher-volume synchronization | Serverless after-processing plus scheduled database queue drains miss latency/SLO targets | Runtime, operations, retained jobs | Keep the SyncJob contract; replace only the processor, not domain sync |
| KMS/HSM | Provider-token envelope key protection and rotation | Before production handling at material scale | Key versions, encrypt/decrypt operations | Cloud KMS/envelope encryption; cache only short-lived data keys server-side |
| Transactional email | Verification, recovery, security alerts | Identity flows require it | Messages/contacts | Send only necessary events; suppress duplicates; no financial details in email |
| Error/metrics vendor | On-call diagnostics | Lightweight database metrics are insufficient | Events, retention, seats, ingest GB | Sample operational events; exclude financial payloads; cap ingest and retention |
| Object storage | Exports/statements | User export or statement features ship | Stored GB, operations, transfer | Short retention, lifecycle deletion, client download limits |

Billing is explicitly out of scope in this run. A future hosted checkout provider is separate from users' financial accounts and actions.

## Current Cost Controls

- Dashboards read synchronized PostgreSQL records. Opening a page never calls Plaid.
- Verified provider webhooks enqueue cursor-based incremental sync.
- Manual refresh is tenant-checked, rate-limited, and deduplicated in PostgreSQL.
- Connected-mode abuse limits use small hashed PostgreSQL rows shared across instances; the queue drain prunes expired rows, avoiding Redis/KV spend.
- Sync pagination is bounded and cursor advancement is atomic.
- Provider call counts, sync durations, and changed-record counts are stored without financial payloads.
- Investment holdings/activity are fetched centrally and persisted once per sync, not per UI component.
- The assistant uses deterministic intent selection and 29 local read tools. Current AI token cost is zero.
- Tool results are bounded aggregates; an eventual LLM never needs provider payloads or a complete transaction history.
- The PostgreSQL SyncJob table is the initial durable queue. No always-running worker is required.
- Webhook verification keys are cached briefly; no duplicate key request is made for every webhook.
- No separate cache/database/search/streaming service is deployed.

## Cost Formulas

Use measured values from SyncRun and UsageMetric:

~~~text
monthly financial-data cost =
  active Plaid Items x applicable monthly product price
  + paid refresh calls x refresh price
  + other billable product events

monthly hosting cost =
  plan/seat base
  + function invocations above allowance
  + active CPU and provisioned memory above allowance
  + outbound transfer above allowance
  + build/observability add-ons

monthly PostgreSQL cost =
  compute units/hours
  + stored GB
  + backup/change-history GB
  + transfer above allowance

monthly AI cost =
  sum(request input tokens x model input rate)
  + sum(request output tokens x model output rate)
  + provider-specific tool/cache charges
~~~

Plaid notes that subscription products can remain billable while a valid Item token exists, even during an institution error. Successful user disconnect therefore calls provider revocation and removes the stored token.

## Scale Stages

### About 100 Users

- One canonical Vercel project.
- One small managed PostgreSQL database with pooling and backups appropriate to production.
- Plaid pay-as-you-go or approved Trial only if its terms and Item limits fit.
- Provider webhooks, after-processing, and a low-frequency protected queue drain.
- Deterministic assistant and institution-supplied delayed investment values.
- Review usage weekly; alert on active Items, refresh calls, database size, and Vercel spend.

The largest variable is usually active connected Items, not page views.

### About 1,000 Users

- Keep the same logical architecture.
- Size PostgreSQL from measured query latency, active connections, storage, and backup needs.
- Add database-side dashboard aggregates only for queries proven expensive.
- Review PostgreSQL rate-bucket write volume and cleanup; add managed KV only if measured database load justifies another service.
- Run the queue drain often enough for provider webhook latency goals; add a small worker only if serverless execution proves unreliable.
- Negotiate provider pricing only when measured Item volume makes a commitment cheaper than pay-as-you-go.
- External AI remains optional. Introduce it behind budgets and model routing, not as a calculator.

### About 10,000 Users

- Preserve one domain system and PostgreSQL unless evidence demands separation.
- Use a production database tier with tested point-in-time restore, read/query monitoring, and planned connection limits.
- Move queue consumption to durable managed execution if sync volume or duration exceeds serverless behavior.
- Partition or archive only after table/index measurements justify it.
- Precompute historical analytics and net-worth/insight summaries incrementally.
- Add centralized quote batching/cache if licensed market data is introduced.
- Require shared abuse controls, KMS-backed token encryption, on-call metrics, privacy automation, and vendor-volume contracts.

Do not infer that 10,000 users requires microservices. Connected-account count, transactions per Item, sync frequency, retention, and support obligations are the actual capacity inputs.

## Unexpected-Bill Checklist

- Configure Vercel spend alerts and a hard budget appropriate to uptime needs.
- Keep exactly one production Vercel project connected to this repository.
- Alert when active Plaid Item count differs materially from connected users.
- Revoke Items on disconnect; investigate long-lived errored Items.
- Do not call paid refresh endpoints from page renders or broad schedules.
- Bound webhook retries with idempotent event keys.
- Expire test database branches and sandbox fixtures.
- Track database growth per synchronized transaction, holding, and audit event.
- Do not enable verbose payload logging or high-cardinality observability.
- Require an explicit cost review before adding any external service.
