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


const INVENTORY_HEALTH_QUERY = String.raw`
#graphql
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
}`;
