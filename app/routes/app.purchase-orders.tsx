import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
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
    locations: foundation.locations,
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

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

async function createPurchaseOrderWithRetry(
  shop: string,
  data: Omit<Prisma.PurchaseOrderCreateArgs["data"], "shop" | "number">,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingNumbers = await prisma.purchaseOrder.findMany({
      where: { shop },
      select: { number: true },
    });
    const number = nextPurchaseOrderNumber(
      existingNumbers.map((item) => item.number),
    );

    try {
      return await prisma.purchaseOrder.create({
        data: {
          ...data,
          shop,
          number,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002" ||
        attempt === 2
      ) {
        throw error;
      }
    }
  }

  throw new Error("Could not allocate a purchase order number.");
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const supplierId = String(formData.get("supplierId") || "");
  const locationGid = String(formData.get("locationGid") || "");
  const variantGid = String(formData.get("variantGid") || "");
  const quantity = Number(formData.get("quantity") || 0);
  const unitCostValue = String(formData.get("unitCost") || "").trim();
  const unitCost = unitCostValue ? Number(unitCostValue) : null;
  const expectedAtValue = String(formData.get("expectedAt") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!supplierId || !variantGid || !locationGid || !Number.isSafeInteger(quantity) || quantity <= 0) {
    return { status: "error" as const, message: "Supplier, location, variant and a positive quantity are required." };
  }

  if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
    return { status: "error" as const, message: "Unit cost must be a valid non-negative amount." };
  }

  const foundation = await loadInventoryFoundation(admin);
  const location = foundation.locations.find((item) => item.id === locationGid);
  const variant = foundation.variants.find(
    (item) => item.id === variantGid && item.inventoryItem?.tracked,
  );

  if (!location) {
    return { status: "error" as const, message: "The selected Shopify location is no longer available." };
  }

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

  const expectedAt = expectedAtValue ? parseDateOnly(expectedAtValue) : null;
  if (expectedAtValue && !expectedAt) {
    return { status: "error" as const, message: "Expected date must be a valid calendar date." };
  }

  try {
    await createPurchaseOrderWithRetry(session.shop, {
      supplierId,
      status: "DRAFT",
      locationGid: location.id,
      locationName: location.name,
      expectedAt,
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
  const { orders, suppliers, variants, locations, saved } = useLoaderData<typeof loader>();
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
        <PurchaseOrderForm suppliers={suppliers} variants={variants} locations={locations} />
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
  locations: Array<{ id: string; name: string }>;
};

function PurchaseOrderForm({ suppliers, variants, locations }: PurchaseOrderFormProps) {
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
        <span>Receiving location</span>
        <select className="zia-input" name="locationGid" required>
          <option value="">Choose a location</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
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
