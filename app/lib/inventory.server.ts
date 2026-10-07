type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type GraphqlBody = {
  data?: Record<string, unknown>;
  errors?: Array<{
    message?: string;
    extensions?: { code?: string };
  }>;
};

const GRAPHQL_MAX_RETRIES = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

const PRODUCT_VARIANTS_QUERY = String.raw`
#graphql
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
}`;


const LOCATIONS_QUERY = String.raw`
#graphql
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
}`;


const INVENTORY_HEALTH_BY_LOCATION_QUERY = String.raw`
#graphql
query InventoryHealthVariantsByLocation(
  $first: Int!
  $after: String
  $query: String!
  $locationId: ID!
) {
  productVariants(first: $first, after: $after, query: $query) {
    nodes {
      id
      displayName
      sku
      inventoryItem {
        id
        tracked
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available", "on_hand", "incoming", "committed"]) {
            name
            quantity
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
}`;


type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type VariantsPage = {
  productVariants: {
    nodes: ProductVariantNode[];
    pageInfo: PageInfo;
  };
};

type LocationsPage = {
  locations: {
    nodes: Array<{ id: string; name: string }>;
    pageInfo: PageInfo;
  };
};

type InventoryHealthNode = {
  id: string;
  displayName: string;
  sku: string | null;
  inventoryItem: {
    id: string;
    tracked: boolean;
    inventoryLevel: {
      quantities: Array<{ name: string; quantity: number }>;
    } | null;
  } | null;
  product: { title: string };
};

type InventoryHealthPage = {
  productVariants: {
    nodes: InventoryHealthNode[];
    pageInfo: PageInfo;
  };
};

async function graphqlRequest<T>(
  admin: AdminClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt <= GRAPHQL_MAX_RETRIES; attempt += 1) {
    const response = await admin.graphql(query, { variables });
    const body = (await response.json()) as GraphqlBody & { data?: T };
    const throttled =
      response.status === 429 ||
      body.errors?.some(
        (error) =>
          error.extensions?.code === "THROTTLED" ||
          /throttl/i.test(error.message || ""),
      );

    if (throttled && attempt < GRAPHQL_MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 250 * 2 ** attempt;
      await sleep(delay);
      continue;
    }

    if (!response.ok || body.errors?.length || !body.data) {
      const message =
        body.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
        `Shopify GraphQL request failed with HTTP ${response.status}`;
      throw new Error(message);
    }

    return body.data;
  }

  throw new Error("Shopify GraphQL request exhausted its retry budget.");
}

async function loadAllVariants(admin: AdminClient): Promise<ProductVariantNode[]> {
  const result: ProductVariantNode[] = [];
  let after: string | null = null;

  do {
    const data = await graphqlRequest<VariantsPage>(
      admin,
      PRODUCT_VARIANTS_QUERY,
      { first: 250, after },
    );
    result.push(...data.productVariants.nodes);
    after = data.productVariants.pageInfo.hasNextPage
      ? data.productVariants.pageInfo.endCursor
      : null;
  } while (after);

  return result;
}

async function loadAllLocations(admin: AdminClient) {
  const result: Array<{ id: string; name: string }> = [];
  let after: string | null = null;

  do {
    const data = await graphqlRequest<LocationsPage>(
      admin,
      LOCATIONS_QUERY,
      { first: 250, after },
    );
    result.push(...data.locations.nodes);
    after = data.locations.pageInfo.hasNextPage
      ? data.locations.pageInfo.endCursor
      : null;
  } while (after);

  return result;
}

export async function loadInventoryFoundation(
  admin: AdminClient,
): Promise<InventoryFoundationData> {
  const [variants, locations] = await Promise.all([
    loadAllVariants(admin),
    loadAllLocations(admin),
  ]);

  return { variants, locations };
}

export async function loadInventoryHealth(
  admin: AdminClient,
): Promise<InventoryHealthLevel[]> {
  const locations = await loadAllLocations(admin);
  const result: InventoryHealthLevel[] = [];

  for (const location of locations) {
    const numericLocationId = location.id.split("/").pop();
    if (!numericLocationId) {
      throw new Error(`Invalid Shopify location ID: ${location.id}`);
    }

    let after: string | null = null;

    do {
      const data = await graphqlRequest<InventoryHealthPage>(
        admin,
        INVENTORY_HEALTH_BY_LOCATION_QUERY,
        {
          first: 250,
          after,
          query: `location_id:${numericLocationId}`,
          locationId: location.id,
        },
      );

      for (const variant of data.productVariants.nodes) {
        if (!variant.inventoryItem?.tracked || !variant.inventoryItem.inventoryLevel) {
          continue;
        }

        const quantities = new Map(
          variant.inventoryItem.inventoryLevel.quantities.map((quantity) => [
            quantity.name,
            quantity.quantity,
          ]),
        );

        result.push({
          inventoryItemGid: variant.inventoryItem.id,
          variantGid: variant.id,
          productTitle: variant.product.title,
          displayName: variant.displayName,
          sku: variant.sku,
          locationGid: location.id,
          locationName: location.name,
          available: quantities.get("available") ?? 0,
          onHand: quantities.get("on_hand") ?? null,
          incoming: quantities.get("incoming") ?? null,
          committed: quantities.get("committed") ?? null,
        });
      }

      after = data.productVariants.pageInfo.hasNextPage
        ? data.productVariants.pageInfo.endCursor
        : null;
    } while (after);
  }

  return result;
}

export function summariseInventory(
  variants: ProductVariantNode[],
  locations: Array<{ id: string; name: string }>,
) {
  const tracked = variants.filter((variant) => variant.inventoryItem?.tracked);
  return {
    variantCount: variants.length,
    trackedVariantCount: tracked.length,
    totalAvailable: tracked.reduce((sum, variant) => sum + (variant.inventoryQuantity ?? 0), 0),
    locationCount: locations.length,
    outOfStockCount: tracked.filter(
      (variant) => (variant.inventoryQuantity ?? 0) <= 0,
    ).length,
    lowestStock: [...tracked]
      .sort(
        (a, b) =>
          (a.inventoryQuantity ?? 0) - (b.inventoryQuantity ?? 0),
      )
      .slice(0, 10),
  };
}
