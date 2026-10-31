import { describe, it, expect } from 'vitest';
import { calculateSellingPrice, calculatePriceRange } from '../src/shared/pricing.js';

describe('Popup Decimal-Safe Pricing Calculations (M4-06, PR-01..PR-08)', () => {
  it('calculates standard 30% markup (PR-01)', () => {
    expect(calculateSellingPrice('10.00', 30)).toBe('13.00');
  });

  it('calculates 0% markup (PR-02)', () => {
    expect(calculateSellingPrice('10.00', 0)).toBe('10.00');
  });

  it('calculates 100% markup (PR-03)', () => {
    expect(calculateSellingPrice('15.50', 100)).toBe('31.00');
  });

  it('performs commercial half-up rounding on fractional cents (PR-04)', () => {
    // 0.99 * 1.33 = 1.3167 -> 1.32
    expect(calculateSellingPrice('0.99', 33)).toBe('1.32');
  });

  it('handles half-way threshold rounding (PR-05)', () => {
    // 10.05 * 1.05 = 10.5525 -> 10.55
    expect(calculateSellingPrice('10.05', 5)).toBe('10.55');
  });

  it('handles small cent values (PR-06)', () => {
    expect(calculateSellingPrice('0.01', 100)).toBe('0.02');
  });

  it('handles maximum markup bound of 1000% (PR-07)', () => {
    expect(calculateSellingPrice('5.00', 1000)).toBe('55.00');
  });

  it('handles price range for variants with differing prices (PR-08)', () => {
    const variants = [
      { price: '12.99' },
      { price: '15.99' },
      { price: '18.99' },
    ];

    const range = calculatePriceRange(variants, 30);
    expect(range.isRange).toBe(true);
    expect(range.minPrice).toBe('16.89'); // 12.99 * 1.3 = 16.887 -> 16.89
    expect(range.maxPrice).toBe('24.69'); // 18.99 * 1.3 = 24.687 -> 24.69
  });

  it('returns single price when all variants have identical prices', () => {
    const variants = [
      { price: '15.00' },
      { price: '15.00' },
    ];

    const range = calculatePriceRange(variants, 20);
    expect(range.isRange).toBe(false);
    expect(range.minPrice).toBe('18.00');
    expect(range.maxPrice).toBe('18.00');
  });

  it('adds shipping cost to source cost to calculate total supplier cost before markup', () => {
    // Item cost $10.00, Shipping $3.50 -> Total supplier cost $13.50
    // Markup 50% -> 13.50 * 1.50 = 20.25
    expect(calculateSellingPrice('10.00', 50, '3.50')).toBe('20.25');

    // Free shipping (0.00) preserves item base cost
    expect(calculateSellingPrice('10.00', 50, '0.00')).toBe('15.00');
    expect(calculateSellingPrice('10.00', 50, 0)).toBe('15.00');

    // Commercial half-up rounding with shipping
    // Item 12.49 + Shipping 2.50 = 14.99 * 1.33 = 19.9367 -> 19.94
    expect(calculateSellingPrice('12.49', 33, '2.50')).toBe('19.94');
  });

  it('computes total supplier cost range with shipping in calculatePriceRange', () => {
    const variants = [
      { price: '10.00' },
      { price: '20.00' },
    ];

    const range = calculatePriceRange(variants, 30, '4.00');
    expect(range.isRange).toBe(true);
    // Min total cost: 10 + 4 = 14.00; Max total cost: 20 + 4 = 24.00
    expect(range.minTotalCost).toBe('14.00');
    expect(range.maxTotalCost).toBe('24.00');
    // Min selling price: 14 * 1.3 = 18.20; Max selling price: 24 * 1.3 = 31.20
    expect(range.minPrice).toBe('18.20');
    expect(range.maxPrice).toBe('31.20');
  });
});
