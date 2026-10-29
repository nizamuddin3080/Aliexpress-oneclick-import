/**
 * Decimal-safe money arithmetic utilities for the server.
 * Uses integer cent arithmetic and commercial half-up rounding
 * to prevent IEEE-754 floating-point inaccuracies.
 */

/**
 * Parses a price representation into integer cents.
 * Handles both number and string forms (e.g. "12.99" -> 1299).
 */
export function parsePriceToCents(price: string | number): number {
  if (typeof price === 'number') {
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Invalid non-finite or negative price: ${price}`);
    }
    return Math.round(price * 100);
  }

  const trimmed = price.trim().replace(/,/g, '.');
  const num = parseFloat(trimmed);
  if (isNaN(num) || num < 0 || !Number.isFinite(num)) {
    throw new Error(`Invalid price string format: "${price}"`);
  }

  return Math.round(num * 100);
}

/**
 * Converts integer cents back to formatted decimal string (e.g. 1299 -> "12.99").
 */
export function centsToFormattedPrice(cents: number): string {
  if (cents < 0) {
    throw new Error(`Negative cents not permitted: ${cents}`);
  }
  const dollars = Math.floor(cents / 100);
  const remainingCents = cents % 100;
  return `${dollars}.${remainingCents.toString().padStart(2, '0')}`;
}

/**
 * Calculates selling price given a base price and markup percentage.
 * Formula: sellingPrice = basePrice * (1 + markupPercentage / 100)
 * Uses commercial half-up rounding at the cent level.
 *
 * @param basePrice Base price as number or string (e.g. 10.00 or "10.00")
 * @param markupPercentage Markup percentage (e.g. 30 for 30%)
 * @returns Formatted price string with exactly two decimal places (e.g. "13.00")
 */
export function calculateSellingPrice(
  basePrice: string | number,
  markupPercentage: number
): string {
  if (markupPercentage < 0) {
    throw new Error(`Markup percentage cannot be negative: ${markupPercentage}`);
  }

  const baseCents = parsePriceToCents(basePrice);
  const factor = 1 + markupPercentage / 100;
  const sellingCents = Math.round(baseCents * factor);

  return centsToFormattedPrice(sellingCents);
}
