import { describe, it, expect, beforeEach } from 'vitest';
import { extractFromJsonLd } from '../src/content/parsers/jsonld-parser.js';
import { extractFromScriptTags, parseAliExpressDataPayload } from '../src/content/parsers/script-parser.js';
import { extractFromDom } from '../src/content/parsers/dom-parser.js';
import { extractProductData } from '../src/content/orchestrator.js';

describe('AliExpress Parsers & Orchestrator (M3-02..M3-06, M3-11)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  describe('JSON-LD Parser', () => {
    it('extracts product title, image, price, and currency from schema.org JSON-LD', () => {
      const jsonLdContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Wireless Bluetooth Earbuds TWS',
        image: ['https://ae01.alicdn.com/kf/S123456.jpg'],
        description: 'Noise cancelling earbuds',
        offers: {
          '@type': 'Offer',
          price: '19.99',
          priceCurrency: 'USD',
          sku: 'SKU-EARBUD-01',
        },
      });

      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = jsonLdContent;
      document.head.appendChild(script);

      const parsed = extractFromJsonLd(document);

      expect(parsed).not.toBeNull();
      expect(parsed?.title).toBe('Wireless Bluetooth Earbuds TWS');
      expect(parsed?.price).toBe('19.99');
      expect(parsed?.currency).toBe('USD');
      expect(parsed?.images.length).toBe(1);
      expect(parsed?.images[0].url).toBe('https://ae01.alicdn.com/kf/S123456.jpg');
      expect(parsed?.variants.length).toBe(1);
      expect(parsed?.variants[0].sku).toBe('SKU-EARBUD-01');
    });
  });

  describe('Script Parser (AliExpress runParams / Modules)', () => {
    it('parses AliExpress module payload into options, variants, images, and prices', () => {
      const mockPayload = {
        data: {
          titleModule: {
            subject: 'Smart Fitness Tracker Watch',
          },
          imageModule: {
            imagePathList: [
              'https://ae01.alicdn.com/kf/S987654.jpg',
              'https://ae01.alicdn.com/kf/S987655.jpg',
            ],
          },
          priceModule: {
            minActivityAmount: {
              value: 12.5,
              currency: 'USD',
            },
          },
          skuModule: {
            productSKUPropertyList: [
              {
                skuPropertyName: 'Color',
                skuPropertyId: 14,
                skuPropertyValues: [
                  { propertyValueDisplayName: 'Black', propertyValueId: 10 },
                  { propertyValueDisplayName: 'Silver', propertyValueId: 20 },
                ],
              },
            ],
            skuPriceList: [
              {
                skuPropIds: '14:10',
                skuId: 'V-BLACK',
                skuVal: { actSkuCalPrice: '12.50' },
              },
              {
                skuPropIds: '14:20',
                skuId: 'V-SILVER',
                skuVal: { actSkuCalPrice: '14.50' },
              },
            ],
          },
        },
      };

      const parsed = parseAliExpressDataPayload(mockPayload);

      expect(parsed).not.toBeNull();
      expect(parsed?.title).toBe('Smart Fitness Tracker Watch');
      expect(parsed?.currency).toBe('USD');
      expect(parsed?.images.length).toBe(2);
      expect(parsed?.options.length).toBe(1);
      expect(parsed?.options[0].name).toBe('Color');
      expect(parsed?.options[0].values).toEqual(['Black', 'Silver']);
      expect(parsed?.variants.length).toBe(2);
      expect(parsed?.variants[0].option_values).toEqual({ Color: 'Black' });
      expect(parsed?.variants[0].price).toBe('12.50');
      expect(parsed?.variants[1].option_values).toEqual({ Color: 'Silver' });
      expect(parsed?.variants[1].price).toBe('14.50');
    });
  });

  describe('Rendered DOM Parser', () => {
    it('extracts visible title, price, currency, and gallery images from DOM', () => {
      document.body.innerHTML = `
        <div data-pl="product-title">
          <h1>Ergonomic Mechanical Keyboard RGB</h1>
        </div>
        <div class="price--current--H7sGzqb">
          <span>US $45.00</span>
        </div>
        <div class="image-view--previewBox--Gk_f0Y1">
          <img src="https://ae01.alicdn.com/kf/Skeyboard1.jpg">
          <img src="https://ae01.alicdn.com/kf/Skeyboard2.jpg">
        </div>
        <div id="product-description">
          <p>Full mechanical switches with RGB backlight.</p>
        </div>
      `;

      const parsed = extractFromDom(document);

      expect(parsed.title).toBe('Ergonomic Mechanical Keyboard RGB');
      expect(parsed.price).toBe('45.00');
      expect(parsed.currency).toBe('USD');
      expect(parsed.images.length).toBe(2);
      expect(parsed.description).toContain('Full mechanical switches');
      expect(parsed.variants.length).toBe(1);
      expect(parsed.variants[0].price).toBe('45.00');
    });
  });

  describe('Multi-Strategy Orchestrator & Integrity Rules', () => {
    const validUrl = 'https://www.aliexpress.com/item/1005006123456789.html';

    it('successfully extracts a complete ExtractedProduct', async () => {
      document.head.innerHTML = `
        <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "USB-C Fast Charging Cable",
            "image": "https://ae01.alicdn.com/kf/Scable1.jpg",
            "offers": { "price": "4.99", "priceCurrency": "USD" }
          }
        </script>
      `;

      const result = await extractProductData(document, validUrl);

      expect(result.success).toBe(true);
      expect(result.product).toBeDefined();
      expect(result.product?.source_product_id).toBe('1005006123456789');
      expect(result.product?.title).toBe('USB-C Fast Charging Cable');
      expect(result.product?.source_currency).toBe('USD');
      expect(result.product?.variants[0].price).toBe('4.99');
    });

    it('rejects products with more than 3 options without silent data loss (F-04)', async () => {
      const fourOptionsPayload = {
        titleModule: { subject: 'Customized Jacket' },
        imageModule: { imagePathList: ['https://ae01.alicdn.com/kf/Sjacket.jpg'] },
        priceModule: { minAmount: { value: 50, currency: 'USD' } },
        skuModule: {
          productSKUPropertyList: [
            { skuPropertyName: 'Color', skuPropertyValues: [{ propertyValueDisplayName: 'Black' }] },
            { skuPropertyName: 'Size', skuPropertyValues: [{ propertyValueDisplayName: 'L' }] },
            { skuPropertyName: 'Material', skuPropertyValues: [{ propertyValueDisplayName: 'Leather' }] },
            { skuPropertyName: 'Lining', skuPropertyValues: [{ propertyValueDisplayName: 'Wool' }] },
          ],
          skuPriceList: [
            { skuPropIds: '1:1', skuVal: { actSkuCalPrice: '50.00' } },
          ],
        },
      };

      const script = document.createElement('script');
      script.textContent = `window.runParams = ${JSON.stringify(fourOptionsPayload)};`;
      document.body.appendChild(script);

      const result = await extractProductData(document, validUrl);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNSUPPORTED_PRODUCT_OPTIONS');
      expect(result.error?.message).toContain('Shopify supports a maximum of 3 options');
    });

    it('rejects foreign URLs', async () => {
      const result = await extractProductData(document, 'https://amazon.com/item/123');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });
  });
});
