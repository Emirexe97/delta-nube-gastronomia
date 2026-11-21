import type {
  CashSessionDto,
  DeliveryShipmentDto,
  DeliveryLedgerDto,
  DeliveryShipmentsDto,
  DeliveryShipmentsInput,
  OrderDto,
} from "@gastronomy/contracts";

/** Pure counterpart of the database projection, useful for the demo adapter and unit tests. */
export function getDemoDeliveryShipments(
  source: readonly DeliveryShipmentDto[],
  input: DeliveryShipmentsInput = {},
): DeliveryShipmentsDto {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  let rows = source.filter((row) => {
    if (input.businessDate && row.businessDate !== input.businessDate)
      return false;
    if (input.cashSessionId && row.cashSessionId !== input.cashSessionId)
      return false;
    if (input.driverUserId === "UNASSIGNED" && row.driverUserId) return false;
    if (
      input.driverUserId &&
      input.driverUserId !== "ALL" &&
      input.driverUserId !== "UNASSIGNED" &&
      row.driverUserId !== input.driverUserId
    )
      return false;
    if (input.status && input.status !== "ALL" && row.status !== input.status)
      return false;
    if (
      input.direction &&
      input.direction !== "ALL" &&
      row.direction !== input.direction
    )
      return false;
    if (
      query &&
      !`${row.orderNumber} ${row.customerName ?? ""} ${row.driverName ?? ""}`
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    return true;
  });
  rows = [...rows].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  const requestedPage = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Math.floor(input.pageSize ?? 25)));
  const totals = rows.reduce(
    (sum, row) => {
      if (row.status === "PENDING") {
        sum.pendingCount += 1;
        sum.pendingAmountMinor += row.amountDueMinor - row.settledAmountMinor;
      } else if (row.status === "SETTLED") {
        sum.settledCount += 1;
        sum.settledAmountMinor += row.settledAmountMinor;
      }
      sum.customerChargesMinor += row.customerChargeMinor;
      sum.driverRemunerationMinor += row.driverRemunerationMinor ?? 0;
      sum.collectedByDriverMinor += row.collectedByDriverMinor;
      return sum;
    },
    {
      pendingCount: 0,
      pendingAmountMinor: 0,
      settledCount: 0,
      settledAmountMinor: 0,
      customerChargesMinor: 0,
      driverRemunerationMinor: 0,
      collectedByDriverMinor: 0,
    },
  );
  const totalCount = rows.length;
  const pageCount = Math.ceil(totalCount / pageSize);
  const page = Math.min(requestedPage, Math.max(1, pageCount));
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    totalCount,
    pageCount,
    hasNextPage: page < pageCount,
    totals,
  };
}

export function projectDemoShipments(
  orders: readonly OrderDto[],
  ledger: readonly DeliveryLedgerDto[],
  sessions: readonly CashSessionDto[],
  input: DeliveryShipmentsInput = {},
  defaultDriverOwnership = true,
): DeliveryShipmentsDto {
  const byOrder = new Map(ledger.map((item) => [item.orderId, item]));
  const bySession = new Map(
    sessions.map((session) => [session.id, session.businessDate]),
  );
  const rows = orders
    .filter((order) => order.type === "DELIVERY")
    .map((order): DeliveryShipmentDto => {
      const item = byOrder.get(order.id);
      const owns = order.deliveryFeeBelongsToDriver ?? defaultDriverOwnership;
      return {
        id: item?.id ?? `order:${order.id}`,
        orderId: order.id,
        orderNumber: order.number,
        cashSessionId: order.cashSessionPaidId ?? order.cashSessionCreatedId,
        businessDate:
          bySession.get(
            order.cashSessionPaidId ?? order.cashSessionCreatedId,
          ) ?? null,
        driverUserId: order.driverUserId,
        driverName: order.driverName,
        customerName: order.customerNameSnapshot,
        deliveryAddress: order.deliveryAddressSnapshot,
        orderCreatedAt: order.createdAt,
        operationalStatus: order.operationalStatus,
        lifecycleStatus: order.lifecycleStatus,
        paymentStatus: order.paymentStatus,
        deliveryFeeMinor: order.deliveryFeeMinor,
        customerChargeMinor: order.deliveryFeeMinor,
        driverRemunerationMinor:
          order.driverRemunerationMinor ?? (owns ? order.deliveryFeeMinor : 0),
        agreedRemunerationMinor: order.driverRemunerationMinor ?? null,
        collectedByDriverMinor: order.collectedByDriver ? order.paidMinor : 0,
        restaurantAmountMinor:
          item?.restaurantAmountMinor ??
          Math.max(0, order.totalMinor - order.deliveryFeeMinor),
        direction: item?.direction ?? "DRIVER_OWES_BUSINESS",
        amountDueMinor: item?.amountDueMinor ?? 0,
        settledAmountMinor: item?.settledAmountMinor ?? 0,
        status: item?.status ?? "NO_SETTLEMENT",
        createdAt: item?.createdAt ?? order.createdAt,
        settledAt: item?.settledAt ?? null,
      };
    });
  const active = sessions.find((session) => session.status === "OPEN");
  return getDemoDeliveryShipments(
    input.scope === "OPERATIONAL"
      ? rows.filter((row) => row.cashSessionId === active?.id)
      : rows,
    input,
  );
}
