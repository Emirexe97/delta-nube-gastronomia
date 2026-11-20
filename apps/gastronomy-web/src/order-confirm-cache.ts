import type {
  BootstrapDto,
  OrderDto,
  OrderPrintStateDto,
} from "@gastronomy/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { bootstrapKey } from "./order-entry-cache";

/** Reconcile a newly-confirmed takeaway only when the captured draft and the
 * operational snapshot are still exactly current. Any ambiguity refreshes. */
export function applyTakeawayConfirmation(
  client: QueryClient,
  before: BootstrapDto,
  original: OrderDto,
  confirmed: OrderDto,
  delta: OrderPrintStateDto,
): boolean {
  const query = client.getQueryState<BootstrapDto>(bootstrapKey);
  const saved = delta.order;
  const extra = delta.confirmation;
  const current = before.orders.find((row) => row.id === original.id);
  if (
    query?.data !== before ||
    query.fetchStatus !== "idle" ||
    query.isInvalidated ||
    current !== original ||
    original.type !== "TAKEAWAY" ||
    original.lifecycleStatus !== "DRAFT" ||
    original.version === undefined ||
    original.paidMinor !== 0 ||
    original.payments.length !== 0 ||
    !before.cashSession ||
    before.cashSession.status !== "OPEN" ||
    before.cashSession.id !== original.cashSessionCreatedId ||
    confirmed.id !== original.id ||
    confirmed.version !== original.version + 1 ||
    confirmed.lifecycleStatus !== "CONFIRMED" ||
    JSON.stringify(confirmed) !== JSON.stringify(saved) ||
    saved.id !== original.id ||
    saved.version !== original.version + 1 ||
    saved.lifecycleStatus !== "CONFIRMED" ||
    saved.type !== "TAKEAWAY" ||
    saved.cashSessionCreatedId !== before.cashSession.id ||
    saved.cashSessionPaidId !== original.cashSessionPaidId ||
    saved.paidMinor !== original.paidMinor ||
    saved.paymentStatus !== original.paymentStatus ||
    saved.payments.length !== original.payments.length ||
    saved.tableId !== original.tableId ||
    saved.totalMinor !== original.totalMinor ||
    saved.items.length !== original.items.length ||
    delta.cashSessionId !== before.cashSession.id ||
    !extra ||
    !extra.dashboard ||
    extra.table !== null ||
    delta.printJobs.some((job) => job.orderId !== original.id)
  )
    return false;

  // Confirmation may persist snapshots but must not rewrite item quantities or prices.
  if (
    saved.items.some(
      (item, index) =>
        JSON.stringify(item) !== JSON.stringify(original.items[index]),
    )
  )
    return false;
  const stocks = new Map(
    extra.stocks.map((row) => [row.productId, row.stockMinor]),
  );
  const productIds = new Set<string>();
  for (const item of saved.items) {
    if (item.comboComponents?.length)
      item.comboComponents.forEach((part) => productIds.add(part.productId));
    else if (item.productId) productIds.add(item.productId);
    else item.halves.forEach((half) => productIds.add(half.productId));
  }
  if (
    stocks.size !== productIds.size ||
    [...productIds].some((id) => !stocks.has(id))
  )
    return false;
  // Keep the catalog reference (and its search index) if no stock changed.
  let products = before.products;
  for (let i = 0; i < before.products.length && stocks.size; i++) {
    const product = before.products[i]!;
    if (!stocks.has(product.id)) continue;
    const stockMinor = stocks.get(product.id)!;
    stocks.delete(product.id);
    if (product.stockMinor !== stockMinor) {
      if (products === before.products) products = before.products.slice();
      products[i] = { ...product, stockMinor };
    }
  }
  if (stocks.size) return false;
  const cachedJobs = before.printJobs
    .filter((job) => job.orderId === original.id)
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
    printJobs: before.printJobs,
    dashboard: extra.dashboard,
  });
  return true;
}
