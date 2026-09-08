import type {
  OrderActionGuardDto,
  OrderDto,
  OrderOperationalStatus,
} from "@gastronomy/contracts";

export type OrderAction =
  | "CONFIRM"
  | "EDIT"
  | "PAY"
  | "PRINT_KITCHEN"
  | "PRINT_BILL"
  | "DELIVER"
  | "CANCEL"
  | "DISCARD_DRAFT"
  | "REMOVE_LAST_ITEM";

export function assertOffPremiseCustomer(input: {
  type: OrderDto["type"];
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
}) {
  if (input.type === "DINE_IN") return;
  if (!input.customerName?.trim())
    throw new Error("Ingresá el nombre del cliente.");
  if (!input.customerPhone?.trim())
    throw new Error("Ingresá el teléfono del cliente.");
  if (input.type === "DELIVERY" && !input.deliveryAddress?.trim())
    throw new Error("Ingresá la dirección del cliente.");
}

const allow = (): OrderActionGuardDto => ({
  allowed: true,
  reason: null,
  suggestedAction: null,
});
const deny = (
  reason: string,
  suggestedAction: OrderActionGuardDto["suggestedAction"] = null,
): OrderActionGuardDto => ({ allowed: false, reason, suggestedAction });

export function guardOrderAction(
  order: OrderDto,
  action: OrderAction,
): OrderActionGuardDto {
  const terminal = ["DELIVERED", "CANCELLED"].includes(order.operationalStatus);
  const hasItems =
    order.items.length > 0 &&
    order.items.every(
      (item) => item.quantity > 0 && item.unitPriceMinorSnapshot >= 0,
    );
  if (action === "DISCARD_DRAFT")
    return order.lifecycleStatus === "DRAFT"
      ? allow()
      : deny("Sólo los borradores pueden descartarse.");
  if (action === "CONFIRM") {
    if (order.lifecycleStatus !== "DRAFT")
      return deny("El pedido ya está confirmado.");
    if (!hasItems)
      return deny("Agregá al menos un producto válido antes de confirmar.");
    if (order.totalMinor <= 0)
      return deny("El total del pedido debe ser mayor que cero.");
    if (order.type === "DINE_IN" && !order.tableId)
      return deny("Seleccioná una mesa válida.");
    if (order.type !== "DINE_IN" && !order.customerNameSnapshot?.trim())
      return deny("Ingresá el nombre del cliente.");
    if (order.type !== "DINE_IN" && !order.customerPhoneSnapshot?.trim())
      return deny("Ingresá el teléfono del cliente.");
    if (order.type === "DELIVERY" && !order.deliveryAddressSnapshot?.trim())
      return deny("Ingresá la dirección del cliente.");
    return allow();
  }
  if (action === "EDIT")
    return terminal
      ? deny("El pedido finalizado no admite edición normal.")
      : allow();
  if (order.lifecycleStatus === "DRAFT")
    return deny("Confirmá el borrador para continuar.", "CONFIRM");
  if (
    !hasItems &&
    ["PAY", "PRINT_KITCHEN", "PRINT_BILL", "DELIVER"].includes(action)
  )
    return deny("El pedido no tiene productos.");
  if (action === "PAY") {
    if (order.operationalStatus === "CANCELLED")
      return deny("No se puede cobrar un pedido cancelado.");
    if (order.paymentStatus === "PAID")
      return deny("El pedido ya está pagado.");
    return allow();
  }
  if (action === "PRINT_KITCHEN" || action === "PRINT_BILL")
    return terminal && order.operationalStatus !== "DELIVERED"
      ? deny("El pedido cancelado no puede imprimirse.")
      : allow();
  if (action === "DELIVER") {
    if (terminal)
      return deny(
        order.operationalStatus === "DELIVERED"
          ? "El pedido ya fue entregado."
          : "El pedido está cancelado.",
      );
    if (order.paymentStatus !== "PAID")
      return deny("Cobrá el pedido antes de entregarlo.", "OPEN_PAYMENT");
    return allow();
  }
  if (action === "CANCEL") {
    if (terminal) return deny("El pedido ya está finalizado.");
    if (order.paidMinor > 0)
      return deny(
        "El pedido tiene pagos; primero debe registrarse una devolución.",
      );
    return allow();
  }
  if (action === "REMOVE_LAST_ITEM" && order.items.length <= 1)
    return deny("Un pedido confirmado no puede quedar vacío.");
  return allow();
}

export function assertOrderAction(order: OrderDto, action: OrderAction) {
  const result = guardOrderAction(order, action);
  if (!result.allowed)
    throw new Error(result.reason ?? "La acción no está permitida.");
}

export function assertOperationalTransition(
  order: OrderDto,
  to: OrderOperationalStatus,
) {
  if (order.lifecycleStatus === "DRAFT")
    throw new Error("Confirmá el borrador antes de cambiar su estado.");
  if (order.operationalStatus === to)
    throw new Error("El pedido ya se encuentra en ese estado.");
  if (to === "OUT_FOR_DELIVERY" && order.type !== "DELIVERY")
    throw new Error("Sólo un envío puede pasar a reparto.");
  if (to === "OUT_FOR_DELIVERY" && !order.driverUserId)
    throw new Error("Asigná un repartidor antes de iniciar el reparto.");
  if (to === "DELIVERED" && order.type === "DELIVERY" && !order.driverUserId)
    throw new Error("Asigná un repartidor antes de entregar el envío.");
  if (to === "DELIVERED") assertOrderAction(order, "DELIVER");
}
