import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const migrationsPath = path.join(root, "prisma", "migrations");
const databaseUrl = process.env.DATABASE_URL;
const upgradeDatabaseUrl = process.env.UPGRADE_DATABASE_URL;

if (!databaseUrl || !upgradeDatabaseUrl) {
  throw new Error("DATABASE_URL and UPGRADE_DATABASE_URL are required");
}

function runPrisma(args, url, configPath) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, ...args, ...(configPath ? ["--config", configPath] : [])],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error("Prisma migration verification failed");
  }
}

runPrisma(["migrate", "deploy"], databaseUrl);
runPrisma(["migrate", "status"], databaseUrl);

const migrationDirectories = (await readdir(migrationsPath, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (migrationDirectories.length < 2) {
  throw new Error("At least two migrations are required for upgrade verification");
}

const temporaryRoot = path.join(root, `.tmp-prisma-${process.pid}`);
const temporaryMigrations = path.join(temporaryRoot, "migrations");
const temporaryConfig = path.join(temporaryRoot, "prisma.config.ts");

try {
  await mkdir(temporaryMigrations, { recursive: true });
  await cp(
    path.join(migrationsPath, "migration_lock.toml"),
    path.join(temporaryMigrations, "migration_lock.toml"),
  );
  for (const directory of migrationDirectories.slice(0, -1)) {
    await cp(
      path.join(migrationsPath, directory),
      path.join(temporaryMigrations, directory),
      { recursive: true },
    );
  }
  await writeFile(
    temporaryConfig,
    [
      'import { defineConfig } from "prisma/config";',
      "export default defineConfig({",
      `  schema: ${JSON.stringify(path.join(root, "prisma", "schema.prisma"))},`,
      `  migrations: { path: ${JSON.stringify(temporaryMigrations)} },`,
      "  datasource: { url: process.env.DATABASE_URL },",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  runPrisma(["migrate", "deploy"], upgradeDatabaseUrl, temporaryConfig);
  runPrisma(["migrate", "deploy"], upgradeDatabaseUrl);
  runPrisma(["migrate", "status"], upgradeDatabaseUrl);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
