# Plug Audit Log

## 2026-10-07 — Main branch

Branch policy: **main only**. Repository currently reports only the `main` branch.

### Fixed in this audit cycle

- Hardened receiving for future multi-line purchase orders.
- Prevented concurrent receipt actions from over-receiving a PO line.
- Added explicit `InventoryAudit.syncStatus` / `syncError` / `syncedAt` fields.
- Backfilled legacy receipt audits into the explicit pending sync state.
- Added the Prisma SQLite migration lock.
- Added safe fresh-database creation for the Shopify `Session` table.
- Added the Session shop index.
- Fixed Docker dependency installation when no lockfile is tracked.
- Fixed Docker startup command execution.
- Replaced embedded-app raw anchor navigation with React Router navigation.
- Corrected misleading dashboard and purchase-order labels.
- Hardened reorder-rule numeric validation.
- Hardened supplier mapping numeric validation.
- Hardened purchase-order date validation.
- Added collision retrying for sequential purchase-order numbers.
- Hardened GraphQL pagination and throttling behavior.
- Reworked inventory-health querying around Shopify locations to avoid the previous deeply nested inventory query.
- Hardened scope-update webhook payload handling and session updates.

### Verified design boundaries

- Shopify remains the inventory source of truth.
- Receiving currently records a local receipt and queues it as `PENDING`; it does **not** claim that Shopify inventory was updated.
- Current app scopes remain read-only: `read_products, read_inventory, read_locations`.
- No extra Git branch was created.

### Open engineering risks

1. Shopify inventory write-back is still not active. Enabling it requires the appropriate write scope and a verified mutation implementation.
2. `application_url` and auth redirect URLs in `shopify.app.toml` are still deployment placeholders and require the real hosted URL.
3. The repository intentionally does not track a package lockfile, so installs are less reproducible than a locked production dependency set.
4. There is currently no dedicated automated unit/integration test suite for ZIA business workflows.
5. SQLite remains appropriate only for the single-instance deployment model described by the template; multi-instance production would require a shared database strategy.

### Current main

`1a66846fed7efcfa99c40e84a8479bb98e636001`

Next audit focus: verify the actual Shopify inventory write path and end-to-end sync state transitions without weakening the existing tenant/data-integrity controls.
