# MoneyOS

MoneyOS is a personal-finance intelligence and tracking application. It brings cash, spending, income, recurring charges, investments, goals, net worth, and grounded financial questions into one interface.

V1 is deliberately read-oriented. It does not move money, trade securities, cancel subscriptions, initiate payments, or provide autonomous financial advice.

## Included In This Build

- Premium responsive dashboard with light and dark themes
- User-scoped accounts, transactions, income streams, recurring charges, holdings, goals, snapshots, insights, and AI conversations
- Audited cash flow, net worth, portfolio allocation, contribution/return separation, goals, recurring detection, and period comparisons
- Correct handling of pending transactions, refunds, transfers, credit-card payments, and investment contributions
- Transaction search, filtering, sorting, detail editing, notes, categories, and recurring flags
- Cadence-aware recurring detection, subscription review controls, price-change annual impact, and attention ranking
- Editable income streams, goal contribution history/scenarios, portfolio performance methodology, Money Flow, financial health, and What Changed
- A 29-tool read-only financial AI registry with grounded calculation receipts and scenario tools
- Cursor-ready bank/brokerage, market-data, external-AI, cancellation, and financial-action provider boundaries
- PostgreSQL/Prisma plus a provider-backed in-memory demo path with several months of realistic activity
- Argon2id authentication, hashed opaque production sessions, canonical-origin checks, validation, rate limiting, route/repository IDOR tests, and same-tenant database constraints

## Quick Start: Demo Mode

Requirements: Node.js 24 and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Demo credentials:

```text
Email:    demo@moneyos.local
Password: moneyos-demo
```

Demo mode is the default and requires no database or third-party credentials. It uses realistic, clearly labeled mock financial and market data. Demo mutations are held in memory and reset when the development server restarts.

## PostgreSQL Mode

1. Start PostgreSQL. A local container definition is included:

```bash
docker compose up -d
```

2. Copy `.env.example` to `.env.local` and set:

```dotenv
DATABASE_URL="postgresql://moneyos:moneyos@localhost:5432/moneyos?schema=public"
SESSION_SECRET="replace-with-a-random-secret-of-at-least-32-characters"
APP_URL="http://localhost:3000"
DEMO_MODE="false"
```

3. Apply the schema, seed the development account, and run the app:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

The seed is idempotent and creates the same demo login shown above. Do not use the demo password outside local development.

## Vercel Demo Deployment

The mock-only demo can deploy without PostgreSQL. Set these project variables for a stable hosted deployment:

```dotenv
DEMO_MODE="true"
SESSION_SECRET="generate-a-random-secret-of-at-least-32-characters"
APP_URL="https://your-project.vercel.app"
```

Remove `DATABASE_URL` in demo mode. Blank or malformed optional values fail closed to the mock repository so a deployment cannot accidentally access real financial records. A built-in demo signing key keeps the public mock account usable when `SESSION_SECRET` is omitted, but an explicit random secret is strongly recommended for every persistent hosted deployment.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Generate Prisma Client and create a production build |
| `npm start` | Run the production build |
| `npm run check` | Run type checking, linting, and unit tests |
| `npm run test:coverage` | Run tests with coverage |
| `npm run test:visual` | Exercise routes and workflows in a headless installed browser |
| `npm run db:migrate` | Create/apply a Prisma development migration |
| `npm run db:seed` | Seed realistic development data |
| `npm run db:studio` | Open Prisma Studio |

`test:visual` expects the app at `http://127.0.0.1:3000`. Override it with `MONEYOS_URL`. On Windows it defaults to installed Microsoft Edge; set `PLAYWRIGHT_EXECUTABLE_PATH` elsewhere or provide an installed Chrome channel.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | When `DEMO_MODE=false` | PostgreSQL connection string; use TLS in production |
| `SESSION_SECRET` | PostgreSQL production | At least 32 characters; strongly recommended for hosted demo sessions |
| `APP_URL` | PostgreSQL production | Canonical same-origin URL used by security checks; Vercel deployments also derive it from `VERCEL_URL` |
| `DEMO_MODE` | No | `true` uses mock providers; `false` uses PostgreSQL |

Only server-side modules read these values. Never expose financial-provider, database, session, or AI credentials through `NEXT_PUBLIC_*` variables.

## Financial Semantics

Domain calculations use integer minor units (cents). PostgreSQL stores Decimal major-currency values and repository adapters perform the boundary conversion. Settled spending excludes pending charges, internal transfers, investment contributions, and credit-card payments. Refunds reduce spending before the final total is floored at zero. Income excludes transfers. Investment contributions and withdrawals remain separate from market gain/loss.

The assistant does not calculate by improvising prose. It selects an allowlisted read tool, receives a user-scoped structured result, and formats that result with calculation provenance.

## Project Guides

- [ARCHITECTURE.md](./ARCHITECTURE.md): boundaries, data flow, calculations, and provider design
- [SECURITY.md](./SECURITY.md): threat model, controls, assumptions, and production checklist
- [FINANCIAL_CALCULATIONS.md](./FINANCIAL_CALCULATIONS.md): exact accounting and performance methodology
- [AI_TOOLS.md](./AI_TOOLS.md): read-tool catalog, grounding, isolation, and future action flow
- [PROVIDERS.md](./PROVIDERS.md): real bank, brokerage, market, model, and action integration requirements
- [ROADMAP.md](./ROADMAP.md): phased product and regulatory path
- [TODO.md](./TODO.md): integrations that require credentials, infrastructure, or regulated partners

## V1 Limitations

Mock bank and market providers are development fixtures, not live feeds. The deterministic assistant is not an investment adviser and does not guarantee outcomes. Rate limiting is process-local and must move to a distributed store before multi-instance deployment. See `SECURITY.md` and `TODO.md` before treating this build as production-ready financial infrastructure.
