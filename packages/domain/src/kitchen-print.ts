import type { OrderDto, OrderItemDto } from "@gastronomy/contracts";

/** Net additions since the last successfully printed kitchen ticket, by line ID. */
export function getKitchenAdditions(
  order: Pick<OrderDto, "items" | "kitchenPrintedQuantities">,
): OrderItemDto[] {
  const printedQuantities = order.kitchenPrintedQuantities;
  if (printedQuantities == null) return [];
  return order.items.flatMap((item) => {
    const quantity = Math.max(
      0,
      item.quantity - (printedQuantities[item.id] ?? 0),
    );
    return quantity > 0
      ? [
          {
            ...item,
            quantity,
            lineTotalMinor: Math.round(
              (item.lineTotalMinor * quantity) / item.quantity,
            ),
          },
        ]
      : [];
  });
}
