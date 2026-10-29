import { describe, it, expect } from 'vitest';
import { normalizeCurrency, parsePriceAndCurrencyText } from '../src/content/currency.js';

describe('Currency & Price Parsing (M3-07, CR-01..CR-06)', () => {
  describe('normalizeCurrency', () => {
    it('normalizes currency symbols and codes to standard 3-letter ISO code', () => {
      expect(normalizeCurrency('US $')).toBe('USD');
      expect(normalizeCurrency('$')).toBe('USD');
      expect(normalizeCurrency('USD')).toBe('USD');
      expect(normalizeCurrency('€')).toBe('EUR');
      expect(normalizeCurrency('EUR')).toBe('EUR');
      expect(normalizeCurrency('£')).toBe('GBP');
      expect(normalizeCurrency('GBP')).toBe('GBP');
      expect(normalizeCurrency('C$')).toBe('CAD');
      expect(normalizeCurrency('AU $')).toBe('AUD');
      expect(normalizeCurrency('¥')).toBe('JPY');
      expect(normalizeCurrency('JPY')).toBe('JPY');
    });

    it('returns null for unrecognized currencies', () => {
      expect(normalizeCurrency('UNKNOWN')).toBeNull();
      expect(normalizeCurrency('')).toBeNull();
      expect(normalizeCurrency(null)).toBeNull();
    });
  });

  describe('parsePriceAndCurrencyText', () => {
    it('parses US dollar strings', () => {
      const res = parsePriceAndCurrencyText('US $12.99');
      expect(res.price).toBe('12.99');
      expect(res.currency).toBe('USD');
    });

    it('parses European comma currency strings', () => {
      const res = parsePriceAndCurrencyText('14,50 €');
      expect(res.price).toBe('14.50');
      expect(res.currency).toBe('EUR');
    });

    it('parses thousands separators properly', () => {
      const res = parsePriceAndCurrencyText('1,234.50 USD');
      expect(res.price).toBe('1234.50');
      expect(res.currency).toBe('USD');
    });

    it('parses plain numeric string without symbol', () => {
      const res = parsePriceAndCurrencyText('24.90');
      expect(res.price).toBe('24.90');
      expect(res.currency).toBeNull();
    });

    it('returns null price for non-positive or empty inputs', () => {
      expect(parsePriceAndCurrencyText('0.00').price).toBeNull();
      expect(parsePriceAndCurrencyText('FREE').price).toBeNull();
      expect(parsePriceAndCurrencyText('').price).toBeNull();
    });
  });
});
