import type {
  BootstrapDto,
  OrderDto,
  OrderPrintStateDto,
  RestaurantTableDto,
} from "@gastronomy/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { bootstrapKey } from "./order-entry-cache";

/** Apply only the small, authoritative result of opening a table. Any stale,
 * invalidated, or concurrently refreshed cache falls back to bootstrap. */
export function cacheEnsuredTable(
  client: QueryClient,
  table: RestaurantTableDto,
  before?: BootstrapDto,
): boolean {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  const cached = state?.data;
  if (
    !cached ||
    (before && cached !== before) ||
    state.isInvalidated ||
    state.fetchStatus !== "idle"
  )
    return false;
  const existing = cached.tables.find((item) => item.id === table.id);
  if (
    existing &&
    (existing.currentOrderId !== table.currentOrderId ||
      existing.currentTotalMinor !== table.currentTotalMinor ||
      existing.waiterName !== table.waiterName)
  )
    return false;
  if (
    table.currentOrderId &&
    !cached.orders.some(
      (o) => o.id === table.currentOrderId && o.tableId === table.id,
    )
  )
    return false;
  if (existing && JSON.stringify(existing) === JSON.stringify(table))
    return true;
  client.setQueryData<BootstrapDto>(bootstrapKey, {
    ...cached,
    tables: [
      ...cached.tables.filter((item) => item.id !== table.id),
      table,
    ].sort((a, b) => a.number - b.number),
  });
  return true;
}

export function cacheOpenedTableOrder(
  client: QueryClient,
  order: OrderDto,
  before: RestaurantTableDto | undefined,
  detail?: OrderPrintStateDto,
  beforeBootstrap?: BootstrapDto,
): boolean {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  const cached = state?.data;
  const table =
    order.tableId && cached?.tables.find((item) => item.id === order.tableId);
  const savedTable = detail?.confirmation?.table;
  if (
    !cached ||
    (beforeBootstrap && cached !== beforeBootstrap) ||
    !before ||
    !table ||
    state?.isInvalidated ||
    state?.fetchStatus !== "idle" ||
    table.currentOrderId !== null ||
    before.id !== table.id ||
    before.currentOrderId !== null ||
    !before.active ||
    !table.active ||
    order.type !== "DINE_IN" ||
    order.lifecycleStatus !== "DRAFT" ||
    order.operationalStatus !== "PENDING" ||
    order.paidMinor !== 0 ||
    order.payments.length !== 0 ||
    cached.cashSession?.status !== "OPEN" ||
    cached.cashSession.id !== order.cashSessionCreatedId ||
    cached.orders.some((item) => item.id === order.id) ||
    !detail?.confirmation?.dashboard ||
    detail.order.id !== order.id ||
    detail.cashSessionId !== order.cashSessionCreatedId ||
    detail.order.version !== order.version ||
    !savedTable ||
    savedTable.id !== table.id ||
    savedTable.currentOrderId !== order.id ||
    savedTable.currentTotalMinor !== order.totalMinor ||
    detail.order.updatedAt !== order.updatedAt ||
    detail.order.lifecycleStatus !== order.lifecycleStatus ||
    detail.order.items.length !== 0 ||
    detail.printJobs.length > 0
  )
    return false;
  const position = cached.orders.findIndex(
    (o) => o.createdAt <= order.createdAt,
  );
  const orders = cached.orders.slice();
  orders.splice(position === -1 ? orders.length : position, 0, detail.order);
  client.setQueryData<BootstrapDto>(bootstrapKey, {
    ...cached,
    orders,
    tables: cached.tables.map((item) =>
      item.id === table.id ? savedTable : item,
    ),
    dashboard: detail.confirmation.dashboard,
  });
  return true;
}
