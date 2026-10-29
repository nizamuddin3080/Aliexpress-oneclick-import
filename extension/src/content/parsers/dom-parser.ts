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

function extractImages(doc: Document, title: string | null): ProductImage[] {
  const images: ProductImage[] = [];
  const seenUrls = new Set<string>();

  // 1. Gallery thumbnail list
  const galleryImgs = doc.querySelectorAll(
    '.image-view--previewBox--Gk_f0Y1 img, .slider--slider--1U5rF2Y img, ul.images-view-list img'
  );

  for (const img of galleryImgs) {
    const src = img.getAttribute('src');
    if (src) {
      const clean = normalizeAndValidateImageUrl(src);
      if (clean && !seenUrls.has(clean)) {
        seenUrls.add(clean);
        images.push({ url: clean, alt: title || 'Product Image' });
      }
    }
  }

  // 2. Open Graph meta image
  const ogImg = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  if (ogImg) {
    const clean = normalizeAndValidateImageUrl(ogImg);
    if (clean && !seenUrls.has(clean)) {
      seenUrls.add(clean);
      images.push({ url: clean, alt: title || 'Product Image' });
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
