import { env } from "../src/lib/env";

if (env.NODE_ENV !== "production" || env.demoMode) {
  throw new Error(
    "Production environment verification requires NODE_ENV=production and DEMO_MODE=false",
  );
}
if (!env.DATABASE_URL || !env.SESSION_SECRET) {
  throw new Error("PostgreSQL and session configuration are required");
}

process.stdout.write(
  `Production environment is valid: PostgreSQL enabled; Plaid ${env.plaidConfigured ? "enabled" : "disabled"}; token key ring ${env.providerTokenKeyring ? `v${env.providerTokenKeyring.currentVersion}` : "not configured"}.\n`,
);
