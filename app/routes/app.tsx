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
        <NavLink to="/app" end>Overview</NavLink>
        <NavLink to="/app/inventory-health">Inventory Health</NavLink>
        <NavLink to="/app/reorder-rules">Reorder Rules</NavLink>
        <NavLink to="/app/suppliers">Suppliers</NavLink>
        <NavLink to="/app/purchase-orders">Purchase Orders</NavLink>
        <NavLink to="/app/receiving">Receiving</NavLink>
        <NavLink to="/app/inventory-sync">Inventory Sync</NavLink>
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
