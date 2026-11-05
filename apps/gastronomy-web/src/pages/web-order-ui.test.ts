import { describe, expect, it } from "vitest";
import type {
  BootstrapDto,
  ProductDto,
  WebOrderDraft,
} from "@gastronomy/contracts";
import {
  currentPosUnitPrice,
  hasCurrentPosPrice,
  resolveWebOrderProduct,
  webDraftTotal,
} from "./web-order-ui";

const product = {
  id: "prod-1",
  code: "P1",
  name: "Empanada",
  categoryId: "cat",
  categoryName: "Comida",
  sortOrder: 1,
  active: false,
  stockMinor: null,
  stockTargetMinor: null,
  stockMinMinor: null,
  stockCriticalMinor: null,
  imageDataUrl: null,
  prices: [
    { priceListId: "p1", priceListCode: "TAKEAWAY", amountMinor: 1500 },
    { priceListId: "p2", priceListCode: "DELIVERY", amountMinor: 1700 },
  ],
} as ProductDto;
const data = { products: [product] } as BootstrapDto;
const draft = (type: WebOrderDraft["type"]): WebOrderDraft => ({
  customerName: "Ana",
  customerPhone: "12345678",
  type,
  deliveryAddress: "Calle 1",
  deliveryFeeMinor: 500,
  notes: "",
  items: [{ productRef: "prod-1", quantity: 2, notes: "" }],
});

describe("web order POS pricing", () => {
  it("uses strict product IDs (not a code/name fallback)", () => {
    expect(resolveWebOrderProduct(data, "prod-1")).toBe(product);
    expect(resolveWebOrderProduct(data, "P1")).toBeUndefined();
    expect(resolveWebOrderProduct(data, "Empanada")).toBeUndefined();
  });

  it("uses the current POS price list by fulfillment, and only delivery has a fee", () => {
    expect(currentPosUnitPrice(product, "TAKEAWAY")).toBe(1500);
    expect(currentPosUnitPrice(product, "DELIVERY")).toBe(1700);
    expect(webDraftTotal(data, draft("TAKEAWAY"))).toBe(3000);
    expect(webDraftTotal(data, draft("DELIVERY"))).toBe(3900);
  });

  it("marks a missing fulfillment price as incompatible rather than guessing", () => {
    const takeaway = product.prices.find(
      (price) => price.priceListCode === "TAKEAWAY",
    )!;
    const noDelivery = { ...product, prices: [takeaway] };
    expect(currentPosUnitPrice(noDelivery, "DELIVERY")).toBe(0);
    expect(hasCurrentPosPrice(noDelivery, "DELIVERY")).toBe(false);
  });
});
