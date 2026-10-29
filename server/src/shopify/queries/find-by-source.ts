import { executeShopifyGraphQL } from '../client.js';

export const FIND_BY_SOURCE_ID_QUERY = `
  query FindBySourceId($query: String!) {
    products(first: 1, query: $query) {
      nodes {
        id
        title
        status
        metafields(first: 5, namespace: "custom") {
          nodes {
            key
            value
          }
        }
      }
    }
  }
`;

export interface ReconciledProductNode {
  id: string;
  title: string;
  status: string;
  metafields?: {
    nodes: Array<{
      key: string;
      value: string;
    }>;
  };
}

export interface FindBySourceIdResponse {
  products?: {
    nodes: ReconciledProductNode[];
  };
}

/**
 * Queries Shopify Admin API to check if a product with the given AliExpress source ID already exists.
 * Used for automated duplicate checking and reconciling uncertain import outcomes.
 */
export async function findProductBySourceId(
  shopDomain: string,
  accessToken: string,
  sourceProductId: string
): Promise<ReconciledProductNode | null> {
  const queryStr = `metafield:custom.aliexpress_source_id:${sourceProductId}`;

  const response = await executeShopifyGraphQL<FindBySourceIdResponse>({
    shopDomain,
    accessToken,
    query: FIND_BY_SOURCE_ID_QUERY,
    variables: {
      query: queryStr,
    },
    timeoutMs: 10_000,
  });

  const nodes = response.data?.products?.nodes;
  if (nodes && nodes.length > 0) {
    return nodes[0] ?? null;
  }

  return null;
}
