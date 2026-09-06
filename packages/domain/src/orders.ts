import type { OrderOperationalStatus, PaymentStatus } from "@gastronomy/contracts";
import { nonNegativeMoney } from "./money";

const ALLOWED_TRANSITIONS: Record<OrderOperationalStatus, readonly OrderOperationalStatus[]> = {
  PENDING: ["IN_PREPARATION", "CANCELLED"],
  IN_PREPARATION: ["READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: []
};

export function assertOrderTransition(from: OrderOperationalStatus, to: OrderOperationalStatus) {
  if (from === to) return to;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    const labels: Record<OrderOperationalStatus, string> = { PENDING: "Pendiente", IN_PREPARATION: "En preparación", READY: "Listo", OUT_FOR_DELIVERY: "En reparto", DELIVERED: "Entregado", CANCELLED: "Cancelado" };
    throw new Error(`No se puede pasar un pedido de “${labels[from]}” a “${labels[to]}”.`);
  }
  return to;
}

export function paymentStatusFor(totalMinor: number, paidMinor: number): PaymentStatus {
  nonNegativeMoney(totalMinor, "total");
  nonNegativeMoney(paidMinor, "importe pagado");
  if (paidMinor <= 0) return "UNPAID";
  if (paidMinor < totalMinor) return "PARTIALLY_PAID";
  return "PAID";
}

export function assertPaymentAllocation(totalMinor: number, alreadyPaidMinor: number, newPaymentMinor: number) {
  nonNegativeMoney(totalMinor, "total");
  nonNegativeMoney(alreadyPaidMinor, "importe ya pagado");
  nonNegativeMoney(newPaymentMinor, "nuevo pago");
  const remaining = Math.max(0, totalMinor - alreadyPaidMinor);
  if (newPaymentMinor !== remaining) {
    throw new Error("La suma de pagos debe coincidir con el saldo pendiente.");
  }
  return remaining;
}
