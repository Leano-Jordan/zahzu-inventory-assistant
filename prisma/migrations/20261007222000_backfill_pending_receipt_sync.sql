UPDATE "InventoryAudit"
SET "syncStatus" = 'PENDING'
WHERE "reason" = 'PURCHASE_RECEIPT_RECORDED'
  AND "source" = 'PURCHASE_ORDER'
  AND "syncStatus" IS NULL
  AND "metadata" LIKE '%"shopifyInventoryUpdate":"pending"%';
