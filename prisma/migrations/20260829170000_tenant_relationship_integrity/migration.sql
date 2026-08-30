-- Make tenant ownership part of every relationship used by financial records.
-- The migration deliberately fails if pre-existing cross-tenant rows are found.

ALTER TABLE "AIMessage" ADD COLUMN "userId" TEXT;

UPDATE "AIMessage" AS message
SET "userId" = conversation."userId"
FROM "AIConversation" AS conversation
WHERE message."conversationId" = conversation."id";

ALTER TABLE "AIMessage" ALTER COLUMN "userId" SET NOT NULL;

CREATE UNIQUE INDEX "Account_id_userId_key" ON "Account"("id", "userId");
CREATE UNIQUE INDEX "Category_id_userId_key" ON "Category"("id", "userId");
CREATE UNIQUE INDEX "RecurringTransaction_id_userId_key"
  ON "RecurringTransaction"("id", "userId");
CREATE UNIQUE INDEX "InvestmentAccount_id_userId_key"
  ON "InvestmentAccount"("id", "userId");
CREATE UNIQUE INDEX "InvestmentAccount_accountId_userId_key"
  ON "InvestmentAccount"("accountId", "userId");
CREATE UNIQUE INDEX "Goal_id_userId_key" ON "Goal"("id", "userId");
CREATE UNIQUE INDEX "AIConversation_id_userId_key"
  ON "AIConversation"("id", "userId");
CREATE INDEX "AIMessage_userId_createdAt_idx"
  ON "AIMessage"("userId", "createdAt");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Transaction" child
    JOIN "Account" parent ON parent."id" = child."accountId"
    WHERE child."userId" <> parent."userId"
  ) OR EXISTS (
    SELECT 1
    FROM "GoalContribution" child
    JOIN "Goal" parent ON parent."id" = child."goalId"
    WHERE child."userId" <> parent."userId"
  ) OR EXISTS (
    SELECT 1
    FROM "Holding" child
    JOIN "InvestmentAccount" parent
      ON parent."id" = child."investmentAccountId"
    WHERE child."userId" <> parent."userId"
  ) OR EXISTS (
    SELECT 1
    FROM "InvestmentTransaction" child
    JOIN "InvestmentAccount" parent
      ON parent."id" = child."investmentAccountId"
    WHERE child."userId" <> parent."userId"
  ) THEN
    RAISE EXCEPTION 'Cross-tenant relationships must be repaired before migration';
  END IF;
END $$;

ALTER TABLE "Transaction"
  DROP CONSTRAINT "Transaction_accountId_fkey",
  DROP CONSTRAINT "Transaction_linkedAccountId_fkey",
  DROP CONSTRAINT "Transaction_categoryId_fkey",
  DROP CONSTRAINT "Transaction_recurringTransactionId_fkey";
ALTER TABLE "RecurringTransaction"
  DROP CONSTRAINT "RecurringTransaction_accountId_fkey",
  DROP CONSTRAINT "RecurringTransaction_categoryId_fkey";
ALTER TABLE "IncomeStream"
  DROP CONSTRAINT "IncomeStream_accountId_fkey";
ALTER TABLE "InvestmentAccount"
  DROP CONSTRAINT "InvestmentAccount_accountId_fkey";
ALTER TABLE "Holding"
  DROP CONSTRAINT "Holding_investmentAccountId_fkey";
ALTER TABLE "InvestmentTransaction"
  DROP CONSTRAINT "InvestmentTransaction_investmentAccountId_fkey";
ALTER TABLE "Goal"
  DROP CONSTRAINT "Goal_linkedAccountId_fkey";
ALTER TABLE "GoalContribution"
  DROP CONSTRAINT "GoalContribution_goalId_fkey";
ALTER TABLE "AIMessage"
  DROP CONSTRAINT "AIMessage_conversationId_fkey";

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_accountId_userId_fkey"
    FOREIGN KEY ("accountId", "userId")
    REFERENCES "Account"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Transaction_linkedAccountId_userId_fkey"
    FOREIGN KEY ("linkedAccountId", "userId")
    REFERENCES "Account"("id", "userId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Transaction_categoryId_userId_fkey"
    FOREIGN KEY ("categoryId", "userId")
    REFERENCES "Category"("id", "userId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Transaction_recurringTransactionId_userId_fkey"
    FOREIGN KEY ("recurringTransactionId", "userId")
    REFERENCES "RecurringTransaction"("id", "userId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecurringTransaction"
  ADD CONSTRAINT "RecurringTransaction_accountId_userId_fkey"
    FOREIGN KEY ("accountId", "userId")
    REFERENCES "Account"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RecurringTransaction_categoryId_userId_fkey"
    FOREIGN KEY ("categoryId", "userId")
    REFERENCES "Category"("id", "userId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IncomeStream"
  ADD CONSTRAINT "IncomeStream_accountId_userId_fkey"
    FOREIGN KEY ("accountId", "userId")
    REFERENCES "Account"("id", "userId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvestmentAccount"
  ADD CONSTRAINT "InvestmentAccount_accountId_userId_fkey"
    FOREIGN KEY ("accountId", "userId")
    REFERENCES "Account"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Holding"
  ADD CONSTRAINT "Holding_investmentAccountId_userId_fkey"
    FOREIGN KEY ("investmentAccountId", "userId")
    REFERENCES "InvestmentAccount"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvestmentTransaction"
  ADD CONSTRAINT "InvestmentTransaction_investmentAccountId_userId_fkey"
    FOREIGN KEY ("investmentAccountId", "userId")
    REFERENCES "InvestmentAccount"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Goal"
  ADD CONSTRAINT "Goal_linkedAccountId_userId_fkey"
    FOREIGN KEY ("linkedAccountId", "userId")
    REFERENCES "Account"("id", "userId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoalContribution"
  ADD CONSTRAINT "GoalContribution_goalId_userId_fkey"
    FOREIGN KEY ("goalId", "userId")
    REFERENCES "Goal"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AIMessage"
  ADD CONSTRAINT "AIMessage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AIMessage_conversationId_userId_fkey"
    FOREIGN KEY ("conversationId", "userId")
    REFERENCES "AIConversation"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE;
