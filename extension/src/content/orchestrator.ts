import { parseAndValidateAliExpressUrl, normalizeAndValidateImageUrl } from './url-parser.js';
import { requestMainWorldData } from './bridge.js';
import { extractFromScriptTags, parseAliExpressDataPayload } from './parsers/script-parser.js';
import { extractFromJsonLd } from './parsers/jsonld-parser.js';
import { extractFromDom, generateVariantCombinations } from './parsers/dom-parser.js';
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
 *  2. Rendered DOM Extraction (visible elements, options & open-graph meta)
 *  3. JSON-LD Structured Metadata (standards-compliant product schema)
 */
export async function extractProductData(
  doc: Document = document,
  currentUrl: string = window.location.href,
  providedMainWorldPayload?: Record<string, unknown> | null
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
  // Strategy A: Main-world bridge data (provided directly from popup scripting or transient event)
  let scriptData = null;
  const bridgePayload = providedMainWorldPayload || (await requestMainWorldData());
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

  // Strategy C: Rendered DOM elements (including SKU options & images)
  const domData = extractFromDom(doc);

  // Strategy D: JSON-LD structured data
  const jsonLdData = extractFromJsonLd(doc);

  // 3. Merge best available fields with priority: Script -> DOM -> JSON-LD
  let title = scriptData?.title || domData?.title || jsonLdData?.title || null;
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

  // Currency extraction priority: Script -> DOM -> JSON-LD
  const source_currency = scriptData?.currency || domData?.currency || jsonLdData?.currency || null;
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
    ...(domData?.images || []),
    ...(jsonLdData?.images || []),
  ];

  for (const img of imageCandidates) {
    if (!seenImageUrls.has(img.url)) {
      seenImageUrls.add(img.url);
      images.push(img);
      if (images.length >= 50) break; // Supported product envelope limit
    }
  }

  if (images.length === 0 && typeof document !== 'undefined') {
    // Document fallback for any open-graph or high-res product photos
    const metaImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      document.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content') ||
      document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
    if (metaImg) {
      const clean = normalizeAndValidateImageUrl(metaImg);
      if (clean && !seenImageUrls.has(clean)) {
        seenImageUrls.add(clean);
        images.push({ url: clean, alt: title });
      }
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
  // Priority: ScriptData options -> DomData options
  const rawOptions: ProductOption[] = (scriptData?.options && scriptData.options.length > 0)
    ? scriptData.options
    : (domData?.options || []);

  // Merge any options sharing the same name case-insensitively (e.g. multiple "Color" blocks)
  const mergedOptions: ProductOption[] = [];
  for (const opt of rawOptions) {
    const existing = mergedOptions.find(
      (m) => m.name.trim().toLowerCase() === opt.name.trim().toLowerCase()
    );
    if (existing) {
      for (const val of opt.values) {
        if (!existing.values.some((v) => v.toLowerCase() === val.toLowerCase())) {
          existing.values.push(val);
        }
      }
    } else {
      mergedOptions.push({
        name: opt.name.trim(),
        values: [...opt.values],
      });
    }
  }
  const options: ProductOption[] = mergedOptions;

  // Priority: ScriptData variants (if non-empty and matched) -> DomData variants -> JsonLd variants
  let variants: ProductVariant[] = [];
  if (
    scriptData?.variants &&
    scriptData.variants.length > 0 &&
    (options.length === 0 || Object.keys(scriptData.variants[0].option_values).length > 0)
  ) {
    variants = scriptData.variants;
  } else if (domData?.variants && domData.variants.length > 0) {
    variants = domData.variants;
  } else if (jsonLdData?.variants && jsonLdData.variants.length > 0) {
    variants = jsonLdData.variants;
  }

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

  // If options exist but variants array is empty or lacks option values, generate full combinations
  const fallbackPrice = scriptData?.price || domData?.price || jsonLdData?.price;
  if (
    options.length > 0 &&
    (variants.length === 0 ||
      (variants.length === 1 && Object.keys(variants[0].option_values).length === 0))
  ) {
    if (fallbackPrice) {
      variants = generateVariantCombinations(options, fallbackPrice);
    }
  }

  // Ensure default variant exists if product has no options
  if (variants.length === 0) {
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

  const shipping_cost = scriptData?.shipping_cost || domData?.shipping_cost || '0.00';

  const product: ExtractedProduct = {
    source_product_id,
    source_url,
    source_currency,
    title,
    description_html,
    images,
    options,
    variants,
    shipping_cost,
  };

  return {
    success: true,
    product,
  };
}
