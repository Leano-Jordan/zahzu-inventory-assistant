import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { NavLink, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <nav className="zia-nav" aria-label="ZIA navigation">
        <NavLink to="/app" end={to === "/app"}>{label}</NavLink>
        <NavLink to="/app/inventory-health" end={to === "/app"}>{label}</NavLink>
        <NavLink to="/app/reorder-rules" end={to === "/app"}>{label}</NavLink>
        <NavLink to="/app/suppliers" end={to === "/app"}>{label}</NavLink>
        <NavLink to="/app/purchase-orders" end={to === "/app"}>{label}</NavLink>
        <NavLink to="/app/receiving" end={to === "/app"}>{label}</NavLink>
        <NavLink to="/app/inventory-sync" end={to === "/app"}>{label}</NavLink>
      </nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
