import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import "./zia.css";

type PendingReceipt = {
  id: string;
  createdAt: string;
  purchaseOrderId: string | null;
  lineId: string | null;
  quantity: number;
  locationName: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const audits = await prisma.inventoryAudit.findMany({
    where: {
      shop: session.shop,
      reason: "PURCHASE_RECEIPT_RECORDED",
      source: "PURCHASE_ORDER",
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const pending: PendingReceipt[] = audits.flatMap((audit) => {
    if (!audit.metadata) return [];
    try {
      const metadata = JSON.parse(audit.metadata) as {
        purchaseOrderId?: string;
        lineId?: string;
        shopifyInventoryUpdate?: string;
      };
      if (metadata.shopifyInventoryUpdate !== "pending") return [];
      return [{
        id: audit.id,
        createdAt: audit.createdAt.toISOString(),
        purchaseOrderId: metadata.purchaseOrderId ?? null,
        lineId: metadata.lineId ?? null,
        quantity: audit.change ?? 0,
        locationName: audit.locationName ?? null,
      }];
    } catch {
      return [];
    }
  });

  const syncState = await prisma.syncState.findUnique({
    where: {
      shop_resource: {
        shop: session.shop,
        resource: "SHOPIFY_INVENTORY_RECEIPTS",
      },
    },
  });

  return {
    pending,
    syncState: syncState
      ? {
          lastSuccessfulAt: syncState.lastSuccessfulAt?.toISOString() ?? null,
          lastError: syncState.lastError,
          updatedAt: syncState.updatedAt.toISOString(),
        }
      : null,
  };
};

export default function InventorySync() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Inventory Sync">
      <s-button slot="primary-action" onClick={() => window.location.reload()}>
        Refresh
      </s-button>

      <div className="zia-grid">
        <div className="zia-card zia-card-alert">
          <span>Pending Shopify updates</span>
          <strong>{data.pending.length}</strong>
          <small>receipts recorded locally</small>
        </div>
        <div className="zia-card">
          <span>Sync state</span>
          <strong>{data.syncState?.lastError ? "Pending" : "Ready"}</strong>
          <small>Shopify remains the inventory source of truth</small>
        </div>
      </div>

      <s-section heading="Pending receipts">
        {data.pending.length === 0 ? (
          <p className="zia-empty">No local receipts are waiting for a Shopify inventory update.</p>
        ) : (
          <div className="zia-table-wrap">
            <table className="zia-table">
              <thead>
                <tr><th>Recorded</th><th>Purchase order</th><th>Location</th><th>Units</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.pending.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.purchaseOrderId || "—"}</td>
                    <td>{item.locationName || "—"}</td>
                    <td>{item.quantity}</td>
                    <td><span className="zia-status zia-status-alert">Pending Shopify update</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {data.syncState?.lastError ? (
        <s-section heading="Sync note">
          <p className="zia-banner zia-banner-error">{data.syncState.lastError}</p>
        </s-section>
      ) : null}
    </s-page>
  );
}
