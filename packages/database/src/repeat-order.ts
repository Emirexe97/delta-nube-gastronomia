import type { GastronomyRepository } from "@gastronomy/application";
import type { OrderDto, RepeatOrderInput } from "@gastronomy/contracts";
import { planRepeatOrder } from "@gastronomy/domain";

/** Called only inside the repository's idempotent transaction. */
export function populateRepeatedOrder(
  repo: GastronomyRepository,
  input: RepeatOrderInput,
): OrderDto {
  const source = repo.getOrder(input.sourceOrderId);
  const customer = repo.getCustomerProfile({
    customerId: input.customerId,
    page: 1,
    pageSize: 1,
  }).customer;
  const plan = planRepeatOrder(source, customer, repo.bootstrap(), input);
  let order = repo.createOrder(plan.order);
  for (const line of plan.lines) {
    const previous = order;
    const orderId = order.id;
    if (line.item.kind === "PRODUCT")
      order = repo.addOrderItem({ ...line.item.input, orderId });
    else if (line.item.kind === "HALF")
      order = repo.addHalfAndHalfItem({ ...line.item.input, orderId });
    else order = repo.addComboItem({ ...line.item.input, orderId });
    const added =
      order.items.find(
        (item) => !previous.items.some((old) => old.id === item.id),
      ) ??
      order.items.find(
        (item) =>
          previous.items.find((old) => old.id === item.id)?.quantity !==
          item.quantity,
      );
    if (!added) throw new Error("No se pudo identificar la línea repetida.");
    for (const extra of line.modifiers)
      order = repo.addOrderItemModifier({
        orderId,
        itemId: added.id,
        ...extra,
      });
  }
  return order;
}
