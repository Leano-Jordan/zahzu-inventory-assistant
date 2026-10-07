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

function parseNonNegativeInt(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const editId = url.searchParams.get("edit");
  const foundation = await loadInventoryFoundation(admin);

  try {
    const [rules, suppliers] = await Promise.all([
      prisma.reorderRule.findMany({
        where: { shop: session.shop },
        orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
      }),
      prisma.supplier.findMany({
        where: { shop: session.shop },
        orderBy: { name: "asc" },
      }),
    ]);

    return {
      status: "ok" as const,
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
      locations: foundation.locations,
      rules,
      suppliers,
      selectedRule: editId
        ? rules.find((rule) => rule.id === editId) ?? null
        : null,
      saved: url.searchParams.get("saved") === "1",
    };
  } catch (error) {
    console.error("ZIA reorder rules storage load failed", error);
    return {
      status: "storage_error" as const,
      message:
        "ZIA could read Shopify inventory, but its local reorder-rule tables are not ready yet.",
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
      locations: foundation.locations,
      rules: [],
      suppliers: [],
      selectedRule: null,
      saved: false,
    };
  }
};

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const ruleId = String(formData.get("ruleId") || "");
  const variantGid = String(formData.get("variantGid") || "");
  const locationGid = String(formData.get("locationGid") || "");
  const reorderPoint = parseNonNegativeInt(formData.get("reorderPoint"));
  const targetStock = parseNonNegativeInt(formData.get("targetStock"));
  const preferredSupplierId = String(
    formData.get("preferredSupplierId") || "",
  );
  const active = formData.get("active") === "on";

  if (!variantGid || !locationGid || reorderPoint === null || targetStock === null) {
    return {
      status: "error" as const,
      message: "Variant, location, reorder point and target stock are required.",
    };
  }

  if (targetStock < reorderPoint) {
    return {
      status: "error" as const,
      message: "Target stock must be at least the reorder point.",
    };
  }

  try {
    const foundation = await loadInventoryFoundation(admin);
    const variantExists = foundation.variants.some(
      (variant) =>
        variant.id === variantGid && variant.inventoryItem?.tracked,
    );
    const locationExists = foundation.locations.some(
      (location) => location.id === locationGid,
    );

    if (!variantExists || !locationExists) {
      return {
        status: "error" as const,
        message:
          "The selected Shopify variant or location is no longer available.",
      };
    }

    const supplier = preferredSupplierId
      ? await prisma.supplier.findFirst({
          where: { id: preferredSupplierId, shop: session.shop },
          select: { id: true },
        })
      : null;

    if (preferredSupplierId && !supplier) {
      return {
        status: "error" as const,
        message: "The selected supplier does not belong to this shop.",
      };
    }

    if (ruleId) {
      const existing = await prisma.reorderRule.findFirst({
        where: { id: ruleId, shop: session.shop },
        select: { id: true },
      });

      if (!existing) {
        return {
          status: "error" as const,
          message: "The reorder rule could not be found.",
        };
      }

      const duplicate = await prisma.reorderRule.findFirst({
        where: {
          shop: session.shop,
          variantGid,
          locationGid,
          id: { not: ruleId },
        },
        select: { id: true },
      });

      if (duplicate) {
        return {
          status: "error" as const,
          message:
            "A reorder rule already exists for this variant and location.",
        };
      }

      await prisma.reorderRule.update({
        where: { id: ruleId },
        data: {
          variantGid,
          locationGid,
          reorderPoint,
          targetStock,
          preferredSupplierId: supplier?.id ?? null,
          active,
        },
      });
    } else {
      await prisma.reorderRule.upsert({
        where: {
          shop_variantGid_locationGid: {
            shop: session.shop,
            variantGid,
            locationGid,
          },
        },
        create: {
          shop: session.shop,
          variantGid,
          locationGid,
          reorderPoint,
          targetStock,
          preferredSupplierId: supplier?.id ?? null,
          active,
        },
        update: {
          reorderPoint,
          targetStock,
          preferredSupplierId: supplier?.id ?? null,
          active,
        },
      });
    }
  } catch (error) {
    console.error("ZIA reorder rule save failed", error);
    return {
      status: "error" as const,
      message:
        "ZIA could not save the reorder rule. Check that the local ZIA database tables are initialized.",
    };
  }

  return redirect("/app/reorder-rules?saved=1");
}

export default function ReorderRules() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Reorder Rules">
      <s-button slot="primary-action" onClick={() => window.location.reload()}>
        Refresh
      </s-button>

      {actionData?.status === "error" ? (
        <div className="zia-banner zia-banner-error">{actionData.message}</div>
      ) : null}

      {data.saved ? (
        <div className="zia-banner zia-banner-success">Reorder rule saved.</div>
      ) : null}

      {data.status === "storage_error" ? (
        <div className="zia-banner zia-banner-error">{data.message}</div>
      ) : null}

      <s-section heading={data.selectedRule ? "Edit reorder rule" : "Create reorder rule"}>
        <Form method="post" className="zia-form-grid">
          {data.selectedRule ? (
            <input type="hidden" name="ruleId" value={data.selectedRule.id} />
          ) : null}
          <label className="zia-field">
            <span>Variant</span>
            <select
              className="zia-input"
              name="variantGid"
              required
              defaultValue={data.selectedRule?.variantGid ?? ""}
            >
              <option value="">Choose a tracked variant</option>
              {data.variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.label}{variant.sku ? ` — ${variant.sku}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="zia-field">
            <span>Location</span>
            <select
              className="zia-input"
              name="locationGid"
              required
              defaultValue={data.selectedRule?.locationGid ?? ""}
            >
              <option value="">Choose a location</option>
              {data.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label className="zia-field">
            <span>Reorder point</span>
            <input
              className="zia-input"
              type="number"
              min="0"
              name="reorderPoint"
              defaultValue={String(data.selectedRule?.reorderPoint ?? 0)}
              required
            />
          </label>

          <label className="zia-field">
            <span>Target stock</span>
            <input
              className="zia-input"
              type="number"
              min="0"
              name="targetStock"
              defaultValue={String(data.selectedRule?.targetStock ?? 10)}
              required
            />
          </label>

          <label className="zia-field">
            <span>Preferred supplier</span>
            <select
              className="zia-input"
              name="preferredSupplierId"
              defaultValue={data.selectedRule?.preferredSupplierId ?? ""}
            >
              <option value="">No preferred supplier yet</option>
              {data.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>

          <label className="zia-check">
            <input
              type="checkbox"
              name="active"
              defaultChecked={data.selectedRule?.active ?? true}
            />
            <span>Rule active</span>
          </label>

          <div className="zia-actions">
            <button className="zia-button" type="submit">
              {data.selectedRule ? "Update rule" : "Save rule"}
            </button>
            {data.selectedRule ? (
              <s-link href="/app/reorder-rules">Cancel edit</s-link>
            ) : null}
          </div>
        </Form>
      </s-section>

      <s-section heading={`Configured rules · ${data.rules.length}`}>
        {data.rules.length === 0 ? (
          <p className="zia-empty">
            No reorder rules are configured yet. Add one above to turn stock
            levels into actionable reorder decisions.
          </p>
        ) : (
          <div className="zia-table-wrap">
            <table className="zia-table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Location</th>
                  <th>Reorder at</th>
                  <th>Target</th>
                  <th>Supplier</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((rule) => {
                  const variant = data.variants.find(
                    (item) => item.id === rule.variantGid,
                  );
                  const location = data.locations.find(
                    (item) => item.id === rule.locationGid,
                  );
                  const supplier = data.suppliers.find(
                    (item) => item.id === rule.preferredSupplierId,
                  );

                  return (
                    <tr key={rule.id}>
                      <td>
                        <div className="zia-product-title">
                          {variant?.label || rule.variantGid}
                        </div>
                        <div className="zia-variant-name">
                          {variant?.sku || "SKU not set"}
                        </div>
                      </td>
                      <td>{location?.name || rule.locationGid}</td>
                      <td>{rule.reorderPoint}</td>
                      <td>{rule.targetStock}</td>
                      <td>{supplier?.name || "—"}</td>
                      <td>
                        <span
                          className={`zia-status ${
                            rule.active
                              ? "zia-status-live"
                              : "zia-status-muted"
                          }`}
                        >
                          {rule.active ? "Active" : "Paused"}
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
