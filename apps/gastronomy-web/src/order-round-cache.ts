import type {
  BootstrapDto,
  OrderDto,
  OrderPrintStateDto,
} from "@gastronomy/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { bootstrapKey } from "./order-entry-cache";

/** Apply only a single simple product addition to an unchanged confirmed dine-in order.
 * The detail read supplies inventory/table/dashboard projections; any ambiguity falls back to bootstrap. */
export function applySecondRoundOrderCache(
  client: QueryClient,
  before: BootstrapDto,
  original: OrderDto,
  delta: OrderPrintStateDto,
  response: OrderDto,
  expected?: { productId?: string; quantity?: number; notes?: string | null },
): boolean {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  const saved = delta.order;
  const extra = delta.confirmation;
  const current = before.orders.find((order) => order.id === original.id);
  const table = extra?.table;
  if (
    !state ||
    state.data !== before ||
    state.fetchStatus !== "idle" ||
    state.isInvalidated ||
    !current ||
    current !== original ||
    original.type !== "DINE_IN" ||
    original.lifecycleStatus !== "CONFIRMED" ||
    original.paidMinor !== 0 ||
    original.payments.length !== 0 ||
    original.operationalStatus === "DELIVERED" ||
    original.operationalStatus === "CANCELLED" ||
    !before.cashSession ||
    before.cashSession.status !== "OPEN" ||
    before.cashSession.id !== original.cashSessionCreatedId ||
    original.version === undefined ||
    saved.id !== original.id ||
    response.id !== saved.id ||
    saved.version !== original.version + 1 ||
    delta.cashSessionId !== before.cashSession.id ||
    saved.cashSessionCreatedId !== before.cashSession.id ||
    saved.lifecycleStatus !== original.lifecycleStatus ||
    saved.operationalStatus !== original.operationalStatus ||
    (saved.serviceRevision ?? 0) !== (original.serviceRevision ?? 0) + 1 ||
    saved.servedAt != null ||
    saved.tableId !== original.tableId ||
    saved.type !== original.type ||
    saved.paidMinor !== original.paidMinor ||
    saved.paymentStatus !== original.paymentStatus ||
    saved.payments.length !== original.payments.length ||
    saved.cashSessionPaidId !== original.cashSessionPaidId ||
    saved.notes !== original.notes ||
    saved.customerId !== original.customerId ||
    saved.driverUserId !== original.driverUserId ||
    saved.waiterUserId !== original.waiterUserId ||
    saved.depositMinor !== original.depositMinor ||
    saved.deliveryFeeMinor !== original.deliveryFeeMinor ||
    saved.printCount !== original.printCount ||
    saved.items.length < original.items.length ||
    saved.items.length > original.items.length + 1 ||
    !extra ||
    saved.tableId !== (table?.id ?? null) ||
    !table ||
    table.currentOrderId !== saved.id ||
    table.currentTotalMinor !== saved.totalMinor ||
    !before.tables.some(
      (row) => row.id === table.id && row.currentOrderId === original.id,
    ) ||
    !extra.dashboard ||
    response.version !== saved.version ||
    JSON.stringify(response) !== JSON.stringify(saved)
  )
    return false;

  const changed = saved.items.filter(
    (item, index) =>
      JSON.stringify(item) !== JSON.stringify(original.items[index]),
  );
  const added = changed.length === 1 ? changed[0]! : undefined;
  if (!added) return false;
  const wasExisting = original.items.some((item) => item.id === added.id);
  if (
    !added.productId ||
    added.halves.length ||
    added.modifiers.length ||
    added.comboComponents?.length ||
    (expected?.productId && added.productId !== expected.productId) ||
    (wasExisting &&
      (added.quantity !==
        (original.items.find((item) => item.id === added.id)?.quantity ?? 0) +
          (expected?.quantity ?? 1) ||
        JSON.stringify({ ...added, quantity: 0, lineTotalMinor: 0 }) !==
          JSON.stringify({
            ...original.items.find((item) => item.id === added.id)!,
            quantity: 0,
            lineTotalMinor: 0,
          }))) ||
    (!wasExisting && added.quantity !== (expected?.quantity ?? 1)) ||
    (expected?.notes !== undefined && added.notes !== (expected.notes ?? null))
  )
    return false;
  const stable = (order: OrderDto) => {
    const {
      items: _items,
      subtotalMinor: _subtotal,
      discountMinor: _discount,
      totalMinor: _total,
      updatedAt: _updated,
      version: _version,
      serviceRevision: _serviceRevision,
      servedAt: _servedAt,
      servicePendingSince: _pending,
      ...rest
    } = order;
    return rest;
  };
  if (JSON.stringify(stable(saved)) !== JSON.stringify(stable(original)))
    return false;
  const stockMap = new Map(
    extra.stocks.map((row) => [row.productId, row.stockMinor]),
  );
  if (!stockMap.has(added.productId)) return false;
  const products = before.products.map((product) => {
    if (!stockMap.has(product.id)) return product;
    const stockMinor = stockMap.get(product.id)!;
    stockMap.delete(product.id);
    return product.stockMinor === stockMinor
      ? product
      : { ...product, stockMinor };
  });
  if (stockMap.size) return false;
  const cachedJobs = before.printJobs
    .filter((job) => job.orderId === saved.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const deltaJobs = [...delta.printJobs].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (JSON.stringify(cachedJobs) !== JSON.stringify(deltaJobs)) return false;
  client.setQueryData<BootstrapDto>(bootstrapKey, {
    ...before,
    orders: before.orders.map((order) =>
      order.id === saved.id ? saved : order,
    ),
    products,
    tables: before.tables.map((row) => (row.id === table.id ? table : row)),
    dashboard: extra.dashboard,
    printJobs: before.printJobs,
  });
  return true;
}
