import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = payload.current;
  if (!Array.isArray(current) || !current.every((scope) => typeof scope === "string")) {
    console.error("ZIA received an invalid scopes-update payload");
    return new Response("Invalid scopes payload", { status: 400 });
  }

  if (session) {
    await db.session.updateMany({
      where: { id: session.id, shop },
      data: { scope: current.join(",") },
    });
  }

  return new Response();
};
