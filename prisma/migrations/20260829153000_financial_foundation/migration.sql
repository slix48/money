ALTER TYPE "InvestmentTransactionType" ADD VALUE 'FEE';

CREATE TYPE "GoalContributionSource" AS ENUM ('MANUAL', 'TRANSFER', 'ACCOUNT_SYNC');

ALTER TABLE "Transaction"
  ADD COLUMN "rawMerchant" TEXT,
  ADD COLUMN "normalizedMerchant" TEXT,
  ADD COLUMN "rawDescription" TEXT,
  ADD COLUMN "incomeType" "IncomeType";

UPDATE "Transaction"
SET
  "rawMerchant" = "merchant",
  "rawDescription" = "description",
  "normalizedMerchant" = trim(
    regexp_replace(lower("merchant"), '[^a-z0-9]+', ' ', 'g')
  );

ALTER TABLE "RecurringTransaction"
  ADD COLUMN "averageAmount" DECIMAL(19,4);

UPDATE "RecurringTransaction"
SET "averageAmount" = "amount";

ALTER TABLE "InvestmentTransaction"
  ADD COLUMN "costBasis" DECIMAL(19,4),
  ADD COLUMN "realizedGain" DECIMAL(19,4);

ALTER TABLE "Goal"
  ADD COLUMN "notes" VARCHAR(1000);

CREATE TABLE "GoalContribution" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(19,4) NOT NULL,
  "source" "GoalContributionSource" NOT NULL DEFAULT 'MANUAL',
  "notes" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoalContribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Transaction_userId_normalizedMerchant_date_idx"
  ON "Transaction"("userId", "normalizedMerchant", "date");
CREATE INDEX "GoalContribution_userId_date_idx"
  ON "GoalContribution"("userId", "date" DESC);
CREATE INDEX "GoalContribution_goalId_date_idx"
  ON "GoalContribution"("goalId", "date" DESC);

ALTER TABLE "GoalContribution"
  ADD CONSTRAINT "GoalContribution_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoalContribution"
  ADD CONSTRAINT "GoalContribution_goalId_fkey"
  FOREIGN KEY ("goalId") REFERENCES "Goal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
