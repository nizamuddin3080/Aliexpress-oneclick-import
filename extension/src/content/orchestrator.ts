import { parseAndValidateAliExpressUrl } from './url-parser.js';
import { requestMainWorldData } from './bridge.js';
import { extractFromScriptTags, parseAliExpressDataPayload } from './parsers/script-parser.js';
import { extractFromJsonLd } from './parsers/jsonld-parser.js';
import { extractFromDom } from './parsers/dom-parser.js';
import { sanitizeProductDescription } from './sanitizer.js';
import type { ExtractedProduct, ProductImage, ProductOption, ProductVariant } from '../shared/types.js';

export interface ExtractionResult {
  success: boolean;
  product?: ExtractedProduct;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Multi-Strategy Product Extractor for AliExpress product pages.
 * Strategy Chain:
 *  1. Bridge / Script JSON Data (richest variant matrix & pricing)
 *  2. JSON-LD Structured Metadata (standards-compliant product schema)
 *  3. Rendered DOM Extraction (visible elements & open-graph meta)
 */
export async function extractProductData(
  doc: Document = document,
  currentUrl: string = window.location.href
): Promise<ExtractionResult> {
  // 1. URL & Product ID validation
  const urlCheck = parseAndValidateAliExpressUrl(currentUrl);
  if (!urlCheck.isValid || !urlCheck.productId || !urlCheck.canonicalUrl) {
    return {
      success: false,
      error: {
        code: 'INVALID_URL',
        message: urlCheck.error || 'The current page is not a valid AliExpress item detail page.',
      },
    };
  }

  const source_product_id = urlCheck.productId;
  const source_url = urlCheck.canonicalUrl;

  // 2. Execute extraction strategies in priority order
  // Strategy A: Main-world bridge data
  let scriptData = null;
  const bridgePayload = await requestMainWorldData();
  if (bridgePayload) {
    scriptData = parseAliExpressDataPayload(bridgePayload);
  }

  // Strategy B: Embedded script tags
  if (!scriptData || (!scriptData.title && scriptData.variants.length === 0)) {
    const fromTags = extractFromScriptTags(doc);
    if (fromTags) {
      scriptData = fromTags;
    }
  }

  // Strategy C: JSON-LD structured data
  const jsonLdData = extractFromJsonLd(doc);

  // Strategy D: Rendered DOM elements
  const domData = extractFromDom(doc);

  // 3. Merge best available fields with priority: Script -> JSON-LD -> DOM
  let title = scriptData?.title || jsonLdData?.title || domData?.title || null;
  if (title) {
    title = title.replace(/\s+/g, ' ').trim();
    if (title.length > 255) {
      title = title.slice(0, 255).trim();
    }
  }

  if (!title) {
    return {
      success: false,
      error: {
        code: 'EXTRACTION_FAILED_TITLE',
        message: 'Could not extract product title from AliExpress page.',
      },
    };
  }

  // Currency extraction priority: Script -> JSON-LD -> DOM
  const source_currency = scriptData?.currency || jsonLdData?.currency || domData?.currency || null;
  if (!source_currency) {
    return {
      success: false,
      error: {
        code: 'EXTRACTION_FAILED_CURRENCY',
        message: 'Could not detect the displayed currency code on this page. Please ensure a standard currency is displayed.',
      },
    };
  }

  // Description extraction priority: DOM rich HTML -> JSON-LD -> meta
  const rawDescription = domData?.description || jsonLdData?.description || scriptData?.description || '';
  const description_html = sanitizeProductDescription(rawDescription);

  // Image aggregation (deduplicated by URL)
  const images: ProductImage[] = [];
  const seenImageUrls = new Set<string>();

  const imageCandidates = [
    ...(scriptData?.images || []),
    ...(jsonLdData?.images || []),
    ...(domData?.images || []),
  ];

  for (const img of imageCandidates) {
    if (!seenImageUrls.has(img.url)) {
      seenImageUrls.add(img.url);
      images.push(img);
      if (images.length >= 50) break; // Supported product envelope limit
    }
  }

  if (images.length === 0) {
    return {
      success: false,
      error: {
        code: 'EXTRACTION_FAILED_IMAGES',
        message: 'No valid product images found on this AliExpress page.',
      },
    };
  }

  // Options & Variants resolution
  let options: ProductOption[] = scriptData?.options || [];
  let variants: ProductVariant[] = scriptData?.variants || jsonLdData?.variants || domData?.variants || [];

  // Strict 3-option limit check (ADR-014, F-04): Never silently drop option dimensions
  if (options.length > 3) {
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_PRODUCT_OPTIONS',
        message: `This product has ${options.length} option dimensions (${options.map((o) => o.name).join(', ')}). Shopify supports a maximum of 3 options. To prevent data corruption, this product cannot be imported.`,
      },
    };
  }

  // Ensure default variant exists if product has no options
  if (variants.length === 0) {
    const fallbackPrice = scriptData?.price || jsonLdData?.price || domData?.price;
    if (fallbackPrice) {
      variants = [
        {
          option_values: {},
          price: fallbackPrice,
        },
      ];
    }
  }

  if (variants.length === 0) {
    return {
      success: false,
      error: {
        code: 'EXTRACTION_FAILED_PRICE',
        message: 'Could not extract valid variant prices for this product.',
      },
    };
  }

  // Verify all variants have positive prices
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const numPrice = parseFloat(v.price);
    if (isNaN(numPrice) || numPrice <= 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_VARIANT_PRICE',
          message: `Variant ${i + 1} has an invalid or missing price (${v.price}). Cannot import with missing prices.`,
        },
      };
    }
  }

  const product: ExtractedProduct = {
    source_product_id,
    source_url,
    source_currency,
    title,
    description_html,
    images,
    options,
    variants,
  };

  return {
    success: true,
    product,
  };
}
