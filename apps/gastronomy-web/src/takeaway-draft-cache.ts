import type { BootstrapDto, OrderDto } from "@gastronomy/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { bootstrapKey } from "./order-entry-cache";

/** Reconcile only a just-created, unpaid takeaway draft in an unchanged open
 * cash snapshot. Anything ambiguous keeps useApiMutation's full refresh path. */
export function addTakeawayDraftToCache(
  client: QueryClient,
  before: BootstrapDto | undefined,
  created: OrderDto,
): boolean {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  const cached = state?.data;
  if (
    !before ||
    !cached ||
    cached !== before ||
    state.isInvalidated ||
    state.fetchStatus !== "idle" ||
    !cached.cashSession ||
    cached.cashSession.status !== "OPEN" ||
    created.type !== "TAKEAWAY" ||
    created.lifecycleStatus !== "DRAFT" ||
    created.operationalStatus !== "PENDING" ||
    created.paidMinor !== 0 ||
    created.paymentStatus !== "UNPAID" ||
    created.cashSessionPaidId !== null ||
    created.items.length !== 0 ||
    created.totalMinor !== 0 ||
    created.payments.length !== 0 ||
    created.tableId !== null ||
    created.cashSessionCreatedId !== cached.cashSession.id ||
    cached.orders.some((order) => order.id === created.id) ||
    Date.parse(created.updatedAt) < Date.parse(created.createdAt)
  )
    return false;

  client.setQueryData<BootstrapDto>(bootstrapKey, {
    ...cached,
    // bootstrap lists newest first. A replay/clock shift can return an older draft.
    orders: insertByCreation(cached.orders, created),
  });
  return true;
}

function insertByCreation(orders: OrderDto[], created: OrderDto) {
  const at = orders.findIndex((order) => order.createdAt <= created.createdAt);
  return at < 0
    ? [...orders, created]
    : [...orders.slice(0, at), created, ...orders.slice(at)];
}
