ALTER TABLE "InventoryAudit" ADD COLUMN "syncStatus" TEXT;
ALTER TABLE "InventoryAudit" ADD COLUMN "syncError" TEXT;
ALTER TABLE "InventoryAudit" ADD COLUMN "syncedAt" DATETIME;

CREATE INDEX IF NOT EXISTS "InventoryAudit_shop_syncStatus_createdAt_idx"
ON "InventoryAudit"("shop", "syncStatus", "createdAt");

CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

CREATE INDEX IF NOT EXISTS "Session_shop_idx" ON "Session"("shop");
