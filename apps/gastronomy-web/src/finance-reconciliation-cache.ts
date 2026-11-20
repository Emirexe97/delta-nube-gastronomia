import type { QueryClient } from "@tanstack/react-query";
import type {
  BootstrapDto,
  DeliveryProjectionDto,
  OrderDto,
} from "@gastronomy/contracts";
import { bootstrapKey } from "./order-entry-cache";

/** Reconcile a single TAKEAWAY mutation from one coherent SQLite projection. */
export function applyTakeawayFinanceProjection(
  client: QueryClient,
  before: BootstrapDto,
  old: OrderDto,
  saved: OrderDto,
  delta: DeliveryProjectionDto,
  operation: "payment" | "complete" | "deliver",
): boolean {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  const cashId = before.cashSession?.id;
  const paymentChanged =
    old.paymentStatus !== saved.paymentStatus ||
    old.paidMinor !== saved.paidMinor;
  const statusChanged = old.operationalStatus !== saved.operationalStatus;
  const expectedVersion =
    old.version === undefined
      ? undefined
      : old.version + Number(paymentChanged) + Number(statusChanged);
  if (
    state?.data !== before ||
    state.isInvalidated ||
    state.fetchStatus !== "idle" ||
    old.type !== "TAKEAWAY" ||
    old.lifecycleStatus !== "CONFIRMED" ||
    old.version === undefined ||
    saved.id !== old.id ||
    saved.type !== "TAKEAWAY" ||
    saved.version === undefined ||
    saved.version !== expectedVersion ||
    saved.version <= old.version ||
    delta.order.id !== old.id ||
    JSON.stringify(saved) !== JSON.stringify(delta.order) ||
    !cashId ||
    before.cashSession?.status !== "OPEN" ||
    delta.openCashSessionId !== cashId ||
    delta.cashSessionId !== cashId ||
    (old.cashSessionPaidId ?? old.cashSessionCreatedId) !== cashId ||
    saved.cashSessionPaidId !== cashId ||
    delta.financials?.cashSession.id !== cashId ||
    (operation === "payment" && (!paymentChanged || statusChanged)) ||
    (operation !== "payment" &&
      (saved.operationalStatus !== "DELIVERED" ||
        saved.paymentStatus !== "PAID")) ||
    (operation === "deliver" &&
      (old.paymentStatus !== "PAID" || paymentChanged)) ||
    (operation === "complete" && (!paymentChanged || !statusChanged))
  )
    return false;
  const index = before.orders.indexOf(old);
  if (index < 0) return false;
  const orders = before.orders.slice();
  orders[index] = saved;
  client.setQueryData<BootstrapDto>(bootstrapKey, {
    ...before,
    orders,
    cashSession: delta.financials.cashSession,
    dashboard: delta.financials.dashboard,
  });
  return true;
}
