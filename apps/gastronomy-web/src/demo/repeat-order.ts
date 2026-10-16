import type {
  DesktopApi,
  OrderDto,
  RepeatOrderInput,
} from "@gastronomy/contracts";
import { planRepeatOrder } from "@gastronomy/domain";

/** Run against an isolated candidate API; publish its storage only on success. */
export async function populateRepeatedDemoOrder(
  api: DesktopApi,
  input: RepeatOrderInput,
): Promise<OrderDto> {
  const source = await api.getOrder({ orderId: input.sourceOrderId });
  const customer = (
    await api.getCustomerProfile({
      customerId: input.customerId,
      page: 1,
      pageSize: 1,
    })
  ).customer;
  const plan = planRepeatOrder(source, customer, await api.bootstrap(), input);
  let order = await api.createOrder(plan.order);
  for (const line of plan.lines) {
    const previous = order;
    const orderId = order.id;
    if (line.item.kind === "PRODUCT")
      order = await api.addOrderItem({ ...line.item.input, orderId });
    else if (line.item.kind === "HALF")
      order = await api.addHalfAndHalfItem({ ...line.item.input, orderId });
    else order = await api.addComboItem({ ...line.item.input, orderId });
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
      order = await api.addOrderItemModifier({
        orderId,
        itemId: added.id,
        ...extra,
      });
  }
  return order;
}
