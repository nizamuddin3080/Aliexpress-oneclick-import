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

  // Title selectors indicating a property row heading (e.g. "Color: Black", "Size: M")
  const titleSelectors = [
    'div[class*="sku-title"]',
    'span[class*="sku-title"]',
    'div[class*="sku-item--title"]',
    'span[class*="sku-item--title"]',
    'div[class*="sku-prop-title"]',
    'span[class*="sku-prop-title"]',
    'div[class*="title--"]',
    'span[class*="title--"]',
    'div[class*="property-title"]',
    'span[class*="property-title"]',
    'div[class*="skuPropertyTitle"]',
    'span[class*="skuPropertyTitle"]',
    'div[class*="sku-name"]',
    'span[class*="sku-name"]',
  ];

  // Specific row selectors for SKU property groups on AliExpress
  // Note: NEVER include 'div[class*="sku-item"]' or 'div[class*="skuItem"]' because individual swatches have classes like sku-item--item--...
  const propertyGroupSelectors = [
    'div[class*="sku-item--property"]',
    'div[class*="sku-item--wrap"] > div',
    'div[class*="sku--property"]',
    'div[class*="sku-property"]',
    'div[class*="skuProperty"]',
    'div[class*="sku-item--skuItem"]',
    'div[class*="skuItem--group"]',
    'div[class*="sku-prop--wrap"]',
    'div[class*="sku-prop"]',
    'div[class*="sku-wrap"] > div',
    'div[data-pl="product-sku"] > div',
    'div[class*="sku-section"]',
    'div[class*="Sku_Sku"]',
  ];

  let rawGroups: Element[] = [];

  // Strategy 1: Find candidate groups matching known property group selectors
  for (const sel of propertyGroupSelectors) {
    const found = Array.from(doc.querySelectorAll(sel));
    if (found.length > 0) {
      rawGroups.push(...found);
    }
  }

  // Strategy 2: If no candidate groups found, locate property rows via title elements
  if (rawGroups.length === 0) {
    for (const tSel of titleSelectors) {
      const titles = Array.from(doc.querySelectorAll(tSel));
      for (const t of titles) {
        // Find row container: the parent or closest container
        const row = t.closest('div[class*="sku"], div[class*="prop"], div[data-pl]') || t.parentElement;
        if (row && !rawGroups.includes(row)) {
          rawGroups.push(row);
        }
      }
      if (rawGroups.length > 0) break;
    }
  }

  // Deduplicate raw groups
  const uniqueGroups = Array.from(new Set(rawGroups));

  // Hierarchy Guard: Filter out any element that is contained within another candidate group
  // (e.g. an inner swatch container or swatch item inside a property row)
  const candidateGroups = uniqueGroups.filter(
    (g) => !uniqueGroups.some((parent) => parent !== g && parent.contains(g))
  );

  // Group Validation Guard:
  // A genuine property group MUST either:
  // 1) Contain an identifiable title element, OR
  // 2) Contain at least 2 distinct selectable swatch items.
  // Standalone swatches without titles are discarded.
  const itemSelectors = [
    'div[class*="sku-property-item"]',
    'li[class*="sku-property-item"]',
    'div[class*="sku-item--item"]',
    'div[class*="item--item"]',
    'div[class*="skuItem--item"]',
    'li[class*="sku-item"]',
    'button[class*="sku"]',
    'div[data-sku-id]',
    'div[data-property-id]',
    'div[class*="sku-value"]',
    'li[class*="sku-value"]',
    'span[class*="sku-value"]',
  ];

  for (const group of candidateGroups) {
    // 1. Find option title (e.g. "Color: Black", "Size: XL", "Color")
    let optName: string | null = null;

    for (const tSel of titleSelectors) {
      const tEl = group.querySelector(tSel);
      if (tEl && tEl.textContent) {
        let raw = tEl.textContent.replace(/\u00a0/g, ' ').trim();
        const iconEl = tEl.querySelector('[class*="sizeIcon"], [class*="sizeChart"], [class*="chart"]');
        if (iconEl && iconEl.textContent) {
          raw = raw.replace(iconEl.textContent, '').trim();
        }
        let clean = raw.split(':')[0].trim();
        clean = clean.replace(/^(select|choose)\s+/i, '').trim();
        if (clean.length > 0 && clean.length < 30) {
          optName = clean;
          break;
        }
      }
    }

    // Secondary title check: headings or labels
    if (!optName) {
      const headingEl = group.querySelector('h2, h3, h4, div[class*="label"], span[class*="label"]');
      if (headingEl && headingEl.textContent) {
        let raw = headingEl.textContent.replace(/\u00a0/g, ' ').trim();
        const iconEl = headingEl.querySelector('[class*="sizeIcon"], [class*="sizeChart"], [class*="chart"]');
        if (iconEl && iconEl.textContent) {
          raw = raw.replace(iconEl.textContent, '').trim();
        }
        const clean = raw.split(':')[0].replace(/^(select|choose)\s+/i, '').trim();
        if (clean.length > 0 && clean.length < 30 && !clean.includes('$')) {
          optName = clean;
        }
      }
    }

    // 2. Find items / swatches in this group
    let items: Element[] = [];

    // Priority 1: Direct swatches with data-sku-col attribute (standard modern AliExpress)
    const skuColItems = Array.from(group.querySelectorAll('[data-sku-col]'));
    if (skuColItems.length > 0) {
      items = skuColItems;
    }

    // Priority 2: Children of dedicated SKU swatches container (sku-item--skus, data-sku-row, sku-property-list)
    if (items.length === 0) {
      const skusContainer = group.querySelector(
        'div[class*="sku-item--skus"], div[data-sku-row], ul[class*="sku-property-list"], div[class*="sku-content"], div[class*="sku-items"]'
      );
      if (skusContainer) {
        items = Array.from(skusContainer.children).filter((c) => {
          if (c.tagName === 'IFRAME') return false;
          return Boolean(c.getAttribute('data-sku-col') || c.querySelector('img') || c.textContent?.trim());
        });
      }
    }

    // Priority 3: Specific swatch item class selectors
    if (items.length === 0) {
      const specificItemSelectors = [
        'div[class*="sku-item--image"]',
        'div[class*="sku-item--text"]',
        'div[class*="sku-property-item"]',
        'li[class*="sku-property-item"]',
        'div[class*="sku-item--item"]',
        'div[class*="item--item"]',
        'div[class*="skuItem--item"]',
        'li[class*="sku-item"]',
        'button[class*="sku"]',
        'div[data-sku-id]',
        'div[data-property-id]',
        'div[class*="sku-value"]',
        'li[class*="sku-value"]',
        'span[class*="sku-value"]',
      ];

      for (const iSel of specificItemSelectors) {
        const foundItems = Array.from(group.querySelectorAll(iSel));
        if (foundItems.length > 0) {
          items = foundItems;
          break;
        }
      }
    }

    // Priority 4: Fallback item detection - clickable buttons, radios, or direct children with content
    if (items.length === 0) {
      const titleEl = group.querySelector(titleSelectors.join(','));
      const buttons = Array.from(
        group.querySelectorAll('button, [role="button"], [role="radio"], [data-sku-id], [data-property-id]')
      ).filter((b) => !titleEl || !titleEl.contains(b));

      if (buttons.length > 0) {
        items = buttons;
      } else {
        // Direct children excluding title element
        items = Array.from(group.children).filter((c) => {
          if (c === titleEl || titleEl?.contains(c)) return false;
          return Boolean(c.querySelector('img') || c.textContent?.trim());
        });
      }
    }

    // Strictly exclude any size chart / info tables, iframes, or non-swatch meta blocks
    items = items.filter((item) => {
      const isSizeInfo = Boolean(
        item.closest('[class*="sizeInfo"], [class*="size-info"], [class*="sizeChart"], [class*="size-chart"]') ||
        item.classList.contains('extend--iframe') ||
        item.tagName === 'IFRAME'
      );
      return !isSizeInfo;
    });

    // Filter out nested items (so we don't count an item and its child wrapper)
    items = items.filter(
      (item) => !items.some((other) => other !== item && other.contains(item))
    );

    // Validation Guard: If no title was found AND items.length < 2, discard this element
    if (!optName && items.length < 2) {
      continue;
    }

    // Fallback option name if title element was not found
    if (!optName) {
      const hasImage = group.querySelector('img') !== null;
      if (hasImage && !options.some((o) => o.name.toLowerCase() === 'color')) {
        optName = 'Color';
      } else if (!options.some((o) => o.name.toLowerCase() === 'color')) {
        optName = 'Color';
      } else if (!options.some((o) => o.name.toLowerCase() === 'size')) {
        optName = 'Size';
      } else if (!options.some((o) => o.name.toLowerCase() === 'style')) {
        optName = 'Style';
      } else {
        // Never generate Option 4, Option 5, Option 8, etc. Discard if exceeds 3.
        continue;
      }
    }

    // 3. Extract option values from items
    const optValues: string[] = [];
    const seenValues = new Set<string>();

    for (const item of items) {
      let valName: string | null = null;

      // 1. Check img alt or title (swatch)
      const img = item.tagName === 'IMG' ? (item as HTMLImageElement) : item.querySelector('img');
      if (img) {
        valName = img.getAttribute('alt') || img.getAttribute('title');
      }

      // 2. Check title attribute, aria-label, data-value, data-name, data-title
      if (!valName) {
        valName =
          item.getAttribute('title') ||
          item.getAttribute('aria-label') ||
          item.getAttribute('data-value') ||
          item.getAttribute('data-name') ||
          item.getAttribute('data-title');
      }

      // 3. Check visible text content
      if (!valName && item.textContent) {
        const text = item.textContent.replace(/\u00a0/g, ' ').trim();
        // Ignore long text that looks like description or price
        if (text.length > 0 && text.length <= 40 && !text.includes('$')) {
          valName = text;
        }
      }

      if (valName) {
        const cleanVal = valName.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanVal && !seenValues.has(cleanVal.toLowerCase())) {
          seenValues.add(cleanVal.toLowerCase());
          optValues.push(cleanVal);
        }
      }
    }

    // 4. Merge values by Option Name (case-insensitive)
    if (optValues.length > 0) {
      const cleanOptName = optName.trim();
      const existingOpt = options.find(
        (o) => o.name.trim().toLowerCase() === cleanOptName.toLowerCase()
      );

      if (existingOpt) {
        for (const val of optValues) {
          if (!existingOpt.values.some((v) => v.toLowerCase() === val.toLowerCase())) {
            existingOpt.values.push(val);
          }
        }
      } else {
        options.push({
          name: cleanOptName,
          values: optValues,
        });
      }
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
