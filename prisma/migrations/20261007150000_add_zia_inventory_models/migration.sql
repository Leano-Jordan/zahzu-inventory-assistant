-- Non-destructive additive migration for ZIA purchasing data.
-- IF NOT EXISTS keeps existing populated databases safe when these tables
-- were previously created outside Prisma migrations.

CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_shop_name_key"
ON "Supplier"("shop", "name");
CREATE INDEX IF NOT EXISTS "Supplier_shop_idx"
ON "Supplier"("shop");

CREATE TABLE IF NOT EXISTS "SupplierItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "inventoryItemGid" TEXT,
    "sku" TEXT,
    "unitCost" REAL,
    "leadTimeDays" INTEGER,
    "reorderPoint" INTEGER,
    "reorderQuantity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierItem_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierItem_supplierId_variantGid_key"
ON "SupplierItem"("supplierId", "variantGid");
CREATE INDEX IF NOT EXISTS "SupplierItem_shop_variantGid_idx"
ON "SupplierItem"("shop", "variantGid");

CREATE TABLE IF NOT EXISTS "ReorderRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "locationGid" TEXT NOT NULL,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "targetStock" INTEGER NOT NULL DEFAULT 0,
    "preferredSupplierId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReorderRule_preferredSupplierId_fkey"
      FOREIGN KEY ("preferredSupplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReorderRule_shop_variantGid_locationGid_key"
ON "ReorderRule"("shop", "variantGid", "locationGid");
CREATE INDEX IF NOT EXISTS "ReorderRule_shop_active_idx"
ON "ReorderRule"("shop", "active");

CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "orderedAt" DATETIME,
    "expectedAt" DATETIME,
    "receivedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_shop_number_key"
ON "PurchaseOrder"("shop", "number");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_shop_status_idx"
ON "PurchaseOrder"("shop", "status");

CREATE TABLE IF NOT EXISTS "PurchaseOrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "inventoryItemGid" TEXT,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "quantityOrdered" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "unitCost" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_purchaseOrderId_idx"
ON "PurchaseOrderLine"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_variantGid_idx"
ON "PurchaseOrderLine"("variantGid");

CREATE TABLE IF NOT EXISTS "InventoryAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "inventoryItemGid" TEXT,
    "locationGid" TEXT,
    "locationName" TEXT,
    "quantityBefore" INTEGER,
    "quantityAfter" INTEGER,
    "change" INTEGER,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actor" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "InventoryAudit_shop_variantGid_createdAt_idx"
ON "InventoryAudit"("shop", "variantGid", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryAudit_shop_locationGid_createdAt_idx"
ON "InventoryAudit"("shop", "locationGid", "createdAt");

CREATE TABLE IF NOT EXISTS "SyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "cursor" TEXT,
    "lastSyncedAt" DATETIME,
    "lastSuccessfulAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "SyncState_shop_resource_key"
ON "SyncState"("shop", "resource");
CREATE INDEX IF NOT EXISTS "SyncState_shop_idx"
ON "SyncState"("shop");
