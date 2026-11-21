import type {
  DeliveryShipmentDto,
  DeliveryShipmentsDto,
  DeliveryShipmentsInput,
} from "@gastronomy/contracts";

type SqlDb = { prepare(sql: string): { all(...params: unknown[]): unknown[] } };
type Row = Record<string, unknown>;

const asNumber = (value: unknown) => Number(value ?? 0);
const asString = (value: unknown) => (value == null ? null : String(value));

/** Read-only shipment projection. It deliberately never inserts ledger rows or movements. */
export function getDeliveryShipments(
  db: SqlDb,
  input: DeliveryShipmentsInput = {},
  defaultOwnership = true,
): DeliveryShipmentsDto {
  const requestedPage = Number.isFinite(input.page)
    ? Math.max(1, Math.floor(input.page!))
    : 1;
  const pageSize = Number.isFinite(input.pageSize)
    ? Math.min(200, Math.max(1, Math.floor(input.pageSize!)))
    : 25;
  const where = ["o.type = 'DELIVERY'"];
  const params: unknown[] = [];
  if (input.scope === "OPERATIONAL") where.push("cs.status = 'OPEN'");
  if (input.businessDate) {
    where.push("cs.business_date = ?");
    params.push(input.businessDate);
  }
  if (input.cashSessionId) {
    where.push(
      "COALESCE(o.cash_session_paid_id, o.cash_session_created_id) = ?",
    );
    params.push(input.cashSessionId);
  }
  if (input.query?.trim()) {
    const query = `%${input.query.trim()}%`;
    where.push(
      "(CAST(COALESCE(o.shift_number, o.number) AS TEXT) LIKE ? OR COALESCE(o.customer_name_snapshot, '') LIKE ? OR COALESCE(u.full_name, '') LIKE ?)",
    );
    params.push(query, query, query);
  }
  if (input.driverUserId === "UNASSIGNED")
    where.push("o.driver_user_id IS NULL");
  else if (input.driverUserId && input.driverUserId !== "ALL") {
    where.push("o.driver_user_id = ?");
    params.push(input.driverUserId);
  }
  if (input.status && input.status !== "ALL") {
    where.push("COALESCE(dl.status, 'NO_SETTLEMENT') = ?");
    params.push(input.status);
  }
  if (input.direction && input.direction !== "ALL") {
    where.push("dl.direction = ?");
    params.push(input.direction);
  }
  const clause = where.join(" AND ");
  const from = `FROM orders o
    LEFT JOIN delivery_ledger dl ON dl.order_id = o.id
    LEFT JOIN cash_sessions cs ON cs.id = COALESCE(o.cash_session_paid_id, o.cash_session_created_id)
    LEFT JOIN users u ON u.id = o.driver_user_id
    WHERE ${clause}`;
  const remuneration = `COALESCE(o.driver_remuneration_minor,CASE WHEN COALESCE(o.delivery_fee_belongs_to_driver,${defaultOwnership ? 1 : 0})=1 THEN o.delivery_fee_minor ELSE 0 END)`;
  const stats = db
    .prepare(
      `SELECT COUNT(*) count, SUM(dl.status='PENDING') pending, SUM(dl.status='SETTLED') settled,
    SUM(CASE WHEN dl.status='PENDING' THEN dl.amount_due_minor-dl.settled_amount_minor ELSE 0 END) pending_amount,
    SUM(CASE WHEN dl.status='SETTLED' THEN dl.settled_amount_minor ELSE 0 END) settled_amount,
    SUM(o.delivery_fee_minor) fees,SUM(${remuneration}) driver_pay, SUM(CASE WHEN o.collected_by_driver=1 THEN o.paid_minor ELSE 0 END) collected
    ${from}`,
    )
    .all(...params)[0] as Row;
  const totalCount = asNumber(stats.count),
    pageCount = Math.ceil(totalCount / pageSize),
    page = Math.min(requestedPage, Math.max(1, pageCount));
  const rows = db
    .prepare(
      `
    SELECT dl.id, o.id AS order_id, COALESCE(o.shift_number, o.number) AS order_number,
      COALESCE(o.cash_session_paid_id, o.cash_session_created_id) AS cash_session_id,
      cs.business_date, o.driver_user_id, u.full_name AS driver_name,
      o.customer_name_snapshot, o.delivery_address_snapshot, o.created_at AS order_created_at,
      o.operational_status, o.lifecycle_status, o.payment_status,
      o.delivery_fee_minor, COALESCE(o.total_minor, 0) AS order_total_minor,
      COALESCE(o.paid_minor, 0) AS paid_minor, COALESCE(o.collected_by_driver, 0) AS collected_by_driver,
      COALESCE(o.delivery_fee_belongs_to_driver, ${defaultOwnership ? 1 : 0}) AS fee_belongs_to_driver,
      o.driver_remuneration_minor,
      dl.restaurant_amount_minor, dl.direction, dl.amount_due_minor, dl.settled_amount_minor,
      dl.status, dl.created_at, dl.settled_at
    ${from}
    ORDER BY COALESCE(dl.created_at, o.created_at) DESC, o.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Row[];
  const mapped = rows.map((row): DeliveryShipmentDto => {
    const fee = asNumber(row.delivery_fee_minor);
    const collected =
      row.collected_by_driver === 1 || row.collected_by_driver === true;
    const paid = asNumber(row.paid_minor);
    return {
      id: row.id == null ? `order:${String(row.order_id)}` : String(row.id),
      orderId: String(row.order_id),
      orderNumber: asNumber(row.order_number),
      cashSessionId: asString(row.cash_session_id),
      businessDate: asString(row.business_date),
      driverUserId: asString(row.driver_user_id),
      driverName: asString(row.driver_name),
      customerName: asString(row.customer_name_snapshot),
      deliveryAddress: asString(row.delivery_address_snapshot),
      orderCreatedAt: String(row.order_created_at),
      operationalStatus: String(
        row.operational_status,
      ) as DeliveryShipmentDto["operationalStatus"],
      lifecycleStatus: String(
        row.lifecycle_status,
      ) as DeliveryShipmentDto["lifecycleStatus"],
      paymentStatus: String(
        row.payment_status,
      ) as DeliveryShipmentDto["paymentStatus"],
      deliveryFeeMinor: fee,
      customerChargeMinor: fee,
      driverRemunerationMinor:
        row.driver_remuneration_minor == null
          ? asNumber(row.fee_belongs_to_driver)
            ? fee
            : 0
          : asNumber(row.driver_remuneration_minor),
      agreedRemunerationMinor:
        row.driver_remuneration_minor == null
          ? null
          : asNumber(row.driver_remuneration_minor),
      collectedByDriverMinor: collected ? paid : 0,
      restaurantAmountMinor:
        row.restaurant_amount_minor == null
          ? Math.max(0, asNumber(row.order_total_minor) - fee)
          : asNumber(row.restaurant_amount_minor),
      direction: String(
        row.direction ?? "DRIVER_OWES_BUSINESS",
      ) as DeliveryShipmentDto["direction"],
      amountDueMinor: asNumber(row.amount_due_minor),
      settledAmountMinor: asNumber(row.settled_amount_minor),
      status: String(
        row.status ?? "NO_SETTLEMENT",
      ) as DeliveryShipmentDto["status"],
      createdAt: String(row.created_at ?? row.order_created_at),
      settledAt: asString(row.settled_at),
    };
  });
  const totals = {
    pendingCount: asNumber(stats.pending),
    pendingAmountMinor: asNumber(stats.pending_amount),
    settledCount: asNumber(stats.settled),
    settledAmountMinor: asNumber(stats.settled_amount),
    customerChargesMinor: asNumber(stats.fees),
    driverRemunerationMinor: asNumber(stats.driver_pay),
    collectedByDriverMinor: asNumber(stats.collected),
  };
  return {
    items: mapped,
    page,
    pageSize,
    totalCount,
    pageCount,
    hasNextPage: page < pageCount,
    totals,
  };
}
