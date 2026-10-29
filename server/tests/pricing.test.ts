import { describe, it, expect } from 'vitest';
import {
  parsePriceToCents,
  centsToFormattedPrice,
  calculateSellingPrice,
} from '../src/services/pricing.js';

describe('Server Pricing (Decimal-safe cent arithmetic)', () => {
  it('parses valid numeric and string prices to integer cents', () => {
    expect(parsePriceToCents(12.99)).toBe(1299);
    expect(parsePriceToCents('12.99')).toBe(1299);
    expect(parsePriceToCents('12,99')).toBe(1299); // European comma
    expect(parsePriceToCents(0.01)).toBe(1);
    expect(parsePriceToCents(100)).toBe(10000);
  });

  it('rejects invalid or negative prices', () => {
    expect(() => parsePriceToCents(-5)).toThrow('Invalid non-finite or negative price');
    expect(() => parsePriceToCents('-5.00')).toThrow('Invalid price string format');
    expect(() => parsePriceToCents('invalid')).toThrow('Invalid price string format');
  });

  it('formats cents to standard decimal string', () => {
    expect(centsToFormattedPrice(1299)).toBe('12.99');
    expect(centsToFormattedPrice(5)).toBe('0.05');
    expect(centsToFormattedPrice(50)).toBe('0.50');
    expect(centsToFormattedPrice(10000)).toBe('100.00');
  });

  it('calculates selling price with percentage markup using commercial half-up rounding', () => {
    // 10.00 with 30% markup = 13.00
    expect(calculateSellingPrice('10.00', 30)).toBe('13.00');

    // 19.99 with 25% markup = 19.99 * 1.25 = 24.9875 -> 24.99
    expect(calculateSellingPrice('19.99', 25)).toBe('24.99');

    // 10.05 with 15% markup = 10.05 * 1.15 = 11.5575 -> 11.56
    expect(calculateSellingPrice(10.05, 15)).toBe('11.56');

    // 0% markup preserves original price
    expect(calculateSellingPrice('49.95', 0)).toBe('49.95');
  });

  it('rejects negative markup percentage', () => {
    expect(() => calculateSellingPrice('10.00', -10)).toThrow('Markup percentage cannot be negative');
  });
});
