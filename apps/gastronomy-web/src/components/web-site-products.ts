import type { ProductDto } from "@gastronomy/contracts";

/** Public storefront pricing must use the customer takeaway tariff, never the salon/internal one. */
export function getStorefrontProductPrice(
  product: Pick<ProductDto, "prices">,
): number | null {
  const price = product.prices.find(
    (entry) => entry.priceListCode === "TAKEAWAY",
  )?.amountMinor;
  return typeof price === "number" && Number.isSafeInteger(price) && price >= 0
    ? price
    : null;
}
