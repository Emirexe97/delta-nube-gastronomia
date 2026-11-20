import type { QueryClient } from "@tanstack/react-query";
import type {
  BootstrapDto,
  DesktopApi,
  OrderPrintStateDto,
  PrintJobDto,
} from "@gastronomy/contracts";
import { bootstrapKey } from "./order-entry-cache";

// Same window as SQLite: all actionable jobs plus the newest 100 successes.
function mergeJobs(cached: PrintJobDto[], delta: OrderPrintStateDto) {
  const jobs = [
    ...cached.filter((job) => job.orderId !== delta.order.id),
    ...delta.printJobs,
  ];
  jobs.sort((a, b) =>
    a.createdAt !== b.createdAt
      ? a.createdAt > b.createdAt
        ? -1
        : 1
      : a.id > b.id
        ? -1
        : a.id < b.id
          ? 1
          : 0,
  );
  let printed = 0;
  return jobs.filter((job) => job.status !== "PRINTED" || ++printed <= 100);
}

/** Patch only an active, unchanged local view. The repository supplies actual
 * remaining stock (including halves and combo ingredients), never arithmetic
 * inferred from a ticket. Other mutations own payment/cash/ledger projections. */
export function applyOrderPrintState(
  client: QueryClient,
  before: BootstrapDto,
  delta: OrderPrintStateDto,
  confirmation: boolean,
) {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  const saved = delta.order;
  const current = before.orders.find((order) => order.id === saved.id);
  if (
    state?.data !== before ||
    state.fetchStatus !== "idle" ||
    state.isInvalidated ||
    !current ||
    !before.cashSession ||
    before.cashSession.status !== "OPEN" ||
    before.cashSession.id !== delta.cashSessionId ||
    saved.cashSessionCreatedId !== delta.cashSessionId ||
    current.type !== saved.type ||
    current.tableId !== saved.tableId ||
    current.paidMinor !== saved.paidMinor ||
    current.paymentStatus !== saved.paymentStatus ||
    current.totalMinor !== saved.totalMinor ||
    current.cashSessionPaidId !== saved.cashSessionPaidId ||
    saved.updatedAt < current.updatedAt ||
    Boolean(delta.confirmation) !== confirmation ||
    (confirmation
      ? saved.lifecycleStatus !== "CONFIRMED"
      : current.lifecycleStatus !== saved.lifecycleStatus ||
        current.operationalStatus !== saved.operationalStatus ||
        current.updatedAt !== saved.updatedAt)
  )
    return false;

  const extra = delta.confirmation;
  const table = extra?.table;
  if (
    extra &&
    (saved.tableId !== (table?.id ?? null) ||
      (table && !before.tables.some((row) => row.id === table.id)))
  )
    return false;
  const stocks = new Map(
    extra?.stocks.map((row) => [row.productId, row.stockMinor]),
  );
  const products = stocks.size
    ? before.products.map((product) => {
        if (!stocks.has(product.id)) return product;
        const stockMinor = stocks.get(product.id)!;
        stocks.delete(product.id);
        return product.stockMinor === stockMinor
          ? product
          : { ...product, stockMinor };
      })
    : before.products;
  if (stocks.size) return false; // catalog changed independently
  client.setQueryData<BootstrapDto>(bootstrapKey, {
    ...before,
    orders: before.orders.map((order) =>
      order.id === saved.id ? saved : order,
    ),
    printJobs: mergeJobs(before.printJobs, delta),
    products,
    tables: table
      ? before.tables.map((row) => (row.id === table.id ? table : row))
      : before.tables,
    dashboard: extra?.dashboard ?? before.dashboard,
  });
  return true;
}

export async function refreshOrderPrintState(
  client: QueryClient,
  orderId: string,
  includeConfirmation = false,
  api: Pick<DesktopApi, "getOrderPrintState"> = window.gastronomy,
) {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  if (state?.data && state.fetchStatus === "idle" && !state.isInvalidated) {
    try {
      const delta = await api.getOrderPrintState({
        orderId,
        includeConfirmation,
      });
      if (
        delta.order.id === orderId &&
        applyOrderPrintState(client, state.data, delta, includeConfirmation)
      )
        return;
    } catch {
      /* missing/older bridge, restore, or failed projection: reconcile below */
    }
  }
  // Also refresh an editor displaying an order from a historical shift.
  await client.invalidateQueries({ queryKey: bootstrapKey });
}
