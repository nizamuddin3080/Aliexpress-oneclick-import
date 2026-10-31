/**
 * Decimal-Safe Price & Markup Calculations
 * Enforces integer cent calculations and commercial half-up rounding to prevent binary floating-point errors.
 */

/**
 * Calculates the selling price given a source cost string, a percentage markup, and an optional shipping cost.
 * Formula:
 *   Total Supplier Cost = Source Cost + Shipping Cost
 *   Selling Price = Total Supplier Cost × (1 + Markup% / 100)
 * Uses integer arithmetic on cents with half-up rounding.
 *
 * @param sourceCost Formatted item price string (e.g. "12.99")
 * @param markupPercent Percentage (e.g. 30 for 30%)
 * @param shippingCost Optional shipping cost (e.g. "3.50" or 3.50, defaults to 0)
 * @returns Formatted decimal string (e.g. "21.44")
 */
export function calculateSellingPrice(
  sourceCost: string,
  markupPercent: number,
  shippingCost: string | number = 0
): string {
  const costNum = parseFloat(sourceCost);
  if (isNaN(costNum) || costNum <= 0) {
    return '0.00';
  }

  const shippingNum = typeof shippingCost === 'number'
    ? shippingCost
    : parseFloat(String(shippingCost || '0'));
  const validShipping = isNaN(shippingNum) || shippingNum < 0 ? 0 : shippingNum;

  const validMarkup = isNaN(markupPercent) || markupPercent < 0 ? 0 : markupPercent;

  // Convert to integer cents: Total Supplier Cost = Item Cost + Shipping Cost
  const itemCents = Math.round(costNum * 100);
  const shippingCents = Math.round(validShipping * 100);
  const totalSupplierCostCents = itemCents + shippingCents;

  // Apply markup in cents with commercial half-up rounding:
  // markedUpCents = totalSupplierCostCents * (1 + markup / 100)
  const markupFactor = 1 + validMarkup / 100;
  const markedUpCents = Math.round(totalSupplierCostCents * markupFactor);

  return (markedUpCents / 100).toFixed(2);
}

/**
 * Calculates price range for multi-variant products including optional shipping cost.
 * If min and max prices are identical, returns single price.
 * Otherwise returns formatted range: "$min – $max".
 */
export function calculatePriceRange(
  variants: Array<{ price: string }>,
  markupPercent: number,
  shippingCost: string | number = 0
): {
  minPrice: string;
  maxPrice: string;
  isRange: boolean;
  minTotalCost: string;
  maxTotalCost: string;
  isCostRange: boolean;
} {
  if (!variants || variants.length === 0) {
    return {
      minPrice: '0.00',
      maxPrice: '0.00',
      isRange: false,
      minTotalCost: '0.00',
      maxTotalCost: '0.00',
      isCostRange: false,
    };
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
    return {
      minPrice: '0.00',
      maxPrice: '0.00',
      isRange: false,
      minTotalCost: '0.00',
      maxTotalCost: '0.00',
      isCostRange: false,
    };
  }

  const shippingNum = typeof shippingCost === 'number'
    ? shippingCost
    : parseFloat(String(shippingCost || '0'));
  const validShipping = isNaN(shippingNum) || shippingNum < 0 ? 0 : shippingNum;

  const minTotalCost = (min + validShipping).toFixed(2);
  const maxTotalCost = (max + validShipping).toFixed(2);

  const markedMin = calculateSellingPrice(min.toFixed(2), markupPercent, shippingCost);
  const markedMax = calculateSellingPrice(max.toFixed(2), markupPercent, shippingCost);

  return {
    minPrice: markedMin,
    maxPrice: markedMax,
    isRange: markedMin !== markedMax,
    minTotalCost,
    maxTotalCost,
    isCostRange: minTotalCost !== maxTotalCost,
  };
}
