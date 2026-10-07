import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { loadInventoryFoundation, summariseInventory } from "../lib/inventory.server";
import "./zia.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const data = await loadInventoryFoundation(admin);
    return { status: "ok" as const, summary: summariseInventory(data) };
  } catch (error) {
    console.error("ZIA inventory foundation load failed", error);
    return {
      status: "error" as const,
      message: "ZIA could not read the store inventory right now.",
    };
  }
};

export default function Index() {
  const result = useLoaderData<typeof loader>();

  return (
    <s-page heading="ZIA — Inventory Control">
      <s-button slot="primary-action" onClick={() => window.location.reload()}>
        Refresh
      </s-button>

      {result.status === "error" ? (
        <s-section heading="Inventory connection">
          <s-paragraph>{result.message}</s-paragraph>
        </s-section>
      ) : (
        <>
          <div className="zia-hero">
            <div>
              <div className="zia-eyebrow">INVENTORY CONTROL</div>
              <h1>Know what you have.</h1>
              <p>Live Shopify inventory visibility is the foundation for every reorder and purchasing decision in ZIA.</p>
            </div>
            <div className="zia-readonly">READ-ONLY FOUNDATION</div>
          </div>

          <div className="zia-grid">
            <div className="zia-card">
              <span>Tracked variants</span>
              <strong>{result.summary.trackedCount}</strong>
              <small>of {result.summary.variantCount} variants</small>
            </div>
            <div className="zia-card">
              <span>Available units</span>
              <strong>{result.summary.totalAvailable.toLocaleString()}</strong>
              <small>across tracked variants</small>
            </div>
            <div className="zia-card zia-card-alert">
              <span>Out of stock</span>
              <strong>{result.summary.outOfStockCount}</strong>
              <small>items at zero or below</small>
            </div>
            <div className="zia-card">
              <span>Locations</span>
              <strong>{result.summary.locationCount}</strong>
              <small>Shopify locations</small>
            </div>
          </div>

          <s-section heading="Items needing attention">
            <div className="zia-table-wrap">
              <table className="zia-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Available</th>
                  </tr>
                </thead>
                <tbody>
                  {result.summary.lowestStock.map((variant) => (
                    <tr key={variant.id}>
                      <td>
                        <div className="zia-product-title">{variant.product.title}</div>
                        <div className="zia-variant-name">{variant.displayName}</div>
                      </td>
                      <td>{variant.sku || "—"}</td>
                      <td className={variant.inventoryQuantity !== null && variant.inventoryQuantity <= 0 ? "zia-qty zia-qty-alert" : "zia-qty"}>
                        {variant.inventoryQuantity ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </s-section>

          <s-section heading="What comes next">
            <div className="zia-next-grid">
              <div><strong>1. Set reorder rules</strong><span>Define the stock level that should trigger a buying decision.</span></div>
              <div><strong>2. Add suppliers</strong><span>Connect Shopify variants to the suppliers that can replenish them.</span></div>
              <div><strong>3. Build the purchasing loop</strong><span>Turn approved suggestions into purchase orders and receiving records.</span></div>
            </div>
          </s-section>
        </>
      )}
    </s-page>
  );
}