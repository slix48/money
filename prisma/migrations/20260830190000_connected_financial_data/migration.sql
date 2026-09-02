-- CreateEnum
CREATE TYPE "FinancialConnectionProvider" AS ENUM ('PLAID', 'MOCK');

-- CreateEnum
CREATE TYPE "FinancialConnectionStatus" AS ENUM ('PENDING', 'INITIAL_SYNC', 'SYNCING', 'CONNECTED', 'NEEDS_ATTENTION', 'TEMPORARILY_UNAVAILABLE', 'DISCONNECTING', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('INITIAL', 'WEBHOOK', 'MANUAL', 'SCHEDULED', 'RECONNECT');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "UsageMetricCategory" AS ENUM ('AI', 'FINANCIAL_DATA', 'MARKET_DATA', 'SYNC');

-- CreateEnum
CREATE TYPE "AccountBalanceStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'STALE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConnectionStatus" ADD VALUE 'SYNCING';
ALTER TYPE "ConnectionStatus" ADD VALUE 'TEMPORARILY_UNAVAILABLE';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "balanceStatus" "AccountBalanceStatus" NOT NULL DEFAULT 'AVAILABLE';

-- DropIndex
DROP INDEX "Transaction_userId_source_externalId_key";

-- DropIndex
DROP INDEX "InvestmentTransaction_userId_externalId_key";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "authorizedDate" TIMESTAMP(3),
ADD COLUMN     "categoryOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "financialConnectionId" TEXT,
ADD COLUMN     "isRemoved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingExternalId" TEXT,
ADD COLUMN     "providerCategory" JSONB,
ADD COLUMN     "providerSyncedAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationConfidence" DECIMAL(5,4),
ADD COLUMN     "reconciliationReason" VARCHAR(120),
ADD COLUMN     "refundForTransactionId" TEXT,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "typeOverride" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "IncomeStream" ADD COLUMN     "normalizedPayer" TEXT;

-- AlterTable
ALTER TABLE "Holding" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "priceIsDelayed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "providerSecurityId" TEXT,
ALTER COLUMN "costBasis" DROP NOT NULL;

-- CreateTable
CREATE TABLE "FinancialConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "FinancialConnectionProvider" NOT NULL,
    "providerItemId" TEXT NOT NULL,
    "providerInstitutionId" TEXT,
    "institutionName" TEXT NOT NULL,
    "status" "FinancialConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "accessTokenEncrypted" TEXT,
    "tokenKeyVersion" INTEGER,
    "syncCursor" TEXT,
    "consentExpiresAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastInvestmentSyncAt" TIMESTAMP(3),
    "lastAttemptedSyncAt" TIMESTAMP(3),
    "errorCode" VARCHAR(80),
    "errorMessageSafe" VARCHAR(240),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financialConnectionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "officialName" TEXT,
    "subtype" TEXT,
    "maskLast4" VARCHAR(4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financialConnectionId" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "accountsChanged" INTEGER NOT NULL DEFAULT 0,
    "transactionsAdded" INTEGER NOT NULL DEFAULT 0,
    "transactionsModified" INTEGER NOT NULL DEFAULT 0,
    "transactionsRemoved" INTEGER NOT NULL DEFAULT 0,
    "holdingsChanged" INTEGER NOT NULL DEFAULT 0,
    "investmentActivityChanged" INTEGER NOT NULL DEFAULT 0,
    "providerCalls" INTEGER NOT NULL DEFAULT 0,
    "errorCategory" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financialConnectionId" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT NOT NULL,
    "includeInvestments" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorCategory" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMetric" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "category" "UsageMetricCategory" NOT NULL,
    "provider" VARCHAR(60) NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialConnection_userId_status_idx" ON "FinancialConnection"("userId", "status");

-- CreateIndex
CREATE INDEX "FinancialConnection_userId_updatedAt_idx" ON "FinancialConnection"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialConnection_provider_providerItemId_key" ON "FinancialConnection"("provider", "providerItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialConnection_id_userId_key" ON "FinancialConnection"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_accountId_key" ON "ProviderAccount"("accountId");

-- CreateIndex
CREATE INDEX "ProviderAccount_userId_financialConnectionId_idx" ON "ProviderAccount"("userId", "financialConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_financialConnectionId_providerAccountId_key" ON "ProviderAccount"("financialConnectionId", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_accountId_userId_key" ON "ProviderAccount"("accountId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_id_userId_key" ON "ProviderAccount"("id", "userId");

-- CreateIndex
CREATE INDEX "SyncRun_userId_startedAt_idx" ON "SyncRun"("userId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "SyncRun_financialConnectionId_startedAt_idx" ON "SyncRun"("financialConnectionId", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_dedupeKey_key" ON "SyncJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "SyncJob_status_availableAt_idx" ON "SyncJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "SyncJob_userId_createdAt_idx" ON "SyncJob"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SyncJob_financialConnectionId_status_idx" ON "SyncJob"("financialConnectionId", "status");

-- CreateIndex
CREATE INDEX "UsageMetric_day_category_idx" ON "UsageMetric"("day", "category");

-- CreateIndex
CREATE INDEX "UsageMetric_userId_day_idx" ON "UsageMetric"("userId", "day" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UsageMetric_userId_day_category_provider_operation_key" ON "UsageMetric"("userId", "day", "category", "provider", "operation");

-- CreateIndex
CREATE INDEX "Transaction_userId_isRemoved_date_idx" ON "Transaction"("userId", "isRemoved", "date" DESC);

-- CreateIndex
CREATE INDEX "Transaction_financialConnectionId_externalId_idx" ON "Transaction"("financialConnectionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_id_userId_key" ON "Transaction"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_financialConnectionId_externalId_key" ON "Transaction"("financialConnectionId", "externalId");

-- CreateIndex
CREATE INDEX "IncomeStream_userId_normalizedPayer_idx" ON "IncomeStream"("userId", "normalizedPayer");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_investmentAccountId_providerSecurityId_key" ON "Holding"("investmentAccountId", "providerSecurityId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentTransaction_investmentAccountId_externalId_key" ON "InvestmentTransaction"("investmentAccountId", "externalId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_financialConnectionId_userId_fkey" FOREIGN KEY ("financialConnectionId", "userId") REFERENCES "FinancialConnection"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_refundForTransactionId_userId_fkey" FOREIGN KEY ("refundForTransactionId", "userId") REFERENCES "Transaction"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialConnection" ADD CONSTRAINT "FinancialConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_financialConnectionId_userId_fkey" FOREIGN KEY ("financialConnectionId", "userId") REFERENCES "FinancialConnection"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_accountId_userId_fkey" FOREIGN KEY ("accountId", "userId") REFERENCES "Account"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_financialConnectionId_userId_fkey" FOREIGN KEY ("financialConnectionId", "userId") REFERENCES "FinancialConnection"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_financialConnectionId_userId_fkey" FOREIGN KEY ("financialConnectionId", "userId") REFERENCES "FinancialConnection"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMetric" ADD CONSTRAINT "UsageMetric_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
