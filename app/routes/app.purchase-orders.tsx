import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadInventoryFoundation } from "../lib/inventory.server";
import "./zia.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [orders, suppliers, foundation] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { shop: session.shop },
      include: { supplier: true, lines: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplier.findMany({
      where: { shop: session.shop },
      orderBy: { name: "asc" },
    }),
    loadInventoryFoundation(admin),
  ]);

  return {
    orders,
    suppliers,
    variants: foundation.variants
      .filter((variant) => variant.inventoryItem?.tracked)
      .map((variant) => ({
        id: variant.id,
        inventoryItemGid: variant.inventoryItem?.id ?? null,
        label:
          variant.product.title === variant.displayName
            ? variant.product.title
            : `${variant.product.title} — ${variant.displayName}`,
        sku: variant.sku,
      })),
    saved: new URL(request.url).searchParams.get("saved") === "1",
  };
};

function nextPurchaseOrderNumber(numbers: string[]) {
  const highest = numbers.reduce((max, number) => {
    const match = /^PO-(\d+)$/.exec(number);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `PO-${String(highest + 1).padStart(5, "0")}`;
}

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
  const variant = foundation.variants.find(
    (item) => item.id === variantGid && item.inventoryItem?.tracked,
  );

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

  const existingNumbers = await prisma.purchaseOrder.findMany({
    where: { shop: session.shop },
    select: { number: true },
  });
  const number = nextPurchaseOrderNumber(existingNumbers.map((item) => item.number));

  try {
    await prisma.purchaseOrder.create({
      data: {
        shop: session.shop,
        number,
        supplierId,
        status: "DRAFT",
        expectedAt: expectedAtValue
          ? new Date(`${expectedAtValue}T00:00:00.000Z`)
          : null,
        notes: notes || null,
        lines: {
          create: {
            variantGid,
            inventoryItemGid: variant.inventoryItem?.id ?? null,
            sku: variant.sku,
            title:
              variant.product.title === variant.displayName
                ? variant.product.title
                : `${variant.product.title} — ${variant.displayName}`,
            quantityOrdered: quantity,
            unitCost,
          },
        },
      },
    });
  } catch (error) {
    console.error("ZIA purchase order creation failed", error);
    return {
      status: "error" as const,
      message: "The purchase order could not be created. Please retry.",
    };
  }

  return redirect("/app/purchase-orders?saved=1");
}

export default function PurchaseOrders() {
  const { orders, suppliers, variants, saved } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Purchase Orders">
      <s-button slot="primary-action" onClick={() => window.location.reload()}>Refresh</s-button>

      {actionData?.status === "error" ? (
        <div className="zia-banner zia-banner-error">{actionData.message}</div>
      ) : null}

      {saved ? (
        <div className="zia-banner zia-banner-success">Draft purchase order created.</div>
      ) : null}

      <s-section heading="Create purchase order">
        <PurchaseOrderForm suppliers={suppliers} variants={variants} />
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

type PurchaseOrderFormProps = {
  suppliers: Array<{ id: string; name: string }>;
  variants: Array<{ id: string; label: string; sku: string | null }>;
};

function PurchaseOrderForm({ suppliers, variants }: PurchaseOrderFormProps) {
  return (
    <Form method="post" className="zia-form-grid">
      <label className="zia-field">
        <span>Supplier</span>
        <select className="zia-input" name="supplierId" required>
          <option value="">Choose a supplier</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
          ))}
        </select>
      </label>

      <label className="zia-field">
        <span>Tracked variant</span>
        <select className="zia-input" name="variantGid" required>
          <option value="">Choose a tracked variant</option>
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.label}{variant.sku ? ` — ${variant.sku}` : ""}
            </option>
          ))}
        </select>
      </label>

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
