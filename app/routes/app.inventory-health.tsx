import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadInventoryHealth } from "../lib/inventory.server";
import "./zia.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const levels = await loadInventoryHealth(admin);

  let rules: Array<{
    variantGid: string;
    locationGid: string;
    reorderPoint: number;
    targetStock: number;
    active: boolean;
    preferredSupplier: { name: string } | null;
  }> = [];

  try {
    rules = await prisma.reorderRule.findMany({
      where: { shop: session.shop },
      select: {
        variantGid: true,
        locationGid: true,
        reorderPoint: true,
        targetStock: true,
        active: true,
        preferredSupplier: { select: { name: true } },
      },
    });
  } catch (error) {
    console.error("ZIA inventory health rule load failed", error);
  }

  const ruleMap = new Map(
    rules.map((rule) => [
      `${rule.variantGid}::${rule.locationGid}`,
      rule,
    ]),
  );

  const items = levels.map((level) => {
    const rule = ruleMap.get(
      `${level.variantGid}::${level.locationGid}`,
    );
    const needsReorder =
      Boolean(rule?.active) && level.available <= (rule?.reorderPoint ?? 0);
    const outOfStock = level.available <= 0;
    const status = outOfStock
      ? "OUT"
      : needsReorder
        ? "REORDER"
        : rule
          ? "HEALTHY"
          : "UNCONFIGURED";

    return {
      ...level,
      status,
      reorderPoint: rule?.reorderPoint ?? null,
      targetStock: rule?.targetStock ?? null,
      suggestedQuantity:
        rule && rule.active
          ? Math.max(rule.targetStock - level.available, 0)
          : 0,
      supplierName: rule?.preferredSupplier?.name ?? null,
    };
  });

  const attention = items
    .filter((item) => item.status === "OUT" || item.status === "REORDER")
    .sort((a, b) => {
      const rank = { OUT: 0, REORDER: 1 };
      return (
        rank[a.status] - rank[b.status] ||
        a.available - b.available ||
        a.productTitle.localeCompare(b.productTitle)
      );
    })
    .slice(0, 50);

  return {
    items: attention,
    stats: {
      trackedLocations: items.length,
      outOfStock: items.filter((item) => item.status === "OUT").length,
      needsReorder: items.filter((item) => item.status === "REORDER").length,
      unconfigured: items.filter((item) => item.status === "UNCONFIGURED").length,
      healthy: items.filter((item) => item.status === "HEALTHY").length,
    },
  };
};

export default function InventoryHealth() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Inventory Health">
      <s-button slot="primary-action" onClick={() => window.location.reload()}>
        Refresh
      </s-button>

      <div className="zia-grid">
        <div className="zia-card zia-card-alert">
          <span>Out of stock</span>
          <strong>{data.stats.outOfStock}</strong>
          <small>tracked variant locations</small>
        </div>
        <div className="zia-card">
          <span>Needs reorder</span>
          <strong>{data.stats.needsReorder}</strong>
          <small>below active reorder points</small>
        </div>
        <div className="zia-card">
          <span>Unconfigured</span>
          <strong>{data.stats.unconfigured}</strong>
          <small>no active rule yet</small>
        </div>
        <div className="zia-card">
          <span>Healthy</span>
          <strong>{data.stats.healthy}</strong>
          <small>above configured thresholds</small>
        </div>
      </div>

      <s-section heading="Action queue">
        {data.items.length === 0 ? (
          <p className="zia-empty">
            No stock locations currently need attention.
          </p>
        ) : (
          <div className="zia-table-wrap">
            <table className="zia-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Location</th>
                  <th>Available</th>
                  <th>Reorder at</th>
                  <th>Suggested qty</th>
                  <th>Supplier</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={`${item.variantGid}::${item.locationGid}`}>
                    <td>
                      <div className="zia-product-title">{item.productTitle}</div>
                      <div className="zia-variant-name">
                        {item.displayName}{item.sku ? ` · ${item.sku}` : ""}
                      </div>
                    </td>
                    <td>{item.locationName}</td>
                    <td className={item.available <= 0 ? "zia-qty zia-qty-alert" : "zia-qty"}>
                      {item.available}
                    </td>
                    <td>{item.reorderPoint ?? "—"}</td>
                    <td>{item.suggestedQuantity || "—"}</td>
                    <td>{item.supplierName || "—"}</td>
                    <td>
                      <span
                        className={`zia-status ${
                          item.status === "OUT"
                            ? "zia-status-alert"
                            : "zia-status-live"
                        }`}
                      >
                        {item.status === "OUT" ? "Out of stock" : "Reorder"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}
