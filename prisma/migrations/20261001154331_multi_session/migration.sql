-- AlterTable
ALTER TABLE "UserSession" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing sessions with their current absolute expiry
UPDATE "UserSession" SET "tokenExpiresAt" = "expiresAt";
