import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadInventoryFoundation } from "../lib/inventory.server";
import "./zia.css";

function optionalInt(value: FormDataEntryValue | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function optionalFloat(value: FormDataEntryValue | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const foundation = await loadInventoryFoundation(admin);

  try {
    const [suppliers, mappings] = await Promise.all([
      prisma.supplier.findMany({
        where: { shop: session.shop },
        orderBy: { name: "asc" },
      }),
      prisma.supplierItem.findMany({
        where: { shop: session.shop },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    return {
      variants: foundation.variants
        .filter((variant) => variant.inventoryItem?.tracked)
        .map((variant) => ({
          id: variant.id,
          label:
            variant.product.title === variant.displayName
              ? variant.product.title
              : `${variant.product.title} — ${variant.displayName}`,
          sku: variant.sku,
        })),
      suppliers,
      mappings,
      storageError: null,
    };
  } catch (error) {
    console.error("ZIA supplier mapping storage load failed", error);
    return {
      variants: foundation.variants
        .filter((variant) => variant.inventoryItem?.tracked)
        .map((variant) => ({
          id: variant.id,
          label:
            variant.product.title === variant.displayName
              ? variant.product.title
              : `${variant.product.title} — ${variant.displayName}`,
          sku: variant.sku,
        })),
      suppliers: [],
      mappings: [],
      storageError:
        "Supplier tables are not ready yet. Initialize the additive ZIA database migration before mapping items.",
    };
  }
};

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "create-supplier") {
      const name = String(formData.get("name") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const phone = String(formData.get("phone") || "").trim();
      const notes = String(formData.get("notes") || "").trim();

      if (!name) {
        return {
          status: "error" as const,
          message: "Supplier name is required.",
        };
      }

      await prisma.supplier.upsert({
        where: { shop_name: { shop: session.shop, name } },
        create: {
          shop: session.shop,
          name,
          email: email || null,
          phone: phone || null,
          notes: notes || null,
        },
        update: {
          email: email || null,
          phone: phone || null,
          notes: notes || null,
        },
      });

      return redirect("/app/suppliers?saved=1");
    }

    if (intent === "map-item") {
      const supplierId = String(formData.get("supplierId") || "");
      const variantGid = String(formData.get("variantGid") || "");
      const sku = String(formData.get("sku") || "").trim();
      const unitCostRaw = String(formData.get("unitCost") || "").trim();
      const leadTimeDaysRaw = String(formData.get("leadTimeDays") || "").trim();
      const reorderPointRaw = String(formData.get("reorderPoint") || "").trim();
      const reorderQuantityRaw = String(formData.get("reorderQuantity") || "").trim();
      const unitCost = optionalFloat(unitCostRaw);
      const leadTimeDays = optionalInt(leadTimeDaysRaw);
      const reorderPoint = optionalInt(reorderPointRaw);
      const reorderQuantity = optionalInt(reorderQuantityRaw);

      if (!supplierId || !variantGid) {
        return {
          status: "error" as const,
          message: "Supplier and tracked variant are required.",
        };
      }

      if (
        (unitCostRaw && unitCost === null) ||
        (leadTimeDaysRaw && leadTimeDays === null) ||
        (reorderPointRaw && reorderPoint === null) ||
        (reorderQuantityRaw && reorderQuantity === null)
      ) {
        return {
          status: "error" as const,
          message: "Optional cost and quantity fields must be valid non-negative numbers.",
        };
      }

      const foundation = await loadInventoryFoundation(admin);
      const variant = foundation.variants.find(
        (item) => item.id === variantGid && item.inventoryItem?.tracked,
      );

      if (!variant) {
        return {
          status: "error" as const,
          message: "The selected Shopify variant is not a tracked variant.",
        };
      }

      const supplier = await prisma.supplier.findFirst({
        where: { id: supplierId, shop: session.shop },
        select: { id: true },
      });

      if (!supplier) {
        return {
          status: "error" as const,
          message: "The selected supplier does not belong to this shop.",
        };
      }

      await prisma.supplierItem.upsert({
        where: {
          supplierId_variantGid: {
            supplierId,
            variantGid,
          },
        },
        create: {
          supplierId,
          shop: session.shop,
          variantGid,
          inventoryItemGid: variant.inventoryItem?.id ?? null,
          sku: sku || variant.sku || null,
          unitCost,
          leadTimeDays,
          reorderPoint,
          reorderQuantity,
        },
        update: {
          shop: session.shop,
          inventoryItemGid: variant.inventoryItem?.id ?? null,
          sku: sku || variant.sku || null,
          unitCost,
          leadTimeDays,
          reorderPoint,
          reorderQuantity,
          active: true,
        },
      });

      return redirect("/app/suppliers?saved=1");
    }

    return {
      status: "error" as const,
      message: "Unknown supplier action.",
    };
  } catch (error) {
    console.error("ZIA supplier action failed", error);
    return {
      status: "error" as const,
      message: "ZIA could not save that supplier change.",
    };
  }
}

export default function Suppliers() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Suppliers & Mapping">
      <s-button slot="primary-action" onClick={() => window.location.reload()}>
        Refresh
      </s-button>

      {actionData?.status === "error" ? (
        <div className="zia-banner zia-banner-error">{actionData.message}</div>
      ) : null}

      {data.storageError ? (
        <div className="zia-banner zia-banner-error">{data.storageError}</div>
      ) : null}

      <div className="zia-two-col">
        <s-section heading="Add supplier">
          <Form method="post" className="zia-form-stack">
            <input type="hidden" name="_intent" value="create-supplier" />
            <label className="zia-field">
              <span>Name</span>
              <input className="zia-input" name="name" required />
            </label>
            <label className="zia-field">
              <span>Email</span>
              <input className="zia-input" type="email" name="email" />
            </label>
            <label className="zia-field">
              <span>Phone</span>
              <input className="zia-input" name="phone" />
            </label>
            <label className="zia-field">
              <span>Notes</span>
              <textarea className="zia-input" name="notes" rows={3} />
            </label>
            <button className="zia-button" type="submit">Save supplier</button>
          </Form>
        </s-section>

        <s-section heading="Map a variant">
          <Form method="post" className="zia-form-stack">
            <input type="hidden" name="_intent" value="map-item" />
            <label className="zia-field">
              <span>Supplier</span>
              <select className="zia-input" name="supplierId" required>
                <option value="">Choose a supplier</option>
                {data.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="zia-field">
              <span>Variant</span>
              <select className="zia-input" name="variantGid" required>
                <option value="">Choose a tracked variant</option>
                {data.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label}{variant.sku ? ` — ${variant.sku}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="zia-form-grid zia-form-grid-2">
              <label className="zia-field">
                <span>Supplier SKU</span>
                <input className="zia-input" name="sku" />
              </label>
              <label className="zia-field">
                <span>Unit cost</span>
                <input className="zia-input" type="number" step="0.01" min="0" name="unitCost" />
              </label>
              <label className="zia-field">
                <span>Lead time (days)</span>
                <input className="zia-input" type="number" min="0" name="leadTimeDays" />
              </label>
              <label className="zia-field">
                <span>Reorder point</span>
                <input className="zia-input" type="number" min="0" name="reorderPoint" />
              </label>
              <label className="zia-field">
                <span>Reorder quantity</span>
                <input className="zia-input" type="number" min="0" name="reorderQuantity" />
              </label>
            </div>
            <button className="zia-button" type="submit">Save mapping</button>
          </Form>
        </s-section>
      </div>

      <s-section heading={`Supplier item mappings · ${data.mappings.length}`}>
        {data.mappings.length === 0 ? (
          <p className="zia-empty">No supplier mappings yet.</p>
        ) : (
          <div className="zia-table-wrap">
            <table className="zia-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Variant</th>
                  <th>Supplier SKU</th>
                  <th>Cost</th>
                  <th>Lead time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.mappings.map((mapping) => {
                  const variant = data.variants.find(
                    (item) => item.id === mapping.variantGid,
                  );
                  const supplier = data.suppliers.find(
                    (item) => item.id === mapping.supplierId,
                  );

                  return (
                    <tr key={mapping.id}>
                      <td>{supplier?.name || "—"}</td>
                      <td>
                        <div className="zia-product-title">
                          {variant?.label || mapping.variantGid}
                        </div>
                      </td>
                      <td>{mapping.sku || "—"}</td>
                      <td>
                        {mapping.unitCost === null
                          ? "—"
                          : mapping.unitCost.toFixed(2)}
                      </td>
                      <td>
                        {mapping.leadTimeDays === null
                          ? "—"
                          : `${mapping.leadTimeDays} days`}
                      </td>
                      <td>
                        <span
                          className={`zia-status ${
                            mapping.active
                              ? "zia-status-live"
                              : "zia-status-muted"
                          }`}
                        >
                          {mapping.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}
