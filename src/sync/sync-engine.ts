import type {
  FinancialDataProvider,
  NormalizedProviderAccount,
  NormalizedProviderTransaction,
} from "@/providers/financial-data";
import type {
  ClassifiedProviderTransaction,
  PreviousTransactionForReconciliation,
} from "@/sync/normalization";
import { reconcileProviderTransactions } from "@/sync/normalization";

export type SyncTrigger = "INITIAL" | "WEBHOOK" | "MANUAL" | "SCHEDULED" | "RECONNECT";

export interface SyncConnection {
  id: string;
  userId: string;
  provider: "PLAID" | "MOCK";
  institutionName: string;
  accessToken: string;
  cursor?: string;
}

export interface SyncCommitInput {
  runId: string;
  connection: SyncConnection;
  trigger: SyncTrigger;
  cursor: string;
  syncedAt: Date;
  accounts: NormalizedProviderAccount[];
  addedTransactions: ClassifiedProviderTransaction[];
  modifiedTransactions: ClassifiedProviderTransaction[];
  removedExternalTransactionIds: string[];
  providerCalls: number;
  durationMs: number;
}

export interface SyncCommitResult {
  runId: string;
  accountsChanged: number;
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
}

export interface SyncStore {
  loadConnection(userId: string, connectionId: string): Promise<SyncConnection>;
  loadPreviousTransactions(
    userId: string,
    connectionId: string,
  ): Promise<PreviousTransactionForReconciliation[]>;
  beginSync(connection: SyncConnection, trigger: SyncTrigger): Promise<string>;
  commitSync(input: SyncCommitInput): Promise<SyncCommitResult>;
  failSync(input: {
    runId: string;
    connection: SyncConnection;
    durationMs: number;
    providerCalls: number;
    failure: SyncFailure;
  }): Promise<void>;
}

export type SyncFailureCategory =
  | "AUTHENTICATION"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMIT"
  | "SYNC_CONFLICT"
  | "INVALID_RESPONSE"
  | "CONFIGURATION"
  | "UNKNOWN";

export interface SyncFailure {
  category: SyncFailureCategory;
  safeCode: string;
  safeMessage: string;
  retriable: boolean;
}

export class FinancialSyncError extends Error {
  constructor(readonly failure: SyncFailure) {
    super(failure.safeMessage);
    this.name = "FinancialSyncError";
  }
}

export function providerErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const response = (error as { response?: { data?: unknown } }).response;
  if (!response?.data || typeof response.data !== "object") return undefined;
  const code = (response.data as { error_code?: unknown }).error_code;
  return typeof code === "string" ? code : undefined;
}

export function classifySyncFailure(error: unknown): SyncFailure {
  if (error instanceof FinancialSyncError) return error.failure;
  const code = providerErrorCode(error);
  if (["ITEM_LOGIN_REQUIRED", "USER_PERMISSION_REVOKED", "ACCESS_NOT_GRANTED"].includes(code ?? "")) {
    return { category: "AUTHENTICATION", safeCode: code!, safeMessage: "This institution needs to be reconnected.", retriable: false };
  }
  if (["INSTITUTION_DOWN", "INSTITUTION_NOT_RESPONDING", "INSTITUTION_NOT_AVAILABLE", "PRODUCT_NOT_READY"].includes(code ?? "")) {
    return { category: "PROVIDER_UNAVAILABLE", safeCode: code!, safeMessage: "This institution is temporarily unavailable.", retriable: true };
  }
  if (code === "RATE_LIMIT_EXCEEDED") {
    return { category: "RATE_LIMIT", safeCode: code, safeMessage: "The data provider asked MoneyOS to retry later.", retriable: true };
  }
  if (code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") {
    return { category: "SYNC_CONFLICT", safeCode: code, safeMessage: "Transaction updates changed during synchronization.", retriable: true };
  }
  if (error instanceof SyntaxError || error instanceof TypeError) {
    return { category: "INVALID_RESPONSE", safeCode: "INVALID_PROVIDER_RESPONSE", safeMessage: "The provider returned data MoneyOS could not safely process.", retriable: true };
  }
  if (error instanceof Error && error.message.includes("not configured")) {
    return { category: "CONFIGURATION", safeCode: "PROVIDER_NOT_CONFIGURED", safeMessage: "Connected accounts are not configured for this deployment.", retriable: false };
  }
  return { category: "UNKNOWN", safeCode: "SYNC_FAILED", safeMessage: "MoneyOS could not synchronize this connection.", retriable: true };
}

interface CollectedChanges {
  cursor: string;
  syncedAt: Date;
  accounts: NormalizedProviderAccount[];
  added: NormalizedProviderTransaction[];
  modified: NormalizedProviderTransaction[];
  removed: string[];
}

async function collectChanges(
  provider: FinancialDataProvider,
  connection: SyncConnection,
  recordProviderCall: () => void,
): Promise<CollectedChanges> {
  recordProviderCall();
  const accounts = await provider.getAccounts(
    connection.accessToken,
    connection.institutionName,
  );
  let cursor = connection.cursor;
  let syncedAt = new Date();
  let hasMore = true;
  const added = new Map<string, NormalizedProviderTransaction>();
  const modified = new Map<string, NormalizedProviderTransaction>();
  const removed = new Set<string>();
  let pageCount = 0;
  while (hasMore) {
    if (++pageCount > 100) {
      throw new FinancialSyncError({ category: "INVALID_RESPONSE", safeCode: "SYNC_PAGE_LIMIT", safeMessage: "The provider returned too many synchronization pages.", retriable: true });
    }
    recordProviderCall();
    const page = await provider.syncTransactions(
      { accessToken: connection.accessToken, cursor, pageSize: 500 },
      connection.institutionName,
    );
    cursor = page.cursor;
    syncedAt = page.syncedAt;
    hasMore = page.hasMore;
    for (const transaction of page.addedTransactions) {
      added.set(transaction.externalId, transaction);
      modified.delete(transaction.externalId);
      removed.delete(transaction.externalId);
    }
    for (const transaction of page.modifiedTransactions) {
      if (!added.has(transaction.externalId)) modified.set(transaction.externalId, transaction);
      removed.delete(transaction.externalId);
    }
    for (const externalId of page.removedExternalTransactionIds) {
      added.delete(externalId);
      modified.delete(externalId);
      removed.add(externalId);
    }
  }
  if (cursor === undefined) {
    throw new FinancialSyncError({ category: "INVALID_RESPONSE", safeCode: "MISSING_SYNC_CURSOR", safeMessage: "The provider did not return a synchronization cursor.", retriable: true });
  }
  return {
    cursor,
    syncedAt,
    accounts,
    added: [...added.values()],
    modified: [...modified.values()],
    removed: [...removed],
  };
}

export class FinancialSyncEngine {
  constructor(
    private readonly store: SyncStore,
    private readonly providerFor: (
      provider: SyncConnection["provider"],
    ) => Promise<FinancialDataProvider>,
  ) {}

  async sync(input: {
    userId: string;
    connectionId: string;
    trigger: SyncTrigger;
  }): Promise<SyncCommitResult> {
    const startedAt = Date.now();
    const connection = await this.store.loadConnection(input.userId, input.connectionId);
    const runId = await this.store.beginSync(connection, input.trigger);
    let providerCalls = 0;
    try {
      const provider = await this.providerFor(connection.provider);
      const recordProviderCall = () => {
        providerCalls += 1;
      };
      let changes: CollectedChanges;
      try {
        changes = await collectChanges(provider, connection, recordProviderCall);
      } catch (error) {
        if (providerErrorCode(error) !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") throw error;
        changes = await collectChanges(provider, connection, recordProviderCall);
      }
      const previous = await this.store.loadPreviousTransactions(
        connection.userId,
        connection.id,
      );
      const classified = reconcileProviderTransactions(
        [...changes.added, ...changes.modified],
        changes.accounts,
        previous,
      );
      const addedIds = new Set(changes.added.map((item) => item.externalId));
      return await this.store.commitSync({
        runId,
        connection,
        trigger: input.trigger,
        cursor: changes.cursor,
        syncedAt: changes.syncedAt,
        accounts: changes.accounts,
        addedTransactions: classified.filter((item) => addedIds.has(item.externalId)),
        modifiedTransactions: classified.filter((item) => !addedIds.has(item.externalId)),
        removedExternalTransactionIds: changes.removed,
        providerCalls,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const failure = classifySyncFailure(error);
      await this.store.failSync({
        runId,
        connection,
        durationMs: Date.now() - startedAt,
        providerCalls,
        failure,
      });
      throw new FinancialSyncError(failure);
    }
  }
}
