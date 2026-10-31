import { describe, it, expect } from 'vitest';
import { buildProductSetPayload } from '../src/shopify/mutations/product-set.js';
import type { ImportRequestBody } from '../src/validation/import-validator.js';

describe('Shopify productSet Mutation Payload Builder', () => {
  const sampleData: ImportRequestBody = {
    source_product_id: '100500987654321',
    source_url: 'https://www.aliexpress.com/item/100500987654321.html',
    source_currency: 'USD',
    title: 'Minimalist Mechanical Keyboard',
    description_html: '<p>High quality mechanical keyboard</p><script>evil()</script>',
    markup_percentage: 20,
    images: [
      { url: 'https://ae01.alicdn.com/kf/img1.jpg', alt: 'Keyboard Front' },
      { url: 'https://ae01.alicdn.com/kf/img2.jpg' },
    ],
    options: [
      { name: 'Switch Type', values: ['Red', 'Brown'] },
    ],
    variants: [
      {
        option_values: { 'Switch Type': 'Red' },
        price: '50.00',
        sku: 'KB-RED',
      },
      {
        option_values: { 'Switch Type': 'Brown' },
        price: '55.00',
        sku: 'KB-BRN',
      },
    ],
  };

  it('strictly sets product status to DRAFT (never ACTIVE)', () => {
    const payload = buildProductSetPayload(sampleData);
    expect(payload.input.status).toBe('DRAFT');
    expect(payload.synchronous).toBe(true);
  });

  it('attaches source tracking metafields for duplicate checking and reconciliation', () => {
    const payload = buildProductSetPayload(sampleData);
    const metafields = payload.input.metafields;

    const sourceIdMf = metafields.find(
      m => m.namespace === 'custom' && m.key === 'aliexpress_source_id'
    );
    expect(sourceIdMf).toBeDefined();
    expect(sourceIdMf?.value).toBe('100500987654321');
    expect(sourceIdMf?.type).toBe('single_line_text_field');

    const sourceUrlMf = metafields.find(
      m => m.namespace === 'custom' && m.key === 'aliexpress_source_url'
    );
    expect(sourceUrlMf).toBeDefined();
    expect(sourceUrlMf?.value).toBe('https://www.aliexpress.com/item/100500987654321.html');
    expect(sourceUrlMf?.type).toBe('url');
  });

  it('sanitizes description HTML and strips malicious scripts', () => {
    const payload = buildProductSetPayload(sampleData);
    expect(payload.input.descriptionHtml).toBe('<p>High quality mechanical keyboard</p>');
    expect(payload.input.descriptionHtml).not.toContain('script');
    expect(payload.input.descriptionHtml).not.toContain('evil');
  });

  it('calculates variant selling prices with markup using half-up rounding', () => {
    const payload = buildProductSetPayload(sampleData);
    const variants = payload.input.variants;

    // 50.00 + 20% = 60.00
    expect(variants[0].price).toBe('60.00');
    expect(variants[0].optionValues).toEqual([{ optionName: 'Switch Type', name: 'Red' }]);

    // 55.00 + 20% = 66.00
    expect(variants[1].price).toBe('66.00');
    expect(variants[1].optionValues).toEqual([{ optionName: 'Switch Type', name: 'Brown' }]);
  });

  it('maps images to files array with originalSource and contentType IMAGE', () => {
    const payload = buildProductSetPayload(sampleData);
    const files = payload.input.files;

    expect(files).toHaveLength(2);
    expect(files?.[0].originalSource).toBe('https://ae01.alicdn.com/kf/img1.jpg');
    expect(files?.[0].alt).toBe('Keyboard Front');
    expect(files?.[0].contentType).toBe('IMAGE');

    expect(files?.[1].originalSource).toBe('https://ae01.alicdn.com/kf/img2.jpg');
    expect(files?.[1].alt).toContain('Minimalist Mechanical Keyboard');
  });

  it('assigns Default Title option and variant option values when product has no custom options', () => {
    const dataWithoutOptions: ImportRequestBody = {
      source_product_id: '999888',
      source_url: 'https://www.aliexpress.com/item/999888.html',
      source_currency: 'USD',
      title: 'Simple Watch',
      description_html: '<p>A simple watch</p>',
      markup_percentage: 10,
      variants: [
        {
          price: '20.00',
        },
      ],
    };

    const payload = buildProductSetPayload(dataWithoutOptions);
    expect(payload.input.productOptions).toEqual([
      {
        name: 'Title',
        values: [{ name: 'Default Title' }],
      },
    ]);
    expect(payload.input.variants[0].optionValues).toEqual([
      {
        optionName: 'Title',
        name: 'Default Title',
      },
    ]);
  });
});
