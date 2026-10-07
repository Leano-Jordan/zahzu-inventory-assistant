import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadInventoryFoundation } from "../lib/inventory.server";
import "./zia.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const orders = await prisma.purchaseOrder.findMany({
    where: { shop: session.shop },
    include: { supplier: true, lines: true },
    orderBy: { createdAt: "desc" },
  });
  return { orders };
};

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const supplierId = String(formData.get("supplierId") || "");
  const variantGid = String(formData.get("variantGid") || "");
  const quantity = Number(formData.get("quantity") || 0);
  const unitCostValue = String(formData.get("unitCost") || "").trim();
  const unitCost = unitCostValue ? Number(unitCostValue) : null;
  const expectedAtValue = String(formData.get("expectedAt") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!supplierId || !variantGid || !Number.isInteger(quantity) || quantity <= 0) {
    return { status: "error" as const, message: "Supplier, variant and a positive quantity are required." };
  }
  if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
    return { status: "error" as const, message: "Unit cost must be a valid non-negative amount." };
  }

  const foundation = await loadInventoryFoundation(admin);
  const variant = foundation.variants.find((item) => item.id === variantGid && item.inventoryItem?.tracked);
  if (!variant) {
    return { status: "error" as const, message: "The selected variant is not tracked by Shopify." };
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, shop: session.shop },
    select: { id: true },
  });
  if (!supplier) {
    return { status: "error" as const, message: "The selected supplier does not belong to this shop." };
  }

  const count = await prisma.purchaseOrder.count({ where: { shop: session.shop } });
  const number = `PO-${String(count + 1).padStart(5, "0")}`;

  await prisma.purchaseOrder.create({
    data: {
      shop: session.shop,
      number,
      supplierId,
      status: "DRAFT",
      expectedAt: expectedAtValue ? new Date(`${expectedAtValue}T00:00:00.000Z`) : null,
      notes: notes || null,
      lines: {
        create: {
          variantGid,
          inventoryItemGid: variant.inventoryItem?.id ?? null,
          sku: variant.sku,
          title: variant.product.title === variant.displayName
            ? variant.product.title
            : `${variant.product.title} — ${variant.displayName}`,
          quantityOrdered: quantity,
          unitCost,
        },
      },
    },
  });

  return redirect("/app/purchase-orders?saved=1");
}

export default function PurchaseOrders() {
  const { orders } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Purchase Orders">
      <s-button slot="primary-action" onClick={() => window.location.reload()}>Refresh</s-button>

      {actionData?.status === "error" ? (
        <div className="zia-banner zia-banner-error">{actionData.message}</div>
      ) : null}

      <s-section heading="Create purchase order">
        <PurchaseOrderForm />
      </s-section>

      <s-section heading={`Purchase orders · ${orders.length}`}>
        {orders.length === 0 ? (
          <p className="zia-empty">No purchase orders yet.</p>
        ) : (
          <div className="zia-table-wrap">
            <table className="zia-table">
              <thead>
                <tr>
                  <th>PO</th><th>Supplier</th><th>Items</th><th>Status</th><th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="zia-product-title">{order.number}</td>
                    <td>{order.supplier.name}</td>
                    <td>{order.lines.reduce((sum, line) => sum + line.quantityOrdered, 0)}</td>
                    <td><span className="zia-status zia-status-live">{order.status}</span></td>
                    <td>{order.expectedAt ? order.expectedAt.toLocaleDateString() : "—"}</td>
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

function PurchaseOrderForm() {
  return (
    <Form method="post" className="zia-form-grid">
      <SupplierSelect />
      <VariantSelect />
      <label className="zia-field">
        <span>Quantity</span>
        <input className="zia-input" type="number" min="1" name="quantity" defaultValue="1" required />
      </label>
      <label className="zia-field">
        <span>Unit cost</span>
        <input className="zia-input" type="number" min="0" step="0.01" name="unitCost" />
      </label>
      <label className="zia-field">
        <span>Expected date</span>
        <input className="zia-input" type="date" name="expectedAt" />
      </label>
      <label className="zia-field">
        <span>Notes</span>
        <input className="zia-input" name="notes" />
      </label>
      <div className="zia-actions">
        <button className="zia-button" type="submit">Create draft PO</button>
      </div>
    </Form>
  );
}

function SupplierSelect() {
  const { suppliers } = useLoaderData<typeof loader>();
  return (
    <label className="zia-field">
      <span>Supplier</span>
      <select className="zia-input" name="supplierId" required>
        <option value="">Choose a supplier</option>
        {suppliersFallback(suppliers)}
      </select>
    </label>
  );
}

function VariantSelect() {
  return (
    <label className="zia-field">
      <span>Variant</span>
      <input className="zia-input" name="variantGid" placeholder="Shopify variant GID" required />
    </label>
  );
}

function suppliersFallback(suppliers: Array<{ id: string; name: string }>) {
  return suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>);
}
