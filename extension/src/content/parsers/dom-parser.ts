import { normalizeCurrency, parsePriceAndCurrencyText } from '../currency.js';
import { normalizeAndValidateImageUrl } from '../url-parser.js';
import type { ProductImage, ProductVariant } from '../../shared/types.js';

export interface DomParsedResult {
  title: string | null;
  description: string | null;
  currency: string | null;
  price: string | null;
  images: ProductImage[];
  variants: ProductVariant[];
}

/**
 * Extracts visible product elements from the rendered page DOM.
 */
export function extractFromDom(doc: Document = document): DomParsedResult {
  // 1. Title Extraction
  const title = extractTitle(doc);

  // 2. Price & Currency Extraction
  const { price, currency } = extractPriceAndCurrency(doc);

  // 3. Image Extraction
  const images = extractImages(doc, title);

  // 4. Description Extraction
  const description = extractDescription(doc);

  // 5. Default Variant
  const variants: ProductVariant[] = [];
  if (price) {
    variants.push({
      option_values: {},
      price,
    });
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

function extractTitle(doc: Document): string | null {
  // Selector priority list for title
  const selectors = [
    'h1[data-pl="product-title"]',
    'div[data-pl="product-title"] h1',
    'h1.product-title-text',
    'div.title--wrap--wb9Mmri h1',
    'h1',
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent) {
      const text = el.textContent.trim();
      if (text.length > 5) {
        return text;
      }
    }
  }

  // Fallback: Open Graph meta title
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (ogTitle && ogTitle.trim().length > 5) {
    return ogTitle.trim();
  }

  return null;
}

function extractPriceAndCurrency(doc: Document): { price: string | null; currency: string | null } {
  // Selector priority list for visible price container
  const selectors = [
    '.price--current--H7sGzqb',
    '.product-price-current',
    '.price--currentPriceText--V8_1S5R',
    'span.uniform-banner-box-price',
    'div[data-pl="product-price"]',
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent) {
      const parsed = parsePriceAndCurrencyText(el.textContent);
      if (parsed.price) {
        return {
          price: parsed.price,
          currency: parsed.currency || detectCurrencyFromMeta(doc),
        };
      }
    }
  }

  // Fallback: Open Graph meta tags
  const ogAmount = doc.querySelector('meta[property="og:price:amount"]')?.getAttribute('content');
  const ogCurrency = doc.querySelector('meta[property="og:price:currency"]')?.getAttribute('content');

  let price: string | null = null;
  if (ogAmount) {
    const num = parseFloat(ogAmount);
    if (!isNaN(num) && num > 0) {
      price = num.toFixed(2);
    }
  }

  const currency = normalizeCurrency(ogCurrency) || detectCurrencyFromMeta(doc);

  return { price, currency };
}

function detectCurrencyFromMeta(doc: Document): string | null {
  const metaCur = doc.querySelector('meta[itemprop="priceCurrency"]')?.getAttribute('content');
  return normalizeCurrency(metaCur);
}

function getImgSrc(el: Element): string | null {
  const directSrc = el.getAttribute('src') ||
    el.getAttribute('data-src') ||
    el.getAttribute('data-lazy-src') ||
    el.getAttribute('data-original') ||
    el.getAttribute('data-ks-lazyload');

  if (directSrc && !directSrc.startsWith('data:')) {
    return directSrc;
  }

  // Check srcset
  const srcset = el.getAttribute('srcset');
  if (srcset) {
    const parts = srcset.split(',');
    const last = parts[parts.length - 1]?.trim().split(/\s+/)[0];
    if (last && !last.startsWith('data:')) {
      return last;
    }
  }

  return null;
}

function extractImages(doc: Document, title: string | null): ProductImage[] {
  const images: ProductImage[] = [];
  const seenUrls = new Set<string>();

  function addIfValid(rawUrl: string | null | undefined) {
    if (!rawUrl) return;
    const clean = normalizeAndValidateImageUrl(rawUrl);
    if (clean && !seenUrls.has(clean)) {
      // Exclude common avatar, flag, logo, and badge images
      const lower = clean.toLowerCase();
      if (
        lower.includes('/avatar/') ||
        lower.includes('/icon/') ||
        lower.includes('/flags/') ||
        lower.includes('badge') ||
        lower.endsWith('.svg')
      ) {
        return;
      }
      seenUrls.add(clean);
      images.push({ url: clean, alt: title || 'Product Image' });
    }
  }

  // 1. Meta Image Tags (Open Graph, Twitter, link rel)
  const metaSelectors = [
    'meta[property="og:image"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ];
  for (const sel of metaSelectors) {
    const el = doc.querySelector(sel);
    if (el) addIfValid(el.getAttribute('content'));
  }

  const linkImg = doc.querySelector('link[rel="image_src"]');
  if (linkImg) addIfValid(linkImg.getAttribute('href'));

  // 2. High-priority gallery, preview, slider, and magnifier elements
  const gallerySelectors = [
    '[class*="gallery"] img',
    '[class*="slider"] img',
    '[class*="image-view"] img',
    '[class*="previewBox"] img',
    '[class*="magnifier"] img',
    '[class*="pic-view"] img',
    '[class*="detail-gallery"] img',
    '[class*="main-image"] img',
    '[class*="poster"] img',
    'ul.images-view-list img',
    '.image-view img',
    '.magnifier-image',
    '#magnifier img',
    '.pdp-body-top img',
    '.pdp-info-right img',
  ];

  for (const sel of gallerySelectors) {
    const matched = doc.querySelectorAll(sel);
    for (const el of matched) {
      addIfValid(getImgSrc(el));
    }
  }

  // 3. Document-wide fallback: Scan any image tag pointing to an approved CDN
  if (images.length === 0) {
    const allImgs = doc.querySelectorAll('img');
    for (const el of allImgs) {
      addIfValid(getImgSrc(el));
      if (images.length >= 20) break;
    }
  }

  return images;
}

function extractDescription(doc: Document): string | null {
  // Priority selector for description container
  const selectors = [
    '#product-description',
    '.detail-desc-decorate-richtext',
    '.product-description',
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.innerHTML) {
      const html = el.innerHTML.trim();
      if (html.length > 20) {
        return html;
      }
    }
  }

  // Fallback meta description
  const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content');
  if (metaDesc && metaDesc.trim().length > 10) {
    return `<p>${metaDesc.trim()}</p>`;
  }

  return null;
}
