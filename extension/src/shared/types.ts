/**
 * Shared Type Definitions for Chrome Extension and Importer API
 */

export interface ProductOption {
  name: string;
  values: string[];
}

export interface ProductVariant {
  option_values: Record<string, string>;
  price: string;
  sku?: string;
}

export interface ProductImage {
  url: string;
  alt: string;
}

export interface ExtractedProduct {
  source_product_id: string;
  source_url: string;
  source_currency: string;
  title: string;
  description_html: string;
  images: ProductImage[];
  options: ProductOption[];
  variants: ProductVariant[];
  markup_percentage?: number;
  shipping_cost?: string;
}

export type ImportOutcome =
  | 'completed'
  | 'completed_partial_images'
  | 'needs_reconciliation'
  | 'failed';

export interface ImportSuccessResponse {
  success: true;
  outcome: 'completed' | 'completed_partial_images';
  import_attempt_id: number;
  shopify_product_id: string;
  shopify_admin_url: string;
  title: string;
  variants_created: number;
  images_requested: number;
  images_succeeded: number;
  images_failed: number;
  currency: string;
  retryable: false;
  warnings?: string[];
}

export interface ImportErrorResponse {
  success: false;
  outcome: 'failed' | 'needs_reconciliation';
  import_attempt_id?: number;
  error: {
    code: string;
    message: string;
    fields?: Array<{ field: string; message: string }>;
    retryable: boolean;
    shopify_admin_url?: string | null;
  };
}

export type ImportApiResponse = ImportSuccessResponse | ImportErrorResponse;

export interface StoreStatusResponse {
  connected: boolean;
  shop_domain?: string;
  store_name?: string;
  store_currency?: string;
}
