/**
 * Currency Normalization & Price Parsing Utilities
 */

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  'US $': 'USD',
  '$': 'USD',
  'USD': 'USD',
  '€': 'EUR',
  'EUR': 'EUR',
  '£': 'GBP',
  'GBP': 'GBP',
  'C$': 'CAD',
  'CAD': 'CAD',
  'AU $': 'AUD',
  'A$': 'AUD',
  'AUD': 'AUD',
  '¥': 'JPY',
  'JPY': 'JPY',
  'zł': 'PLN',
  'PLN': 'PLN',
  'R$': 'BRL',
  'BRL': 'BRL',
  '₽': 'RUB',
  'RUB': 'RUB',
  'CHF': 'CHF',
  'SEK': 'SEK',
  'NZD': 'NZD',
  'SGD': 'SGD',
  'HKD': 'HKD',
};

/**
 * Normalizes a raw currency symbol or code to a standard 3-letter uppercase ISO 4217 code.
 */
export function normalizeCurrency(rawCurrency: string | null | undefined): string | null {
  if (!rawCurrency || typeof rawCurrency !== 'string') return null;

  const trimmed = rawCurrency.trim();

  // Direct map lookup
  if (CURRENCY_SYMBOL_MAP[trimmed]) {
    return CURRENCY_SYMBOL_MAP[trimmed];
  }

  const upper = trimmed.toUpperCase();
  if (CURRENCY_SYMBOL_MAP[upper]) {
    return CURRENCY_SYMBOL_MAP[upper];
  }

  // If already standard 3-letter ISO code
  if (/^[A-Z]{3}$/.test(upper)) {
    return upper;
  }

  return null;
}

export interface ParsedPriceText {
  price: string | null;
  currency: string | null;
}

/**
 * Parses raw text containing a price and currency (e.g. "US $12.99", "€ 14,50", "19.99 USD")
 */
export function parsePriceAndCurrencyText(text: string): ParsedPriceText {
  if (!text || typeof text !== 'string') {
    return { price: null, currency: null };
  }

  const cleaned = text.trim();

  let detectedCurrency: string | null = null;

  // Check known currency symbols/codes in text
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_MAP)) {
    if (cleaned.includes(symbol)) {
      detectedCurrency = code;
      break;
    }
  }

  // Extract numeric portion: handle both 12.99 and 12,99
  // Match digits with optional dot or comma decimal separator
  const match = cleaned.match(/(\d+[\d\s.,]*\d|\d+)/);
  if (!match) {
    return { price: null, currency: detectedCurrency };
  }

  let numStr = match[1].replace(/\s/g, '');

  // Handle European comma format (e.g. 14,50 or 1.234,56)
  if (numStr.includes(',') && !numStr.includes('.')) {
    numStr = numStr.replace(',', '.');
  } else if (numStr.includes(',') && numStr.includes('.')) {
    // If dot comes before comma (1.234,56), dot is thousands, comma is decimal
    if (numStr.indexOf('.') < numStr.indexOf(',')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234.56
      numStr = numStr.replace(/,/g, '');
    }
  }

  // Parse float and format to 2 decimal places
  const val = parseFloat(numStr);
  if (isNaN(val) || val <= 0) {
    return { price: null, currency: detectedCurrency };
  }

  return {
    price: val.toFixed(2),
    currency: detectedCurrency,
  };
}
