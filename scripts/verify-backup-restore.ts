import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const RESTORE_DATABASE_PREFIX = "moneyos_restore_";

const REQUIRED_TABLES = [
  "_prisma_migrations",
  "AIConversation",
  "AIMessage",
  "Account",
  "AuditEvent",
  "Category",
  "FinancialConnection",
  "Goal",
  "GoalContribution",
  "Holding",
  "IncomeStream",
  "Insight",
  "InvestmentAccount",
  "InvestmentTransaction",
  "NetWorthSnapshot",
  "ProviderAccount",
  "RateLimitBucket",
  "RecurringTransaction",
  "Session",
  "SyncJob",
  "SyncRun",
  "Transaction",
  "UsageMetric",
  "User",
  "WebAuthnChallenge",
  "WebAuthnCredential",
] as const;

export interface DatabaseIntegrityManifest {
  tables: Record<string, number>;
  representativeDigest: string;
  failedMigrations: number;
}

interface CommandOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

function databaseIdentity(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  return `${url.hostname}:${url.port || "5432"}/${database}`;
}

function databaseName(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
}

export function assertDisposableRestoreTarget(input: {
  sourceDatabaseUrl?: string;
  restoreDatabaseUrl: string;
  confirmation: string;
}): void {
  const restoreUrl = new URL(input.restoreDatabaseUrl);
  if (!["postgres:", "postgresql:"].includes(restoreUrl.protocol)) {
    throw new Error("RESTORE_DATABASE_URL must be a PostgreSQL URL");
  }
  const restoreName = databaseName(input.restoreDatabaseUrl);
  if (!restoreName.startsWith(RESTORE_DATABASE_PREFIX)) {
    throw new Error(
      `Restore database name must start with ${RESTORE_DATABASE_PREFIX}`,
    );
  }
  const expectedConfirmation = databaseIdentity(input.restoreDatabaseUrl);
  if (input.confirmation !== expectedConfirmation) {
    throw new Error(
      `RESTORE_DATABASE_CONFIRM must exactly equal ${expectedConfirmation}`,
    );
  }
  if (
    input.sourceDatabaseUrl &&
    databaseIdentity(input.sourceDatabaseUrl) === expectedConfirmation
  ) {
    throw new Error("Backup source and restore target must be different databases");
  }
}

export function compareIntegrityManifests(
  expected: DatabaseIntegrityManifest,
  restored: DatabaseIntegrityManifest,
): void {
  if (restored.failedMigrations !== 0) {
    throw new Error("Restored database contains a failed or incomplete migration");
  }
  const expectedTables = Object.keys(expected.tables).sort();
  const restoredTables = Object.keys(restored.tables).sort();
  if (JSON.stringify(expectedTables) !== JSON.stringify(restoredTables)) {
    throw new Error("Restored backup has an incomplete table set");
  }
  for (const table of expectedTables) {
    if (expected.tables[table] !== restored.tables[table]) {
      throw new Error(`Restored backup row count differs for ${table}`);
    }
  }
  if (expected.representativeDigest !== restored.representativeDigest) {
    throw new Error("Restored backup failed representative data integrity checks");
  }
}

function postgresEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get("sslmode");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: databaseName(databaseUrl),
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };
}

async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const errors: Buffer[] = [];
    let capturedErrorBytes = 0;
    const maxErrorBytes = 64 * 1_024;
    child.stdout.resume();
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = maxErrorBytes - capturedErrorBytes;
      if (remaining <= 0) return;
      const captured = chunk.subarray(0, remaining);
      errors.push(captured);
      capturedErrorBytes += captured.length;
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(path.basename(command) + " exceeded its safety timeout"));
    }, options.timeoutMs ?? 5 * 60 * 1_000);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(errors).toString("utf8").trim();
      reject(
        new Error(
          `${path.basename(command)} failed${detail ? `: ${detail.slice(0, 500)}` : ""}`,
        ),
      );
    });
  });
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function tableNames(client: Client): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

async function assertRestoreTargetEmpty(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tables = await tableNames(client);
    if (tables.length > 0) {
      throw new Error(
        "Restore target is not empty; refusing to overwrite existing database objects",
      );
    }
  } finally {
    await client.end();
  }
}

async function representativeValues(client: Client): Promise<Record<string, string>> {
  const result = await client.query<{
    account_balance: string;
    transaction_amount: string;
    holding_value: string;
    pending_transactions: string;
    removed_transactions: string;
    encrypted_connections: string;
  }>(`
    SELECT
      COALESCE((SELECT SUM("balance")::text FROM "Account"), '0') AS account_balance,
      COALESCE((SELECT SUM("amount")::text FROM "Transaction"), '0') AS transaction_amount,
      COALESCE((SELECT SUM("currentValue")::text FROM "Holding"), '0') AS holding_value,
      (SELECT COUNT(*)::text FROM "Transaction" WHERE "isPending") AS pending_transactions,
      (SELECT COUNT(*)::text FROM "Transaction" WHERE "isRemoved") AS removed_transactions,
      (SELECT COUNT(*)::text FROM "FinancialConnection" WHERE "accessTokenEncrypted" IS NOT NULL) AS encrypted_connections
  `);
  return result.rows[0] ?? {
    account_balance: "0",
    transaction_amount: "0",
    holding_value: "0",
    pending_transactions: "0",
    removed_transactions: "0",
    encrypted_connections: "0",
  };
}

export async function inspectDatabaseIntegrity(
  databaseUrl: string,
): Promise<DatabaseIntegrityManifest> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const names = await tableNames(client);
    const missing = REQUIRED_TABLES.filter((table) => !names.includes(table));
    if (missing.length > 0) {
      throw new Error(`Database is missing required tables: ${missing.join(", ")}`);
    }
    const tables: Record<string, number> = {};
    for (const name of names) {
      const count = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(name)}`,
      );
      tables[name] = Number(count.rows[0]?.count ?? "0");
    }
    const failed = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
        FROM "_prisma_migrations"
       WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
    `);
    const representative = await representativeValues(client);
    return {
      tables,
      representativeDigest: createHash("sha256")
        .update(JSON.stringify(representative))
        .digest("hex"),
      failedMigrations: Number(failed.rows[0]?.count ?? "0"),
    };
  } finally {
    await client.end();
  }
}

async function verifyPrismaMigrationStatus(databaseUrl: string): Promise<void> {
  const prismaCli = path.join(
    process.cwd(),
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  await runCommand(process.execPath, [prismaCli, "migrate", "status"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

export async function verifyBackupRestore(input: {
  sourceDatabaseUrl: string;
  restoreDatabaseUrl: string;
  restoreDatabaseConfirmation: string;
  pgDumpBinary?: string;
  pgRestoreBinary?: string;
}): Promise<{ tableCount: number; rowCount: number }> {
  assertDisposableRestoreTarget({
    sourceDatabaseUrl: input.sourceDatabaseUrl,
    restoreDatabaseUrl: input.restoreDatabaseUrl,
    confirmation: input.restoreDatabaseConfirmation,
  });
  await assertRestoreTargetEmpty(input.restoreDatabaseUrl);

  const expected = await inspectDatabaseIntegrity(input.sourceDatabaseUrl);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "moneyos-restore-"));
  const backupPath = path.join(temporaryDirectory, "moneyos.dump");
  try {
    await runCommand(
      input.pgDumpBinary ?? process.env.PG_DUMP_BIN ?? "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--serializable-deferrable",
        `--file=${backupPath}`,
      ],
      { env: postgresEnvironment(input.sourceDatabaseUrl) },
    );
    if ((await stat(backupPath)).size < 1_024) {
      throw new Error("Backup artifact is unexpectedly small or incomplete");
    }
    const pgRestore =
      input.pgRestoreBinary ?? process.env.PG_RESTORE_BIN ?? "pg_restore";
    await runCommand(pgRestore, ["--list", backupPath], {
      env: postgresEnvironment(input.restoreDatabaseUrl),
    });
    await runCommand(
      pgRestore,
      [
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
        `--dbname=${databaseName(input.restoreDatabaseUrl)}`,
        backupPath,
      ],
      { env: postgresEnvironment(input.restoreDatabaseUrl) },
    );
    const restored = await inspectDatabaseIntegrity(input.restoreDatabaseUrl);
    compareIntegrityManifests(expected, restored);
    await verifyPrismaMigrationStatus(input.restoreDatabaseUrl);
    return {
      tableCount: Object.keys(restored.tables).length,
      rowCount: Object.values(restored.tables).reduce((sum, count) => sum + count, 0),
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const sourceDatabaseUrl =
    process.env.BACKUP_SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
  const restoreDatabaseUrl = process.env.RESTORE_DATABASE_URL;
  const restoreDatabaseConfirmation = process.env.RESTORE_DATABASE_CONFIRM;
  if (!sourceDatabaseUrl || !restoreDatabaseUrl || !restoreDatabaseConfirmation) {
    throw new Error(
      "BACKUP_SOURCE_DATABASE_URL (or DATABASE_URL), RESTORE_DATABASE_URL, and RESTORE_DATABASE_CONFIRM are required",
    );
  }
  const result = await verifyBackupRestore({
    sourceDatabaseUrl,
    restoreDatabaseUrl,
    restoreDatabaseConfirmation,
  });
  console.log(
    `Backup restore verified in an isolated database (${result.tableCount} tables, ${result.rowCount} rows).`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown restore failure";
    console.error(`Backup restore verification failed: ${message}`);
    process.exitCode = 1;
  });
}
