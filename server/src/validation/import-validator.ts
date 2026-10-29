export interface ImportImageInput {
  url: string;
  alt?: string;
}

export interface ImportOptionInput {
  name: string;
  values: string[];
}

export interface ImportVariantInput {
  option_values?: Record<string, string>;
  price: string | number;
  sku?: string;
}

export interface ImportRequestBody {
  source_product_id: string;
  source_url: string;
  source_currency: string;
  title: string;
  description_html?: string;
  images: ImportImageInput[];
  options?: ImportOptionInput[];
  variants: ImportVariantInput[];
  markup_percentage: number;
}

export interface ValidationErrorField {
  field: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errorCode?: 'VALIDATION_ERROR' | 'CURRENCY_MISMATCH' | 'UNSUPPORTED_PRODUCT';
  errorMessage?: string;
  fields?: ValidationErrorField[];
}

const ALLOWED_ALIEXPRESS_HOSTS = [
  'aliexpress.com',
  'aliexpress.ru',
  'aliexpress.us',
  'aliexpress.fr',
  'aliexpress.es',
  'aliexpress.it',
  'aliexpress.de',
  'aliexpress.pl',
  'aliexpress.com.br',
  'aliexpress.co.kr',
  'aliexpress.co.uk',
];

function isAllowedAliExpressUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_ALIEXPRESS_HOSTS.some(
      allowed => host === allowed || host.endsWith('.' + allowed)
    );
  } catch {
    return false;
  }
}

function isAllowedCdnUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    if (parsed.username || parsed.password) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === 'alicdn.com' || host.endsWith('.alicdn.com');
  } catch {
    return false;
  }
}

export function validateImportPayload(
  body: unknown,
  storeCurrency?: string | null
): ValidationResult {
  const fields: ValidationErrorField[] = [];

  if (!body || typeof body !== 'object') {
    return {
      isValid: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'Invalid request body: expected an object.',
      fields: [{ field: 'body', message: 'Request body must be a JSON object.' }],
    };
  }

  const data = body as Partial<ImportRequestBody>;

  // 1. source_product_id
  if (!data.source_product_id || typeof data.source_product_id !== 'string') {
    fields.push({ field: 'source_product_id', message: 'source_product_id is required.' });
  } else if (!/^\d+$/.test(data.source_product_id.trim())) {
    fields.push({ field: 'source_product_id', message: 'source_product_id must contain only numeric characters.' });
  }

  // 2. source_url
  if (!data.source_url || typeof data.source_url !== 'string') {
    fields.push({ field: 'source_url', message: 'source_url is required.' });
  } else if (!isAllowedAliExpressUrl(data.source_url)) {
    fields.push({ field: 'source_url', message: 'source_url must be an HTTPS AliExpress URL.' });
  }

  // 3. title
  if (!data.title || typeof data.title !== 'string') {
    fields.push({ field: 'title', message: 'title is required.' });
  } else if (data.title.trim().length === 0 || data.title.length > 255) {
    fields.push({ field: 'title', message: 'title must be between 1 and 255 characters.' });
  }

  // 4. description_html (optional)
  if (data.description_html !== undefined && typeof data.description_html === 'string') {
    if (data.description_html.length > 50_000) {
      fields.push({ field: 'description_html', message: 'description_html cannot exceed 50,000 characters.' });
    }
  }

  // 5. markup_percentage
  if (typeof data.markup_percentage !== 'number' || isNaN(data.markup_percentage)) {
    fields.push({ field: 'markup_percentage', message: 'markup_percentage must be a valid number.' });
  } else if (data.markup_percentage < 0 || data.markup_percentage > 1000) {
    fields.push({ field: 'markup_percentage', message: 'markup_percentage must be between 0 and 1000.' });
  }

  // 6. options
  if (data.options !== undefined) {
    if (!Array.isArray(data.options)) {
      fields.push({ field: 'options', message: 'options must be an array.' });
    } else if (data.options.length > 3) {
      return {
        isValid: false,
        errorCode: 'UNSUPPORTED_PRODUCT',
        errorMessage: 'Shopify supports a maximum of 3 option dimensions per product.',
        fields: [{ field: 'options', message: 'Product has more than 3 options.' }],
      };
    } else {
      for (let i = 0; i < data.options.length; i++) {
        const opt = data.options[i];
        if (!opt || typeof opt.name !== 'string' || opt.name.trim().length === 0) {
          fields.push({ field: `options[${i}].name`, message: 'Option name cannot be empty.' });
        }
        if (!Array.isArray(opt?.values) || opt.values.length === 0) {
          fields.push({ field: `options[${i}].values`, message: 'Option values must be a non-empty array.' });
        }
      }
    }
  }

  // 7. variants
  if (!Array.isArray(data.variants) || data.variants.length === 0) {
    fields.push({ field: 'variants', message: 'At least one variant is required.' });
  } else if (data.variants.length > 2000) {
    return {
      isValid: false,
      errorCode: 'UNSUPPORTED_PRODUCT',
      errorMessage: 'Products with more than 2,000 variants exceed Shopify limits.',
      fields: [{ field: 'variants', message: 'Exceeds 2,000 variant limit.' }],
    };
  } else {
    for (let i = 0; i < data.variants.length; i++) {
      const v = data.variants[i];
      if (!v || v.price === undefined || v.price === null) {
        fields.push({ field: `variants[${i}].price`, message: 'Variant price is required.' });
      } else {
        const num = typeof v.price === 'number' ? v.price : parseFloat(String(v.price).replace(/,/g, '.'));
        if (isNaN(num) || num <= 0 || !Number.isFinite(num)) {
          fields.push({ field: `variants[${i}].price`, message: 'Variant price must be a positive number.' });
        }
      }
    }
  }

  // 8. images
  if (!Array.isArray(data.images) || data.images.length === 0) {
    fields.push({ field: 'images', message: 'At least one product image is required.' });
  } else if (data.images.length > 50) {
    fields.push({ field: 'images', message: 'A maximum of 50 images is permitted.' });
  } else {
    for (let i = 0; i < data.images.length; i++) {
      const img = data.images[i];
      if (!img || !img.url || typeof img.url !== 'string') {
        fields.push({ field: `images[${i}].url`, message: 'Image URL is required.' });
      } else if (!isAllowedCdnUrl(img.url)) {
        fields.push({ field: `images[${i}].url`, message: 'Image URL must be an HTTPS alicdn.com URL without embedded credentials.' });
      }
    }
  }

  // 9. source_currency & currency match
  if (!data.source_currency || typeof data.source_currency !== 'string') {
    fields.push({ field: 'source_currency', message: 'source_currency is required.' });
  } else {
    const curr = data.source_currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(curr)) {
      fields.push({ field: 'source_currency', message: 'source_currency must be a valid 3-letter ISO 4217 code.' });
    } else if (storeCurrency && curr !== storeCurrency.toUpperCase()) {
      return {
        isValid: false,
        errorCode: 'CURRENCY_MISMATCH',
        errorMessage: `Source currency (${curr}) does not match Shopify store currency (${storeCurrency.toUpperCase()}).`,
        fields: [{ field: 'source_currency', message: `Currency mismatch: AliExpress is ${curr}, store is ${storeCurrency.toUpperCase()}.` }],
      };
    }
  }

  if (fields.length > 0) {
    return {
      isValid: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'Product data validation failed.',
      fields,
    };
  }

  return { isValid: true };
}
