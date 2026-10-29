/**
 * Decimal-Safe Price & Markup Calculations
 * Enforces integer cent calculations and commercial half-up rounding to prevent binary floating-point errors.
 */

/**
 * Calculates the selling price given a source cost string and a percentage markup.
 * Formula: Selling Price = Source Cost × (1 + Markup% / 100)
 * Uses integer arithmetic on cents with half-up rounding.
 *
 * @param sourceCost Formatted price string (e.g. "12.99")
 * @param markupPercent Percentage (e.g. 30 for 30%)
 * @returns Formatted decimal string (e.g. "16.89")
 */
export function calculateSellingPrice(sourceCost: string, markupPercent: number): string {
  const costNum = parseFloat(sourceCost);
  if (isNaN(costNum) || costNum <= 0) {
    return '0.00';
  }

  const validMarkup = isNaN(markupPercent) || markupPercent < 0 ? 0 : markupPercent;

  // Convert to integer cents
  const costCents = Math.round(costNum * 100);

  // Apply markup in cents with commercial half-up rounding:
  // markedUpCents = costCents * (1 + markup / 100)
  // = costCents + (costCents * markup / 100)
  const markupFactor = 1 + validMarkup / 100;
  const markedUpCents = Math.round(costCents * markupFactor);

  return (markedUpCents / 100).toFixed(2);
}

/**
 * Calculates price range for multi-variant products.
 * If min and max prices are identical, returns single price.
 * Otherwise returns formatted range: "$min – $max".
 */
export function calculatePriceRange(
  variants: Array<{ price: string }>,
  markupPercent: number
): { minPrice: string; maxPrice: string; isRange: boolean } {
  if (!variants || variants.length === 0) {
    return { minPrice: '0.00', maxPrice: '0.00', isRange: false };
  }

  let min = Infinity;
  let max = -Infinity;

  for (const v of variants) {
    const p = parseFloat(v.price);
    if (!isNaN(p) && p > 0) {
      if (p < min) min = p;
      if (p > max) max = p;
    }
  }

  if (min === Infinity || max === -Infinity) {
    return { minPrice: '0.00', maxPrice: '0.00', isRange: false };
  }

  const markedMin = calculateSellingPrice(min.toFixed(2), markupPercent);
  const markedMax = calculateSellingPrice(max.toFixed(2), markupPercent);

  return {
    minPrice: markedMin,
    maxPrice: markedMax,
    isRange: markedMin !== markedMax,
  };
}
