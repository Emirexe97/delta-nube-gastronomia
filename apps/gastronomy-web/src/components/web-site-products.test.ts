import { describe, expect, it } from "vitest";
import { getStorefrontProductPrice } from "./web-site-products";

describe("getStorefrontProductPrice", () => {
  it("uses TAKEAWAY even when salon/internal price appears first", () => {
    expect(
      getStorefrontProductPrice({
        prices: [
          {
            priceListId: "salon",
            priceListCode: "SALON",
            amountMinor: 125_000,
          },
          {
            priceListId: "pickup",
            priceListCode: "TAKEAWAY",
            amountMinor: 99_000,
          },
          {
            priceListId: "delivery",
            priceListCode: "DELIVERY",
            amountMinor: 105_000,
          },
        ],
      }),
    ).toBe(99_000);
  });

  it("does not invent a public price when TAKEAWAY is missing or invalid", () => {
    expect(
      getStorefrontProductPrice({
        prices: [
          {
            priceListId: "salon",
            priceListCode: "SALON",
            amountMinor: 125_000,
          },
        ],
      }),
    ).toBeNull();
    expect(
      getStorefrontProductPrice({
        prices: [
          { priceListId: "pickup", priceListCode: "TAKEAWAY", amountMinor: -1 },
        ],
      }),
    ).toBeNull();
  });
});
