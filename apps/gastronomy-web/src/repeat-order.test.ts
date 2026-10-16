import { describe, expect, it } from "vitest";
import { isRepeatOrderEligible } from "./repeat-order";

describe("isRepeatOrderEligible", () => {
  const order = {
    lifecycleStatus: "CONFIRMED" as const,
    operationalStatus: "DELIVERED" as const,
    items: [{ id: "line-1" }],
  };

  it("allows confirmed non-cancelled orders with items for active customers", () => {
    expect(isRepeatOrderEligible(order, true)).toBe(true);
  });

  it("rejects drafts, cancelled orders, empty orders, and inactive customers", () => {
    expect(
      isRepeatOrderEligible({ ...order, lifecycleStatus: "DRAFT" }, true),
    ).toBe(false);
    expect(
      isRepeatOrderEligible({ ...order, operationalStatus: "CANCELLED" }, true),
    ).toBe(false);
    expect(isRepeatOrderEligible({ ...order, items: [] }, true)).toBe(false);
    expect(isRepeatOrderEligible(order, false)).toBe(false);
  });
});
