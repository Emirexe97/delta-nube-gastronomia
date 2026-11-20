import type { QueryClient } from "@tanstack/react-query";
import type {
  BootstrapDto,
  DeliveryProjectionDto,
  OrderDto,
} from "@gastronomy/contracts";
import { bootstrapKey } from "./order-entry-cache";

export type DeliveryAction = "assign" | "state" | "complete";
const asc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Apply only the rows proven by this command's read transaction. Never infer cash from tenders. */
export function applyDeliveryProjection(
  client: QueryClient,
  before: BootstrapDto,
  old: OrderDto,
  saved: OrderDto,
  delta: DeliveryProjectionDto,
  action: DeliveryAction,
): boolean {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  const cashId = before.cashSession?.id;
  const financial =
    action === "complete" ||
    (action === "state" && saved.operationalStatus === "DELIVERED");
  const revisionDelta =
    action === "complete"
      ? 1 +
        Number(old.paymentStatus !== "PAID") +
        Number(old.driverUserId !== saved.driverUserId)
      : action === "assign"
        ? Number(old.driverUserId !== saved.driverUserId)
        : 1;
  if (
    !state ||
    state.data !== before ||
    state.isInvalidated ||
    state.fetchStatus !== "idle" ||
    old.type !== "DELIVERY" ||
    old.lifecycleStatus !== "CONFIRMED" ||
    old.version === undefined ||
    saved.id !== old.id ||
    saved.version !== old.version + revisionDelta ||
    !cashId ||
    (old.cashSessionPaidId ?? old.cashSessionCreatedId) !== cashId ||
    delta.openCashSessionId !== cashId ||
    delta.cashSessionId !== cashId ||
    JSON.stringify(saved) !== JSON.stringify(delta.order) ||
    (financial && delta.financials?.cashSession.id !== cashId)
  )
    return false;

  const drivers = new Set([old.driverUserId, saved.driverUserId]);
  if (
    delta.deliveryLedger.some(
      (row) => row.orderId !== old.id || row.cashSessionId !== cashId,
    ) ||
    delta.driverDeliveryActivity.some(
      (row) => row.cashSessionId !== cashId || !drivers.has(row.driverUserId),
    )
  )
    return false;
  const orderIndex = before.orders.indexOf(old);
  if (orderIndex < 0) return false;
  const orders = before.orders.slice();
  orders[orderIndex] = delta.order;
  // The operational ledger only displays an outstanding balance or a settled entry.
  const ledger = before.deliveryLedger.filter((row) => row.orderId !== old.id);
  for (const row of delta.deliveryLedger) {
    if (
      row.status === "PENDING" &&
      row.amountDueMinor <= row.settledAmountMinor
    )
      continue;
    const index = ledger.findIndex(
      (other) =>
        asc(row.createdAt, other.createdAt) > 0 ||
        (row.createdAt === other.createdAt && asc(row.id, other.id) > 0),
    );
    ledger.splice(index < 0 ? ledger.length : index, 0, row);
  }
  const activity = before.driverDeliveryActivity.filter(
    (row) => row.cashSessionId !== cashId || !drivers.has(row.driverUserId),
  );
  activity.push(...delta.driverDeliveryActivity);
  activity.sort(
    (a, b) =>
      asc(b.lastDeliveryAt, a.lastDeliveryAt) ||
      asc(a.driverUserId, b.driverUserId) ||
      asc(a.cashSessionId, b.cashSessionId),
  );
  client.setQueryData<BootstrapDto>(bootstrapKey, {
    ...before,
    orders,
    deliveryLedger: ledger,
    driverDeliveryActivity: activity,
    ...(financial ? delta.financials : {}),
  });
  return true;
}
