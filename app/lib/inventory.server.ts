type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type GraphqlBody = {
  data?: Record<string, unknown>;
  errors?: Array<{ message?: string }>;
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

export type InventoryHealthLevel = {
  inventoryItemGid: string;
  variantGid: string;
  productTitle: string;
  displayName: string;
  sku: string | null;
  locationGid: string;
  locationName: string;
  available: number;
  onHand: number | null;
  incoming: number | null;
  committed: number | null;
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
  }",
].join("\n");

const LOCATIONS_QUERY = [
  "#graphql
  query InventoryFoundationLocations($first: Int!, $after: String) {
    locations(first: $first, after: $after) {
      nodes {
        id
        name
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }",
].join("\n");

const INVENTORY_HEALTH_QUERY = [
  "#graphql
  query InventoryHealthVariants($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      nodes {
        id
        displayName
        sku
        inventoryItem {
          id
          tracked
          inventoryLevels(first: 250) {
            nodes {
              location {
                id
                name
              }
              quantities(names: ["available", "on_hand", "incoming", "committed"]) {
                name
                quantity
              }
            }
          }
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
  }",
].join("\n");

async function readGraphqlData(
  response: Response,
): Promise<Record<string, unknown>> {
  const body = (await response.json()) as GraphqlBody;

  if (!response.ok || body.errors?.length) {
    const message =
      body.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      `Shopify Admin API request failed with HTTP ${response.status}`;

    throw new Error(message);
  }

  if (!body.data) {
    throw new Error("Shopify Admin API returned no data.");
  }

  return body.data;
}

export async function loadInventoryFoundation(
  admin: AdminClient,
): Promise<InventoryFoundationData> {
  const variants: ProductVariantNode[] = [];
  let after: string | null = null;

  do {
    const data = await readGraphqlData(
      await admin.graphql(PRODUCT_VARIANTS_QUERY, {
        variables: {
          first: 250,
          after,
        },
      }),
    );

    const connection = data.productVariants as {
      nodes: ProductVariantNode[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };

    variants.push(...connection.nodes);
    after = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);

  const locations: Array<{ id: string; name: string }> = [];
  let locationAfter: string | null = null;

  do {
    const locationData = await readGraphqlData(
      await admin.graphql(LOCATIONS_QUERY, {
        variables: {
          first: 250,
          after: locationAfter,
        },
      }),
    );

    const connection = locationData.locations as {
      nodes: Array<{ id: string; name: string }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };

    locations.push(...connection.nodes);
    locationAfter = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (locationAfter);

  return {
    variants,
    locations,
  };
}

export async function loadInventoryHealth(
  admin: AdminClient,
): Promise<InventoryHealthLevel[]> {
  const levels: InventoryHealthLevel[] = [];
  let after: string | null = null;

  do {
    const data = await readGraphqlData(
      await admin.graphql(INVENTORY_HEALTH_QUERY, {
        variables: {
          first: 100,
          after,
        },
      }),
    );

    const connection = data.productVariants as {
      nodes: Array<{
        id: string;
        displayName: string;
        sku: string | null;
        product: { title: string };
        inventoryItem: {
          id: string;
          tracked: boolean;
          inventoryLevels: {
            nodes: Array<{
              location: { id: string; name: string };
              quantities: Array<{ name: string; quantity: number }>;
            }>;
          };
        } | null;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };

    for (const variant of connection.nodes) {
      if (!variant.inventoryItem?.tracked) continue;

      for (const level of variant.inventoryItem.inventoryLevels.nodes) {
        const quantity = (name: string) =>
          level.quantities.find((item) => item.name === name)?.quantity ?? 0;
        const optionalQuantity = (name: string) => {
          const item = level.quantities.find((entry) => entry.name === name);
          return item ? item.quantity : null;
        };

        levels.push({
          inventoryItemGid: variant.inventoryItem.id,
          variantGid: variant.id,
          productTitle: variant.product.title,
          displayName: variant.displayName,
          sku: variant.sku,
          locationGid: level.location.id,
          locationName: level.location.name,
          available: quantity("available"),
          onHand: optionalQuantity("on_hand"),
          incoming: optionalQuantity("incoming"),
          committed: optionalQuantity("committed"),
        });
      }
    }

    after = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);

  return levels;
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
