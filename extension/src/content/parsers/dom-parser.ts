import { normalizeCurrency, parsePriceAndCurrencyText } from '../currency.js';
import { normalizeAndValidateImageUrl } from '../url-parser.js';
import type { ProductImage, ProductOption, ProductVariant } from '../../shared/types.js';

export interface DomParsedResult {
  title: string | null;
  description: string | null;
  currency: string | null;
  price: string | null;
  shipping_cost: string | null;
  images: ProductImage[];
  options: ProductOption[];
  variants: ProductVariant[];
}

/**
 * Generates Cartesian product combinations for product options with a fallback selling price.
 */
export function generateVariantCombinations(
  options: ProductOption[],
  price: string
): ProductVariant[] {
  if (options.length === 0) {
    return [{ option_values: {}, price }];
  }

  let combinations: Array<Record<string, string>> = [{}];

  for (const opt of options) {
    const nextCombinations: Array<Record<string, string>> = [];
    const values = opt.values.length > 0 ? opt.values : ['Default'];

    for (const combo of combinations) {
      for (const val of values) {
        nextCombinations.push({
          ...combo,
          [opt.name]: val,
        });
      }
    }
    combinations = nextCombinations;
    // Cap combinations to Shopify maximum variant threshold
    if (combinations.length > 250) {
      combinations = combinations.slice(0, 250);
      break;
    }
  }

  return combinations.map((option_values, idx) => ({
    option_values,
    price,
    sku: `VAR-${idx + 1}`,
  }));
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

  // 5. Shipping Cost Extraction
  const shipping_cost = extractShippingCostFromDom(doc);

  // 6. Options and Variants from Rendered DOM
  const options = extractOptionsFromDom(doc);
  let variants: ProductVariant[] = [];

  if (options.length > 0 && price) {
    variants = generateVariantCombinations(options, price);
  } else if (price) {
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
    shipping_cost,
    images,
    options,
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

/**
 * Scans the rendered AliExpress DOM for SKU property groups (Color, Size, etc.) and their swatches/buttons.
 */
export function extractOptionsFromDom(doc: Document = document): ProductOption[] {
  const options: ProductOption[] = [];

  // Group selectors for SKU properties on AliExpress
  const propertyGroupSelectors = [
    'div[class*="sku-property"]',
    'div[class*="sku--property"]',
    'div[class*="skuProperty"]',
    'div[class*="sku-wrap"] > div',
    'div[data-pl="product-sku"] > div',
    'div[class*="Sku_Sku"]',
    'div[class*="sku-item"]',
    'div[class*="skuItem"]',
    'div[class*="sku-prop"]',
  ];

  let propertyGroups: Element[] = [];
  for (const sel of propertyGroupSelectors) {
    const found = Array.from(doc.querySelectorAll(sel));
    // Filter groups that have clickable item children or swatches
    const valid = found.filter((g) =>
      Boolean(
        g.querySelector(
          'img, button, [class*="item"], [data-sku-id], [data-property-id], [class*="sku"]'
        )
      )
    );
    if (valid.length > 0) {
      propertyGroups = valid;
      break;
    }
  }

  for (let gIdx = 0; gIdx < propertyGroups.length; gIdx++) {
    const group = propertyGroups[gIdx];

    // Find option title (e.g. "Color: Black", "Size: XL", "Color")
    let optName: string | null = null;
    const titleSelectors = [
      'div[class*="sku-title"]',
      'span[class*="sku-title"]',
      'div[class*="title--"]',
      'span[class*="title--"]',
      'div[class*="property-title"]',
      'span[class*="property-title"]',
      'div[class*="label"]',
      'h2',
      'h3',
    ];

    for (const tSel of titleSelectors) {
      const tEl = group.querySelector(tSel);
      if (tEl && tEl.textContent) {
        const raw = tEl.textContent.trim();
        const clean = raw.split(':')[0].trim();
        if (clean.length > 0 && clean.length < 30) {
          optName = clean;
          break;
        }
      }
    }

    // Fallback option name if title element not found
    if (!optName) {
      if (group.querySelector('img')) {
        optName = 'Color';
      } else {
        optName = gIdx === 0 ? 'Color' : gIdx === 1 ? 'Size' : `Option ${gIdx + 1}`;
      }
    }

    // Find option values within group
    const optValues: string[] = [];
    const seenValues = new Set<string>();

    const itemSelectors = [
      'div[class*="sku-property-item"]',
      'div[class*="sku-item--item"]',
      'div[class*="item--item"]',
      'li[class*="sku-property-item"]',
      'div[class*="skuItem"]',
      'button[class*="sku"]',
      'div[data-sku-id]',
      'div[data-property-id]',
      'img[class*="sku"]',
    ];

    let items: Element[] = [];
    for (const iSel of itemSelectors) {
      const foundItems = Array.from(group.querySelectorAll(iSel));
      if (foundItems.length > 0) {
        items = foundItems;
        break;
      }
    }

    // Fallback: direct children if no specific item selector matched
    if (items.length === 0) {
      items = Array.from(group.children).filter((c) =>
        Boolean(c.querySelector('img') || c.textContent?.trim())
      );
    }

    for (const item of items) {
      let valName: string | null = null;

      // 1. Check img alt or title (swatch)
      const img = item.tagName === 'IMG' ? (item as HTMLImageElement) : item.querySelector('img');
      if (img) {
        valName = img.getAttribute('alt') || img.getAttribute('title');
      }

      // 2. Check title attribute or aria-label
      if (!valName) {
        valName =
          item.getAttribute('title') ||
          item.getAttribute('aria-label') ||
          item.getAttribute('data-value');
      }

      // 3. Check visible text content
      if (!valName && item.textContent) {
        const text = item.textContent.trim();
        // Ignore long text that looks like a description or price block
        if (text.length > 0 && text.length <= 40 && !text.includes('$')) {
          valName = text;
        }
      }

      if (valName) {
        const cleanVal = valName.replace(/\s+/g, ' ').trim();
        if (cleanVal && !seenValues.has(cleanVal.toLowerCase())) {
          seenValues.add(cleanVal.toLowerCase());
          optValues.push(cleanVal);
        }
      }
    }

    if (optValues.length > 0) {
      options.push({
        name: optName,
        values: optValues,
      });
    }
  }

  return options;
}

/**
 * Scans the DOM for visible shipping / delivery cost text.
 */
export function extractShippingCostFromDom(doc: Document = document): string | null {
  const shippingSelectors = [
    'div[data-pl="product-shipping"]',
    'div[class*="shipping--"]',
    'div[class*="delivery--"]',
    'div[class*="logistics--"]',
    'div[class*="dynamic-shipping"]',
    'span[class*="shipping--"]',
    'span[class*="delivery--"]',
    '.product-shipping-price',
  ];

  for (const sel of shippingSelectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent) {
      const text = el.textContent.trim();
      if (/free\s*(?:shipping|delivery)/i.test(text)) {
        return '0.00';
      }

      const parsed = parsePriceAndCurrencyText(text);
      if (parsed.price) {
        return parsed.price;
      }
    }
  }

  return null;
}
