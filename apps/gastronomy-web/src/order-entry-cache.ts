import type { BootstrapDto, OrderDto } from "@gastronomy/contracts";
import type { QueryClient } from "@tanstack/react-query";

export const bootstrapKey = ["bootstrap"] as const;

/** Only line edits in an unpaid draft are local to the order and its table.
 * Confirmed orders can change stock/costs; payments, confirmations, cancellations
 * and any concurrent refresh must keep the authoritative full refresh path.
 * Never infer successful writes: updated is the committed API response. */
export function updateDraftOrderCache(
  client: QueryClient,
  before: OrderDto | undefined,
  updated: OrderDto,
): boolean {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  const cached = state?.data;
  const current = cached?.orders.find((order) => order.id === updated.id);
  if (
    !cached ||
    !before ||
    current !== before ||
    state.isInvalidated ||
    state.fetchStatus !== "idle" ||
    before.id !== updated.id ||
    before.lifecycleStatus !== "DRAFT" ||
    updated.lifecycleStatus !== "DRAFT" ||
    before.paidMinor !== 0 ||
    updated.paidMinor !== 0 ||
    before.payments.length !== 0 ||
    updated.payments.length !== 0 ||
    before.operationalStatus !== updated.operationalStatus ||
    ["DELIVERED", "CANCELLED"].includes(updated.operationalStatus) ||
    before.tableId !== updated.tableId ||
    before.type !== updated.type ||
    before.cashSessionCreatedId !== updated.cashSessionCreatedId ||
    cached.cashSession?.id !== updated.cashSessionCreatedId ||
    cached.cashSession.status !== "OPEN" ||
    Date.parse(updated.updatedAt) < Date.parse(before.updatedAt)
  )
    return false;

  if (
    updated.tableId &&
    !cached.tables.some(
      (table) =>
        table.id === updated.tableId && table.currentOrderId === updated.id,
    )
  )
    return false;

  client.setQueryData<BootstrapDto>(bootstrapKey, {
    ...cached,
    orders: cached.orders.map((order) =>
      order.id === updated.id ? updated : order,
    ),
    tables: updated.tableId
      ? cached.tables.map((table) =>
          table.id === updated.tableId
            ? { ...table, currentTotalMinor: updated.totalMinor }
            : table,
        )
      : cached.tables,
  });
  return true;
}
