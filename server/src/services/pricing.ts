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
 * Calculates selling price given a base price, markup percentage, and optional shipping cost.
 * Formula:
 *   totalSupplierCost = basePrice + shippingCost
 *   sellingPrice = totalSupplierCost * (1 + markupPercentage / 100)
 * Uses commercial half-up rounding at the cent level.
 *
 * @param basePrice Base item price as number or string (e.g. 10.00 or "10.00")
 * @param markupPercentage Markup percentage (e.g. 30 for 30%)
 * @param shippingCost Optional shipping cost (e.g. 3.50 or "3.50", defaults to 0)
 * @returns Formatted price string with exactly two decimal places (e.g. "17.55")
 */
export function calculateSellingPrice(
  basePrice: string | number,
  markupPercentage: number,
  shippingCost: string | number = 0
): string {
  if (markupPercentage < 0) {
    throw new Error(`Markup percentage cannot be negative: ${markupPercentage}`);
  }

  const baseCents = parsePriceToCents(basePrice);
  const shippingCents = shippingCost ? parsePriceToCents(shippingCost) : 0;
  const totalSupplierCostCents = baseCents + shippingCents;

  const factor = 1 + markupPercentage / 100;
  const sellingCents = Math.round(totalSupplierCostCents * factor);

  return centsToFormattedPrice(sellingCents);
}
