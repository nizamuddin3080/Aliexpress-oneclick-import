import { normalizeCurrency } from '../currency.js';
import { normalizeAndValidateImageUrl } from '../url-parser.js';
import type { ProductImage, ProductVariant } from '../../shared/types.js';

export interface JsonLdParsedResult {
  title: string | null;
  description: string | null;
  currency: string | null;
  price: string | null;
  images: ProductImage[];
  variants: ProductVariant[];
}

interface JsonLdProductNode {
  '@type'?: string | string[];
  name?: string;
  description?: string;
  image?: string | string[];
  sku?: string;
  offers?: {
    '@type'?: string;
    price?: string | number;
    lowPrice?: string | number;
    priceCurrency?: string;
    sku?: string;
  } | Array<{
    '@type'?: string;
    price?: string | number;
    priceCurrency?: string;
    sku?: string;
  }>;
  [key: string]: unknown;
}

/**
 * Searches JSON-LD script blocks in the document to locate schema.org Product data.
 */
export function extractFromJsonLd(doc: Document = document): JsonLdParsedResult | null {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  if (!scripts || scripts.length === 0) {
    return null;
  }

  for (const script of scripts) {
    const content = script.textContent?.trim();
    if (!content) continue;

    try {
      const parsed = JSON.parse(content) as unknown;
      const productNode = findProductNode(parsed);
      if (productNode) {
        return parseProductNode(productNode);
      }
    } catch {
      // Ignore JSON parse errors in malformed script blocks
    }
  }

  return null;
}

function findProductNode(node: unknown): JsonLdProductNode | null {
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item);
      if (found) return found;
    }
    return null;
  }

  const obj = node as JsonLdProductNode;
  const type = obj['@type'];

  if (type) {
    if (typeof type === 'string' && type.toLowerCase().includes('product')) {
      return obj;
    }
    if (Array.isArray(type) && type.some((t) => t.toLowerCase().includes('product'))) {
      return obj;
    }
  }

  // Check nested fields
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object') {
      const found = findProductNode(val);
      if (found) return found;
    }
  }

  return null;
}

function parseProductNode(node: JsonLdProductNode): JsonLdParsedResult {
  const title = typeof node.name === 'string' ? node.name.trim() : null;
  const description = typeof node.description === 'string' ? node.description.trim() : null;

  // Extract images
  const images: ProductImage[] = [];
  const rawImages = Array.isArray(node.image) ? node.image : node.image ? [node.image] : [];
  for (const imgUrl of rawImages) {
    if (typeof imgUrl === 'string') {
      const cleanUrl = normalizeAndValidateImageUrl(imgUrl);
      if (cleanUrl) {
        images.push({ url: cleanUrl, alt: title || 'Product Image' });
      }
    }
  }

  // Extract offers (price & currency)
  let currency: string | null = null;
  let price: string | null = null;
  const variants: ProductVariant[] = [];

  const offers = node.offers;
  if (offers) {
    if (Array.isArray(offers)) {
      for (const offer of offers) {
        if (!currency && offer.priceCurrency) {
          currency = normalizeCurrency(offer.priceCurrency);
        }
        const offerPrice = offer.price !== undefined ? String(offer.price) : null;
        if (offerPrice) {
          const num = parseFloat(offerPrice);
          if (!isNaN(num) && num > 0) {
            if (!price) price = num.toFixed(2);
            variants.push({
              option_values: {},
              price: num.toFixed(2),
              sku: offer.sku ? String(offer.sku) : undefined,
            });
          }
        }
      }
    } else if (typeof offers === 'object') {
      if (offers.priceCurrency) {
        currency = normalizeCurrency(offers.priceCurrency);
      }
      const rawPrice = offers.price !== undefined ? offers.price : offers.lowPrice;
      if (rawPrice !== undefined) {
        const num = parseFloat(String(rawPrice));
        if (!isNaN(num) && num > 0) {
          price = num.toFixed(2);
          variants.push({
            option_values: {},
            price,
            sku: offers.sku ? String(offers.sku) : undefined,
          });
        }
      }
    }
  }

  return {
    title,
    description,
    currency,
    price,
    images,
    variants,
  };
}
