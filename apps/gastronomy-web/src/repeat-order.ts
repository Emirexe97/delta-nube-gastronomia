import type { OrderDto } from "@gastronomy/contracts";

/** Only confirmed, live orders with line items are safe repeat sources. */
export function isRepeatOrderEligible(
  order: Pick<OrderDto, "lifecycleStatus" | "operationalStatus"> & {
    items: readonly unknown[];
  },
  customerActive: boolean,
): boolean {
  return (
    customerActive &&
    order.lifecycleStatus === "CONFIRMED" &&
    order.operationalStatus !== "CANCELLED" &&
    order.items.length > 0
  );
}
