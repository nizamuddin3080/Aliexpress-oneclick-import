import { normalizeCurrency, parsePriceAndCurrencyText } from '../currency.js';
import { normalizeAndValidateImageUrl } from '../url-parser.js';
import type { ProductImage, ProductOption, ProductVariant } from '../../shared/types.js';

export interface ScriptParsedResult {
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
  // Pattern 1: window.runParams = { ... } or window._runParams_ = { ... }
  const runParamsMatch = text.match(/(?:window\.)?(?:runParams|_runParams_|__INITIAL_DATA__|__INITIAL_STATE__)\s*=\s*(\{[\s\S]*?\});(?:\s*window|\s*var|\s*let|\s*const|\s*$)/);
  if (runParamsMatch && runParamsMatch[1]) {
    try {
      return JSON.parse(runParamsMatch[1]) as Record<string, unknown>;
    } catch {
      // Fall through to other strategies
    }
  }

  // Pattern 2: window.runParams.data = { ... };
  const runParamsDataMatch = text.match(/(?:window\.)?runParams\.data\s*=\s*(\{[\s\S]*?\});/);
  if (runParamsDataMatch && runParamsDataMatch[1]) {
    try {
      const parsedData = JSON.parse(runParamsDataMatch[1]) as Record<string, unknown>;
      return { data: parsedData };
    } catch {
      // Fall through
    }
  }

  // Pattern 3: data: { titleModule: ... } or data: { skuModule: ... }
  const dataMatch = text.match(/data\s*:\s*(\{[\s\S]*?(?:"titleModule"|"skuModule")[\s\S]*?\})\s*,\s*(?:csrfToken|serverTime|version)/);
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

  // 4. Options and Variants from skuModule or alternate SKU containers
  const options: ProductOption[] = [];
  const variants: ProductVariant[] = [];

  const propMap = new Map<string, { optionName: string; valueName: string }>();
  const propIdToName = new Map<string, string>();

  const activeSkuModule = (skuModule ||
    (root.productSKUInfo as Record<string, unknown> | undefined) ||
    (root.skuInfo as Record<string, unknown> | undefined) ||
    (root.skuComponent as Record<string, unknown> | undefined) ||
    (root.productInfo as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined;

  if (activeSkuModule) {
    const rawPropList = activeSkuModule.productSKUPropertyList ||
      activeSkuModule.skuProperties ||
      activeSkuModule.propertyList;

    const propList = Array.isArray(rawPropList) ? rawPropList : [];

    for (const prop of propList) {
      const optName = typeof prop.skuPropertyName === 'string'
        ? prop.skuPropertyName.trim()
        : typeof prop.propertyName === 'string'
          ? prop.propertyName.trim()
          : typeof prop.name === 'string'
            ? prop.name.trim()
            : '';
      if (!optName) continue;

      const propIdKey = String(prop.skuPropertyId || prop.propertyId || prop.id || '');
      if (propIdKey) {
        propIdToName.set(propIdKey, optName);
      }

      const optValues: string[] = [];
      const rawValList = prop.skuPropertyValues || prop.propertyValues || prop.values;
      const valList = Array.isArray(rawValList) ? rawValList : [];

      for (const val of valList) {
        const valName = typeof val.propertyValueDisplayName === 'string'
          ? val.propertyValueDisplayName.trim()
          : typeof val.propertyValueName === 'string'
            ? val.propertyValueName.trim()
            : typeof val.name === 'string'
              ? val.name.trim()
              : typeof val.displayName === 'string'
                ? val.displayName.trim()
                : '';

        const propId = String(val.propertyValueId || val.propertyValueIdLong || val.id || '');

        if (valName) {
          optValues.push(valName);
          if (propId) {
            // Map propId to { optionName, valueName } for variant resolution
            propMap.set(propId, { optionName: optName, valueName: valName });
            if (propIdKey) {
              propMap.set(`${propIdKey}:${propId}`, { optionName: optName, valueName: valName });
            }
          }
        }
      }

      if (optValues.length > 0) {
        options.push({ name: optName, values: optValues });
      }
    }

    // Process variants from skuPriceList or alternate price lists
    const rawPriceList = activeSkuModule.skuPriceList || activeSkuModule.skuList || activeSkuModule.priceList;
    const priceList = Array.isArray(rawPriceList) ? rawPriceList : [];

    for (const skuItem of priceList) {
      const skuVal = skuItem.skuVal as Record<string, unknown> | undefined;
      const rawPropString = typeof skuItem.skuPropIds === 'string'
        ? skuItem.skuPropIds
        : typeof skuItem.skuAttr === 'string'
          ? skuItem.skuAttr
          : typeof skuItem.props === 'string'
            ? skuItem.props
            : '';
      const skuId = String(skuItem.skuId || skuItem.skuIdStr || skuItem.id || '');

      // Resolve variant price
      let vPrice = basePrice;
      if (skuVal) {
        const rawVal = skuVal.actSkuCalPrice ||
          skuVal.skuCalPrice ||
          skuVal.actSkuPrice ||
          skuVal.skuPrice ||
          (skuVal.skuAmount as Record<string, unknown>)?.value;
        if (rawVal) {
          const num = parseFloat(String(rawVal));
          if (!isNaN(num) && num > 0) {
            vPrice = num.toFixed(2);
          }
        }
      } else if (skuItem.price || skuItem.skuPrice) {
        const num = parseFloat(String(skuItem.price || skuItem.skuPrice));
        if (!isNaN(num) && num > 0) {
          vPrice = num.toFixed(2);
        }
      }

      // Resolve option combinations
      const optionValues: Record<string, string> = {};

      // Strategy 1: Parse from skuPropertyValues array directly on skuItem if present
      if (Array.isArray(skuItem.skuPropertyValues)) {
        for (const pv of skuItem.skuPropertyValues) {
          const pName = pv.skuPropertyName || pv.propertyName;
          const vName = pv.propertyValueDisplayName || pv.propertyValueName || pv.name;
          if (pName && vName) {
            optionValues[String(pName).trim()] = String(vName).trim();
          }
        }
      }

      // Strategy 2: Parse from skuPropIds or skuAttr (e.g. "14:10#Black;5:100#XL" or "10,100")
      if (Object.keys(optionValues).length === 0 && rawPropString) {
        const segments = rawPropString.split(/[;,]/);
        for (const seg of segments) {
          const cleanSeg = seg.trim();
          if (!cleanSeg) continue;

          // 1. Direct match in propMap
          if (propMap.has(cleanSeg)) {
            const resolved = propMap.get(cleanSeg)!;
            optionValues[resolved.optionName] = resolved.valueName;
            continue;
          }

          // 2. Match without #name (e.g. "14:10#Black" -> "14:10")
          const withoutHash = cleanSeg.split('#')[0].trim();
          if (propMap.has(withoutHash)) {
            const resolved = propMap.get(withoutHash)!;
            optionValues[resolved.optionName] = resolved.valueName;
            continue;
          }

          // 3. Match property value ID alone (after colon if present)
          const parts = withoutHash.split(':');
          const valId = parts[1] || parts[0];
          if (propMap.has(valId)) {
            const resolved = propMap.get(valId)!;
            optionValues[resolved.optionName] = resolved.valueName;
            continue;
          }

          // 4. Extract display name directly from "#DisplayName" if option is mapped
          if (cleanSeg.includes('#')) {
            const hashParts = cleanSeg.split('#');
            const propPart = hashParts[0].split(':')[0].trim();
            const displayName = hashParts[1]?.trim();
            const optName = propIdToName.get(propPart);
            if (optName && displayName) {
              optionValues[optName] = displayName;
            }
          }
        }
      }

      // Ensure that if options are defined, this variant has optionValues
      if (options.length > 0 && Object.keys(optionValues).length === 0) {
        // Fallback: assign first declared value of each option
        for (const opt of options) {
          optionValues[opt.name] = opt.values[0] || 'Default';
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

  // Shipping Cost from shippingModule or logisticsModule
  let shipping_cost: string | null = null;
  const shippingModule = (root.shippingModule ||
    root.logisticsModule ||
    root.deliveryModule ||
    root.shippingInfo) as Record<string, unknown> | undefined;

  if (shippingModule) {
    const freightAmount = (shippingModule.freightAmount ||
      shippingModule.generalFreightInfo) as Record<string, unknown> | undefined;

    if (shippingModule.freeShipping === true) {
      shipping_cost = '0.00';
    } else if (freightAmount) {
      const val = freightAmount.value ?? freightAmount.amount;
      if (typeof val === 'number') {
        shipping_cost = val.toFixed(2);
      } else if (typeof val === 'string') {
        const num = parseFloat(val);
        if (!isNaN(num)) shipping_cost = num.toFixed(2);
      } else if (typeof freightAmount.formattedAmount === 'string') {
        if (/free/i.test(freightAmount.formattedAmount)) {
          shipping_cost = '0.00';
        } else {
          const parsed = parsePriceAndCurrencyText(freightAmount.formattedAmount);
          if (parsed.price) shipping_cost = parsed.price;
        }
      }
    }
  }

  return {
    title,
    description,
    currency,
    price: basePrice,
    shipping_cost,
    images,
    options,
    variants,
  };
}
