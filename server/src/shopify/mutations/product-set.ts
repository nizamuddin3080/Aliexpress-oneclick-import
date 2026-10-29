import { calculateSellingPrice } from '../../services/pricing.js';
import { sanitizeDescriptionHtml } from '../../validation/sanitizer.js';
import type { ImportRequestBody } from '../../validation/import-validator.js';

export const PRODUCT_SET_MUTATION = `
  mutation ProductImport($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(synchronous: $synchronous, input: $input) {
      product {
        id
        title
        handle
        status
        options {
          name
          optionValues {
            name
          }
        }
        variants(first: 250) {
          nodes {
            id
            title
            price
            sku
            selectedOptions {
              name
              value
            }
          }
        }
        media(first: 50) {
          nodes {
            id
            alt
            mediaContentType
            status
          }
        }
        metafields(first: 5) {
          nodes {
            namespace
            key
            value
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export interface ShopifyOptionValueInput {
  name: string;
}

export interface ShopifyProductOptionInput {
  name: string;
  values: ShopifyOptionValueInput[];
}

export interface ShopifyVariantOptionValueInput {
  optionName: string;
  name: string;
}

export interface ShopifyProductVariantInput {
  price: string;
  sku?: string;
  optionValues?: ShopifyVariantOptionValueInput[];
}

export interface ShopifyFileInput {
  originalSource: string;
  alt: string;
  mediaContentType: 'IMAGE';
}

export interface ShopifyMetafieldInput {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export interface ProductSetInput {
  title: string;
  descriptionHtml?: string;
  vendor: string;
  status: 'DRAFT';
  productOptions?: ShopifyProductOptionInput[];
  variants: ShopifyProductVariantInput[];
  files?: ShopifyFileInput[];
  metafields: ShopifyMetafieldInput[];
}

export interface ProductSetVariables {
  synchronous: boolean;
  input: ProductSetInput;
}

/**
 * Constructs the ProductSetVariables payload for Shopify Admin GraphQL productSet mutation.
 * Guarantees that:
 * 1. Product status is strictly 'DRAFT'.
 * 2. Description is sanitized.
 * 3. Variant prices reflect decimal-safe markup calculations.
 * 4. Tracking metafields (custom.aliexpress_source_id, custom.aliexpress_source_url) are attached.
 */
export function buildProductSetPayload(data: ImportRequestBody): ProductSetVariables {
  const sanitizedHtml = sanitizeDescriptionHtml(data.description_html);

  // 1. Map options
  let productOptions: ShopifyProductOptionInput[] | undefined;
  if (data.options && data.options.length > 0) {
    productOptions = data.options.map(opt => ({
      name: opt.name,
      values: opt.values.map(val => ({ name: val })),
    }));
  }

  // 2. Map variants with calculated selling price
  const variants: ShopifyProductVariantInput[] = data.variants.map((v, idx) => {
    const sellingPrice = calculateSellingPrice(v.price, data.markup_percentage);
    const sku = v.sku || `${data.source_product_id}-${idx + 1}`;

    const optionValues: ShopifyVariantOptionValueInput[] = [];
    if (v.option_values && Object.keys(v.option_values).length > 0) {
      for (const [optName, valName] of Object.entries(v.option_values)) {
        optionValues.push({
          optionName: optName,
          name: valName,
        });
      }
    }

    const item: ShopifyProductVariantInput = {
      price: sellingPrice,
      sku,
    };

    if (optionValues.length > 0) {
      item.optionValues = optionValues;
    }

    return item;
  });

  // 3. Map images as files
  const files: ShopifyFileInput[] = (data.images || []).map((img, idx) => ({
    originalSource: img.url,
    alt: img.alt || `${data.title} - Image ${idx + 1}`,
    mediaContentType: 'IMAGE',
  }));

  // 4. Attach source tracking metafields
  const metafields: ShopifyMetafieldInput[] = [
    {
      namespace: 'custom',
      key: 'aliexpress_source_id',
      value: data.source_product_id,
      type: 'single_line_text_field',
    },
    {
      namespace: 'custom',
      key: 'aliexpress_source_url',
      value: data.source_url,
      type: 'url',
    },
  ];

  const input: ProductSetInput = {
    title: data.title,
    vendor: 'AliExpress Import',
    status: 'DRAFT', // STRICT REQUIREMENT: ALWAYS DRAFT, NEVER ACTIVE
    variants,
    files: files.length > 0 ? files : undefined,
    metafields,
  };

  if (sanitizedHtml) {
    input.descriptionHtml = sanitizedHtml;
  }

  if (productOptions && productOptions.length > 0) {
    input.productOptions = productOptions;
  }

  return {
    synchronous: true,
    input,
  };
}
