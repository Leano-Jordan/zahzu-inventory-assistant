import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import "./zia.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const orders = await prisma.purchaseOrder.findMany({
    where: { shop: session.shop, status: { in: ["DRAFT", "ORDERED", "PARTIAL"] } },
    include: { supplier: true, lines: true },
    orderBy: { createdAt: "desc" },
  });
  return { orders, saved: new URL(request.url).searchParams.get("saved") === "1" };
};

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const data = await request.formData();
  const lineId = String(data.get("lineId") || "");
  const receivedNow = Number(data.get("receivedNow") || 0);

  if (!lineId || !Number.isInteger(receivedNow) || receivedNow <= 0) {
    return { status: "error" as const, message: "Enter a positive received quantity." };
  }

  try {
    const line = await prisma.purchaseOrderLine.findFirst({
      where: { id: lineId, purchaseOrder: { shop: session.shop } },
      include: { purchaseOrder: true },
    });
    if (!line) return { status: "error" as const, message: "The order line was not found." };

    const remaining = line.quantityOrdered - line.quantityReceived;
    if (receivedNow > remaining) {
      return { status: "error" as const, message: `Only ${remaining} units remain open on this line.` };
    }

    const newReceived = line.quantityReceived + receivedNow;
    const status = newReceived >= line.quantityOrdered ? "RECEIVED" : "PARTIAL";

    await prisma.$transaction([
      prisma.purchaseOrderLine.update({
        where: { id: line.id },
        data: { quantityReceived: newReceived },
      }),
      prisma.purchaseOrder.update({
        where: { id: line.purchaseOrderId },
        data: { status, receivedAt: status === "RECEIVED" ? new Date() : null },
      }),
      prisma.inventoryAudit.create({
        data: {
          shop: session.shop,
          variantGid: line.variantGid,
          inventoryItemGid: line.inventoryItemGid,
          change: receivedNow,
          reason: "PURCHASE_RECEIPT_RECORDED",
          source: "PURCHASE_ORDER",
          actor: session.email || session.shop,
          metadata: JSON.stringify({ purchaseOrderId: line.purchaseOrderId, lineId: line.id }),
        },
      }),
    ]);
  } catch (error) {
    console.error("ZIA receiving failed", error);
    return { status: "error" as const, message: "The receipt could not be recorded." };
  }

  return redirect("/app/receiving?saved=1");
}

export default function Receiving() {
  const { orders, saved } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Receiving">
      <s-button slot="primary-action" onClick={() => window.location.reload()}>Refresh</s-button>
      {actionData?.status === "error" ? <div className="zia-banner zia-banner-error">{actionData.message}</div> : null}
      {saved ? <div className="zia-banner zia-banner-success">Receipt recorded locally.</div> : null}
      <s-section heading={`Open purchase orders · ${orders.length}`}>
        {orders.length === 0 ? <p className="zia-empty">No open purchase orders need receiving.</p> : (
          <div className="zia-table-wrap">
            <table className="zia-table">
              <thead><tr><th>PO</th><th>Supplier</th><th>Item</th><th>Ordered</th><th>Received</th><th>Receive</th></tr></thead>
              <tbody>
                {orders.flatMap((order) =>
                  order.lines.filter((line) => line.quantityReceived < line.quantityOrdered).map((line) => (
                    <tr key={line.id}>
                      <td className="zia-product-title">{order.number}</td>
                      <td>{order.supplier.name}</td>
                      <td><div className="zia-product-title">{line.title}</div><div className="zia-variant-name">{line.sku || "SKU not set"}</div></td>
                      <td>{line.quantityOrdered}</td>
                      <td>{line.quantityReceived}</td>
                      <td>
                        <Form method="post" className="zia-inline-form">
                          <input type="hidden" name="lineId" value={line.id} />
                          <input className="zia-input zia-input-small" type="number" min="1" max={line.quantityOrdered - line.quantityReceived} name="receivedNow" defaultValue={line.quantityOrdered - line.quantityReceived} required />
                          <button className="zia-button" type="submit">Receive</button>
                        </Form>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}
