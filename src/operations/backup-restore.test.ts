import { describe, expect, it } from "vitest";
import {
  assertDisposableRestoreTarget,
  compareIntegrityManifests,
  type DatabaseIntegrityManifest,
} from "../../scripts/verify-backup-restore";

const source = "postgresql://user:secret@localhost:5432/moneyos";
const target =
  "postgresql://user:secret@localhost:5432/moneyos_restore_ci";

function manifest(overrides: Partial<DatabaseIntegrityManifest> = {}) {
  return {
    tables: { User: 2, Account: 4 },
    representativeDigest: "a".repeat(64),
    failedMigrations: 0,
    ...overrides,
  };
}

describe("backup restoration safety", () => {
  it("accepts only an explicitly confirmed disposable target", () => {
    expect(() =>
      assertDisposableRestoreTarget({
        sourceDatabaseUrl: source,
        restoreDatabaseUrl: target,
        confirmation: "localhost:5432/moneyos_restore_ci",
      }),
    ).not.toThrow();
  });

  it("refuses a production-shaped or unconfirmed restore target", () => {
    expect(() =>
      assertDisposableRestoreTarget({
        sourceDatabaseUrl: source,
        restoreDatabaseUrl: "postgresql://user:secret@localhost:5432/moneyos",
        confirmation: "localhost:5432/moneyos",
      }),
    ).toThrow("must start with moneyos_restore_");
    expect(() =>
      assertDisposableRestoreTarget({
        sourceDatabaseUrl: source,
        restoreDatabaseUrl: target,
        confirmation: "wrong-host/moneyos_restore_ci",
      }),
    ).toThrow("must exactly equal");
  });

  it("detects incomplete or corrupted restored data", () => {
    expect(() =>
      compareIntegrityManifests(manifest(), manifest({ tables: { User: 2 } })),
    ).toThrow("incomplete table set");
    expect(() =>
      compareIntegrityManifests(
        manifest(),
        manifest({ tables: { User: 1, Account: 4 } }),
      ),
    ).toThrow("row count differs");
    expect(() =>
      compareIntegrityManifests(
        manifest(),
        manifest({ representativeDigest: "b".repeat(64) }),
      ),
    ).toThrow("data integrity");
    expect(() =>
      compareIntegrityManifests(manifest(), manifest({ failedMigrations: 1 })),
    ).toThrow("failed or incomplete migration");
  });
});
