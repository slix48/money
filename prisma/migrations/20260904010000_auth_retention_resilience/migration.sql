-- Passkey ceremonies and credentials are tenant-owned and cascade with the user.
CREATE TYPE "WebAuthnChallengePurpose" AS ENUM ('REGISTRATION', 'AUTHENTICATION');

ALTER TABLE "User"
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);

ALTER TABLE "Session"
  ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);

ALTER TABLE "FinancialConnection"
  ADD COLUMN "tokenEncryptionScheme" VARCHAR(32) NOT NULL DEFAULT 'LOCAL_AES_GCM';

ALTER TABLE "SyncJob"
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Session_id_userId_key" ON "Session"("id", "userId");

CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] NOT NULL,
    "credentialDeviceType" VARCHAR(20) NOT NULL,
    "credentialBackedUp" BOOLEAN NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "tokenHash" VARCHAR(64) NOT NULL,
    "challenge" VARCHAR(512) NOT NULL,
    "purpose" "WebAuthnChallengePurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key"
  ON "WebAuthnCredential"("credentialId");
CREATE UNIQUE INDEX "WebAuthnCredential_id_userId_key"
  ON "WebAuthnCredential"("id", "userId");
CREATE INDEX "WebAuthnCredential_userId_createdAt_idx"
  ON "WebAuthnCredential"("userId", "createdAt");
CREATE UNIQUE INDEX "WebAuthnChallenge_tokenHash_key"
  ON "WebAuthnChallenge"("tokenHash");
CREATE INDEX "WebAuthnChallenge_userId_purpose_expiresAt_idx"
  ON "WebAuthnChallenge"("userId", "purpose", "expiresAt");
CREATE INDEX "WebAuthnChallenge_expiresAt_idx"
  ON "WebAuthnChallenge"("expiresAt");

ALTER TABLE "WebAuthnCredential"
  ADD CONSTRAINT "WebAuthnCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebAuthnChallenge"
  ADD CONSTRAINT "WebAuthnChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WebAuthnChallenge_sessionId_userId_fkey"
  FOREIGN KEY ("sessionId", "userId") REFERENCES "Session"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Prevent two serverless workers from synchronizing one connection concurrently.
-- Preserve the newest active run and close any older duplicates before enforcing it.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "financialConnectionId"
           ORDER BY "startedAt" DESC, "id" DESC
         ) AS position
    FROM "SyncRun"
   WHERE "status" = 'RUNNING'
)
UPDATE "SyncRun"
   SET "status" = 'FAILED',
       "finishedAt" = COALESCE("finishedAt", CURRENT_TIMESTAMP),
       "errorCategory" = COALESCE("errorCategory", 'SUPERSEDED_RUN')
 WHERE "id" IN (SELECT "id" FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX "SyncRun_one_running_connection_idx"
  ON "SyncRun"("financialConnectionId")
  WHERE "status" = 'RUNNING';
