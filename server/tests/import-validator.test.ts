import { describe, it, expect } from 'vitest';
import { validateImportPayload, type ImportRequestBody } from '../src/validation/import-validator.js';

describe('Server Import Payload Validator', () => {
  const validPayload: ImportRequestBody = {
    source_product_id: '1005006123456789',
    source_url: 'https://www.aliexpress.com/item/1005006123456789.html',
    source_currency: 'USD',
    title: 'Wireless Bluetooth Earbuds',
    description_html: '<p>High quality sound</p>',
    markup_percentage: 30,
    images: [
      { url: 'https://ae01.alicdn.com/kf/image1.jpg', alt: 'Main view' },
      { url: 'https://ae01.alicdn.com/kf/image2.jpg' },
    ],
    options: [
      { name: 'Color', values: ['Black', 'White'] },
      { name: 'Style', values: ['Standard'] },
    ],
    variants: [
      { option_values: { Color: 'Black', Style: 'Standard' }, price: '15.00', sku: 'BT-BLK' },
      { option_values: { Color: 'White', Style: 'Standard' }, price: '15.00', sku: 'BT-WHT' },
    ],
  };

  it('approves a completely valid payload matching store currency', () => {
    const res = validateImportPayload(validPayload, 'USD');
    expect(res.isValid).toBe(true);
    expect(res.fields).toBeUndefined();
  });

  it('rejects currency mismatch against store currency', () => {
    const res = validateImportPayload(validPayload, 'EUR');
    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe('CURRENCY_MISMATCH');
    expect(res.errorMessage).toContain('EUR');
  });

  it('rejects products with more than 3 options (UNSUPPORTED_PRODUCT)', () => {
    const invalidPayload = {
      ...validPayload,
      options: [
        { name: 'Color', values: ['Red'] },
        { name: 'Size', values: ['Large'] },
        { name: 'Material', values: ['Cotton'] },
        { name: 'Extra', values: ['Option4'] }, // 4th option!
      ],
    };
    const res = validateImportPayload(invalidPayload, 'USD');
    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe('UNSUPPORTED_PRODUCT');
    expect(res.errorMessage).toContain('maximum of 3 option dimensions');
  });

  it('rejects products exceeding 2,000 variants', () => {
    const variants = Array.from({ length: 2001 }, (_, i) => ({
      price: '10.00',
      sku: `SKU-${i}`,
    }));
    const res = validateImportPayload({ ...validPayload, variants }, 'USD');
    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe('UNSUPPORTED_PRODUCT');
  });

  it('rejects non-numeric source_product_id', () => {
    const res = validateImportPayload({ ...validPayload, source_product_id: 'abc123xyz' }, 'USD');
    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe('VALIDATION_ERROR');
    expect(res.fields?.some(f => f.field === 'source_product_id')).toBe(true);
  });

  it('rejects non-HTTPS and non-AliExpress source URLs', () => {
    const resHttp = validateImportPayload({ ...validPayload, source_url: 'http://www.aliexpress.com/item/123.html' }, 'USD');
    expect(resHttp.isValid).toBe(false);

    const resForeign = validateImportPayload({ ...validPayload, source_url: 'https://www.evil-site.com/item/123.html' }, 'USD');
    expect(resForeign.isValid).toBe(false);
  });

  it('rejects image URLs that are not HTTPS or not on alicdn.com allowlist', () => {
    const resBadHost = validateImportPayload(
      {
        ...validPayload,
        images: [{ url: 'https://evil.com/pic.jpg' }],
      },
      'USD'
    );
    expect(resBadHost.isValid).toBe(false);
    expect(resBadHost.fields?.some(f => f.field === 'images[0].url')).toBe(true);

    const resCreds = validateImportPayload(
      {
        ...validPayload,
        images: [{ url: 'https://user:pass@ae01.alicdn.com/pic.jpg' }],
      },
      'USD'
    );
    expect(resCreds.isValid).toBe(false);
  });

  it('rejects negative or invalid variant prices', () => {
    const res = validateImportPayload(
      {
        ...validPayload,
        variants: [{ price: '-12.00' }],
      },
      'USD'
    );
    expect(res.isValid).toBe(false);
    expect(res.fields?.some(f => f.field === 'variants[0].price')).toBe(true);
  });

  it('rejects negative markup percentage or markup > 1000', () => {
    const resNeg = validateImportPayload({ ...validPayload, markup_percentage: -5 }, 'USD');
    expect(resNeg.isValid).toBe(false);

    const resHigh = validateImportPayload({ ...validPayload, markup_percentage: 1500 }, 'USD');
    expect(resHigh.isValid).toBe(false);
  });
});
