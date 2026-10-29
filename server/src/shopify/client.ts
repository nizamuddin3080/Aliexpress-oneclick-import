import { config } from '../config.js';

export interface GraphQLResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost?: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

export type ShopifyClientErrorCode =
  | 'TIMEOUT'
  | 'TRANSPORT_ERROR'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'SHOPIFY_API_ERROR';

export class ShopifyClientError extends Error {
  readonly code: ShopifyClientErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly responseBody?: unknown;

  constructor(
    code: ShopifyClientErrorCode,
    message: string,
    options?: { status?: number; retryAfterSeconds?: number; responseBody?: unknown }
  ) {
    super(message);
    this.name = 'ShopifyClientError';
    this.code = code;
    this.status = options?.status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.responseBody = options?.responseBody;
  }
}

export interface ExecuteGraphQLOptions {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Executes a GraphQL query/mutation against the Shopify Admin API.
 * Version is strictly pinned to 2026-01 via configuration.
 */
export async function executeShopifyGraphQL<T = Record<string, unknown>>(
  options: ExecuteGraphQLOptions
): Promise<GraphQLResponse<T>> {
  const { shopDomain, accessToken, query, variables, timeoutMs = 30_000 } = options;

  const endpoint = `https://${shopDomain}/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 1. Check for Rate Limit (HTTP 429)
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? parseFloat(retryAfterHeader) : 2;
      throw new ShopifyClientError(
        'RATE_LIMITED',
        `Shopify rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
        { status: 429, retryAfterSeconds }
      );
    }

    // 2. Check for Revoked / Invalid Token (HTTP 401)
    if (response.status === 401) {
      throw new ShopifyClientError(
        'UNAUTHORIZED',
        'Shopify rejected access token. The store connection may have been revoked.',
        { status: 401 }
      );
    }

    // 3. Check for 5xx Gateway / Shopify server errors
    if (response.status >= 500) {
      const errorText = await response.text().catch(() => '');
      throw new ShopifyClientError(
        'SHOPIFY_API_ERROR',
        `Shopify Admin API returned server error HTTP ${response.status}.`,
        { status: response.status, responseBody: errorText }
      );
    }

    // 4. Parse JSON body
    const json = (await response.json()) as GraphQLResponse<T>;

    if (!response.ok) {
      throw new ShopifyClientError(
        'SHOPIFY_API_ERROR',
        `Shopify returned HTTP status ${response.status}.`,
        { status: response.status, responseBody: json }
      );
    }

    return json;
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof ShopifyClientError) {
      throw err;
    }

    if ((err as Error).name === 'AbortError') {
      throw new ShopifyClientError(
        'TIMEOUT',
        `Shopify API request timed out after ${timeoutMs}ms. Outcome is uncertain.`,
        { status: 504 }
      );
    }

    throw new ShopifyClientError(
      'TRANSPORT_ERROR',
      `Network transport error connecting to Shopify: ${(err as Error).message}`,
      { responseBody: err }
    );
  }
}
