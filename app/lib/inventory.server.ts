type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ProductVariantNode = {
  id: string;
  displayName: string;
  sku: string | null;
  inventoryQuantity: number | null;
  inventoryItem: {
    id: string;
    tracked: boolean;
  } | null;
  product: {
    title: string;
  };
};

export type InventoryFoundationData = {
  variants: ProductVariantNode[];
  locations: Array<{ id: string; name: string }>;
};

const PRODUCT_VARIANTS_QUERY = [
  "#graphql
  query InventoryFoundationVariants($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      nodes {
        id
        displayName
        sku
        inventoryQuantity
        inventoryItem {
          id
          tracked
        }
        product {
          title
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
].join("\n");

const LOCATIONS_QUERY = [
  "#graphql
  query InventoryFoundationLocations {
    locations(first: 100) {
      nodes {
        id
        name
      }
    }
  }
].join("\n");

async function readGraphqlJson(response: Response): Promise<Record<string, any>> {
  const body = await response.json();

  if (!response.ok || body.errors?.length) {
    const message =
      body.errors?.map((error: { message?: string }) => error.message).join("; ") ||
      `Shopify Admin API request failed with HTTP ${response.status}`;

    throw new Error(message);
  }

  return body.data;
}

export async function loadInventoryFoundation(
  admin: AdminClient,
): Promise<InventoryFoundationData> {
  const variants: ProductVariantNode[] = [];
  let after: string | null = null;

  do {
    const data = await readGraphqlJson(
      await admin.graphql(PRODUCT_VARIANTS_QUERY, {
        variables: {
          first: 250,
          after,
        },
      }),
    );

    variants.push(...(data.productVariants.nodes as ProductVariantNode[]));

    const pageInfo = data.productVariants.pageInfo as {
      hasNextPage: boolean;
      endCursor: string | null;
    };

    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (after);

  const locationData = await readGraphqlJson(
    await admin.graphql(LOCATIONS_QUERY),
  );

  return {
    variants,
    locations: locationData.locations.nodes,
  };
}

export function summariseInventory(data: InventoryFoundationData) {
  const tracked = data.variants.filter(
    (variant) => variant.inventoryItem?.tracked,
  );

  const outOfStock = tracked.filter(
    (variant) => (variant.inventoryQuantity ?? 0) <= 0,
  );

  const totalAvailable = tracked.reduce(
    (total, variant) => total + (variant.inventoryQuantity ?? 0),
    0,
  );

  const lowestStock = [...tracked]
    .sort(
      (a, b) =>
        (a.inventoryQuantity ?? 0) - (b.inventoryQuantity ?? 0),
    )
    .slice(0, 12);

  return {
    variantCount: data.variants.length,
    trackedCount: tracked.length,
    outOfStockCount: outOfStock.length,
    totalAvailable,
    locationCount: data.locations.length,
    lowestStock,
  };
}