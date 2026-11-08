import type { PriceChannel } from "@gastronomy/contracts";

export interface LegacyChannelPriceProduct {
  id: string;
  prices: Partial<Record<PriceChannel, number>>;
}

export interface LegacyChannelPricePlan {
  separateTakeaway: boolean;
  products: Array<{ id: string; salon: number; delivery: number; takeaway: number }>;
}

/** Resolve historical channel prices without changing any effective amount. */
export function planLegacyChannelPrices(
  products: LegacyChannelPriceProduct[],
): LegacyChannelPricePlan {
  const resolved = products.map(({ id, prices }) => {
    const rawSalon = prices.SALON;
    const rawTakeaway = prices.TAKEAWAY;
    const rawDelivery = prices.DELIVERY;
    const salon = rawSalon ?? rawTakeaway ?? rawDelivery ?? 0;
    return {
      id,
      salon,
      takeaway: rawTakeaway ?? rawDelivery ?? salon,
      delivery: rawDelivery ?? rawTakeaway ?? salon,
    };
  });
  return {
    separateTakeaway: resolved.some(({ takeaway, delivery }) => takeaway !== delivery),
    products: resolved,
  };
}
