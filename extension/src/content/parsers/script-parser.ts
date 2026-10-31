import { normalizeCurrency, parsePriceAndCurrencyText } from '../currency.js';
import { normalizeAndValidateImageUrl } from '../url-parser.js';
import type { ProductImage, ProductOption, ProductVariant } from '../../shared/types.js';

export interface ScriptParsedResult {
  title: string | null;
  description: string | null;
  currency: string | null;
  price: string | null;
  images: ProductImage[];
  options: ProductOption[];
  variants: ProductVariant[];
}

/**
 * Searches script elements for AliExpress runParams or embedded state payloads.
 */
export function extractFromScriptTags(doc: Document = document): ScriptParsedResult | null {
  const scripts = doc.querySelectorAll('script');
  if (!scripts || scripts.length === 0) {
    return null;
  }

  for (const script of scripts) {
    const text = script.textContent;
    if (!text) continue;

    // Look for window.runParams = { ... } or runParams = { ... }
    if (text.includes('runParams') || text.includes('skuModule') || text.includes('titleModule')) {
      const parsedData = extractJsonFromScriptText(text);
      if (parsedData) {
        const result = parseAliExpressDataPayload(parsedData);
        if (result && (result.title || result.variants.length > 0)) {
          return result;
        }
      }
    }
  }

  return null;
}

/**
 * Extracts a JSON object from script text using regex patterns.
 */
export function extractJsonFromScriptText(text: string): Record<string, unknown> | null {
  // Pattern 1: window.runParams = { ... };
  const runParamsMatch = text.match(/(?:window\.)?runParams\s*=\s*(\{[\s\S]*?\});(?:\s*window|\s*var|\s*let|\s*const|\s*$)/);
  if (runParamsMatch && runParamsMatch[1]) {
    try {
      return JSON.parse(runParamsMatch[1]) as Record<string, unknown>;
    } catch {
      // Fall through to other strategies
    }
  }

  // Pattern 2: data: { titleModule: ... }
  const dataMatch = text.match(/data\s*:\s*(\{[\s\S]*?"titleModule"[\s\S]*?\})\s*,\s*(?:csrfToken|serverTime|version)/);
  if (dataMatch && dataMatch[1]) {
    try {
      return JSON.parse(dataMatch[1]) as Record<string, unknown>;
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Parses an AliExpress data payload containing module objects (titleModule, skuModule, imageModule, priceModule).
 */
export function parseAliExpressDataPayload(payload: Record<string, unknown>): ScriptParsedResult | null {
  // Unwrap nested data or root payload
  const root = (payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload) as Record<string, unknown>;

  const titleModule = root.titleModule as Record<string, unknown> | undefined;
  const imageModule = root.imageModule as Record<string, unknown> | undefined;
  const priceModule = root.priceModule as Record<string, unknown> | undefined;
  const skuModule = root.skuModule as Record<string, unknown> | undefined;
  const descriptionModule = root.descriptionModule as Record<string, unknown> | undefined;

  // 1. Title
  const title = typeof titleModule?.subject === 'string' ? titleModule.subject.trim() : null;

  // 2. Images
  const images: ProductImage[] = [];
  const seenImageUrls = new Set<string>();

  const imageList: unknown[] = [
    ...(Array.isArray(imageModule?.imagePathList) ? imageModule.imagePathList : []),
    ...(Array.isArray((root.galleryModule as Record<string, unknown>)?.imagePathList)
      ? ((root.galleryModule as Record<string, unknown>).imagePathList as unknown[])
      : []),
    ...(Array.isArray((root.galleryModule as Record<string, unknown>)?.images)
      ? ((root.galleryModule as Record<string, unknown>).images as unknown[])
      : []),
    ...(Array.isArray((root.productInfo as Record<string, unknown>)?.imagePathList)
      ? ((root.productInfo as Record<string, unknown>).imagePathList as unknown[])
      : []),
    ...(Array.isArray(root.imagePathList) ? (root.imagePathList as unknown[]) : []),
    ...(Array.isArray(root.images) ? (root.images as unknown[]) : []),
  ];

  // Also collect SKU property swatch images if available
  if (skuModule && Array.isArray(skuModule.productSKUPropertyList)) {
    for (const prop of skuModule.productSKUPropertyList) {
      if (prop && Array.isArray(prop.skuPropertyValues)) {
        for (const val of prop.skuPropertyValues) {
          if (typeof val.skuPropertyImagePath === 'string') {
            imageList.push(val.skuPropertyImagePath);
          }
          if (typeof val.skuImageUrl === 'string') {
            imageList.push(val.skuImageUrl);
          }
        }
      }
    }
  }

  for (const imgUrl of imageList) {
    if (typeof imgUrl === 'string') {
      const clean = normalizeAndValidateImageUrl(imgUrl);
      if (clean && !seenImageUrls.has(clean)) {
        seenImageUrls.add(clean);
        images.push({ url: clean, alt: title || 'Product Image' });
      }
    }
  }

  // 3. Price & Currency from priceModule
  let currency: string | null = null;
  let basePrice: string | null = null;

  if (priceModule) {
    const minAmount = priceModule.minActivityAmount as Record<string, unknown> | undefined
      || priceModule.minAmount as Record<string, unknown> | undefined;

    if (minAmount) {
      if (typeof minAmount.currency === 'string') {
        currency = normalizeCurrency(minAmount.currency);
      }
      if (typeof minAmount.value === 'number') {
        basePrice = minAmount.value.toFixed(2);
      } else if (typeof minAmount.value === 'string') {
        const num = parseFloat(minAmount.value);
        if (!isNaN(num)) basePrice = num.toFixed(2);
      }
    }

    // Try formatted string if currency not found (e.g. "US $12.99")
    if (!currency && typeof priceModule.formatedActivityPrice === 'string') {
      const parsed = parsePriceAndCurrencyText(priceModule.formatedActivityPrice);
      if (parsed.currency) currency = parsed.currency;
      if (!basePrice && parsed.price) basePrice = parsed.price;
    }
  }

  // 4. Options and Variants from skuModule
  const options: ProductOption[] = [];
  const variants: ProductVariant[] = [];

  const propMap = new Map<string, { optionName: string; valueName: string }>();

  if (skuModule) {
    const propList = Array.isArray(skuModule.productSKUPropertyList)
      ? skuModule.productSKUPropertyList
      : [];

    for (const prop of propList) {
      const optName = typeof prop.skuPropertyName === 'string' ? prop.skuPropertyName.trim() : '';
      if (!optName) continue;

      const optValues: string[] = [];
      const valList = Array.isArray(prop.skuPropertyValues) ? prop.skuPropertyValues : [];

      for (const val of valList) {
        const valName = typeof val.propertyValueDisplayName === 'string'
          ? val.propertyValueDisplayName.trim()
          : typeof val.propertyValueName === 'string'
            ? val.propertyValueName.trim()
            : '';

        const propId = String(val.propertyValueId || val.propertyValueIdLong || '');

        if (valName) {
          optValues.push(valName);
          if (propId) {
            // Map propId to { optionName, valueName } for variant resolution
            propMap.set(propId, { optionName: optName, valueName: valName });
            propMap.set(`${prop.skuPropertyId}:${propId}`, { optionName: optName, valueName: valName });
          }
        }
      }

      if (optValues.length > 0) {
        options.push({ name: optName, values: optValues });
      }
    }

    // Process variants from skuPriceList
    const priceList = Array.isArray(skuModule.skuPriceList) ? skuModule.skuPriceList : [];

    for (const skuItem of priceList) {
      const skuVal = skuItem.skuVal as Record<string, unknown> | undefined;
      const skuPropIds = typeof skuItem.skuPropIds === 'string' ? skuItem.skuPropIds : '';
      const skuId = String(skuItem.skuId || skuItem.skuIdStr || '');

      // Resolve variant price
      let vPrice = basePrice;
      if (skuVal) {
        const rawVal = skuVal.actSkuCalPrice || skuVal.skuCalPrice || (skuVal.skuAmount as Record<string, unknown>)?.value;
        if (rawVal) {
          const num = parseFloat(String(rawVal));
          if (!isNaN(num) && num > 0) {
            vPrice = num.toFixed(2);
          }
        }
      }

      // Resolve option combinations from skuPropIds (e.g. "14:10#Red;5:100#XL" or "10,100")
      const optionValues: Record<string, string> = {};

      if (skuPropIds) {
        const segments = skuPropIds.split(/[;,]/);
        for (const seg of segments) {
          const cleanSeg = seg.trim();
          if (propMap.has(cleanSeg)) {
            const resolved = propMap.get(cleanSeg)!;
            optionValues[resolved.optionName] = resolved.valueName;
          } else {
            // Check property value id alone (after colon if present)
            const parts = cleanSeg.split(':');
            const valId = parts[1] || parts[0];
            if (propMap.has(valId)) {
              const resolved = propMap.get(valId)!;
              optionValues[resolved.optionName] = resolved.valueName;
            }
          }
        }
      }

      if (vPrice) {
        variants.push({
          option_values: optionValues,
          price: vPrice,
          sku: skuId || undefined,
        });
      }
    }
  }

  // Description
  const description = typeof descriptionModule?.descriptionUrl === 'string'
    ? null
    : null;

  return {
    title,
    description,
    currency,
    price: basePrice,
    images,
    options,
    variants,
  };
}
