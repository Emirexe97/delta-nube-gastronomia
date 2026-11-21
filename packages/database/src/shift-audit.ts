import type Database from "better-sqlite3-multiple-ciphers";
import type {
  CashSessionDto,
  OrderDto,
  ShiftAuditDto,
  ShiftAuditEvent,
  ShiftAuditInput,
  ShiftAuditOrder,
  ShiftOrderAuditDto,
  ShiftOrderAuditInput,
} from "@gastronomy/contracts";

type Db = InstanceType<typeof Database>;
type Row = Record<string, unknown>;
export interface ShiftAuditReaderDeps {
  session(row: Row): CashSessionDto;
  order(id: string): OrderDto;
}
const str = (value: unknown) => (value == null ? null : String(value));
const num = (value: unknown) => (value == null ? null : Number(value));
function sessionRow(db: Db, id: string) {
  const row = db.prepare("SELECT * FROM cash_sessions WHERE id=?").get(id) as
    Row | undefined;
  if (!row) throw new Error("No se encontró el turno.");
  return row;
}
// Prior to v58 operational events had no explicit shift. Attribute them only
// where exactly one historical opening interval contains the timestamp.
const eventSession = `COALESCE(e.cash_session_id, (
  SELECT CASE WHEN COUNT(*)=1 THEN MIN(s.id) END FROM cash_sessions s
  WHERE s.opened_at<=e.occurred_at AND (s.closed_at IS NULL OR e.occurred_at<=s.closed_at)))`;
const involved = `SELECT id FROM orders WHERE cash_session_created_id=@session OR cash_session_paid_id=@session
  UNION SELECT order_id FROM payments WHERE cash_session_id=@session
  UNION SELECT order_id FROM payment_refunds WHERE cash_session_id=@session
  UNION SELECT order_id FROM cash_movements WHERE cash_session_id=@session AND order_id IS NOT NULL
  UNION SELECT a.order_id FROM customer_account_allocations a JOIN customer_account_receipts r ON r.id=a.receipt_id WHERE r.cash_session_id=@session
  UNION SELECT e.aggregate_id FROM domain_events e WHERE e.aggregate_type='Order' AND
    (e.cash_session_id=@session OR (e.cash_session_id IS NULL AND e.occurred_at BETWEEN
      (SELECT opened_at FROM cash_sessions WHERE id=@session) AND COALESCE((SELECT closed_at FROM cash_sessions WHERE id=@session),'9999')
      AND ${eventSession}=@session))
  UNION SELECT order_id FROM shift_order_closures WHERE cash_session_id=@session`;

export function captureShiftOrders(
  db: Db,
  session: string,
  load: (ids: string[]) => OrderDto[],
) {
  const ids = (
    db
      .prepare(`SELECT o.id FROM orders o WHERE o.id IN (${involved})`)
      .all({ session }) as Row[]
  ).map((r) => String(r.id));
  const insert =
    db.prepare(`INSERT OR IGNORE INTO shift_order_closures(cash_session_id,order_id,order_json,settlement_status)
    VALUES (?,?,?,(SELECT status FROM delivery_ledger WHERE order_id=?))`);
  for (let start = 0; start < ids.length; start += 100) {
    for (const order of load(ids.slice(start, start + 100)))
      insert.run(session, order.id, JSON.stringify(order), order.id);
  }
}

type Scope = { session: string } | { order: string };
type Money = ShiftAuditEvent & { collected: number; kind: string };
const signedOut = new Set(["EXPENSE", "WITHDRAWAL", "REFUND"]);
const kinds: Record<string, string> = {
  OPENING: "Apertura",
  CLOSING: "Cierre",
  SALE: "Cobro",
  INCOME: "Ingreso",
  EXPENSE: "Egreso",
  WITHDRAWAL: "Retiro",
  REFUND: "Devolución",
  ADJUSTMENT: "Ajuste",
};
function moneyRows(db: Db, scope: Scope): Money[] {
  const perOrder = "order" in scope;
  const predicate = (alias: string) =>
    perOrder ? alias + ".order_id=@order" : alias + ".cash_session_id=@session";
  // Some receipts cover several orders. The shift shows the whole movement
  // once and each order shows only its own allocation.
  const rows = db
    .prepare(
      `SELECT m.*, cs.number session_number, COALESCE(o.shift_number,o.number) order_number,
      p.code method_code,p.name method,u.full_name operator,r.id receipt_id,r.reference receipt_reference
      ${perOrder ? ",a.amount_minor allocated" : ""}
    FROM cash_movements m JOIN cash_sessions cs ON cs.id=m.cash_session_id
    LEFT JOIN users u ON u.id=m.user_id LEFT JOIN payment_methods p ON p.id=m.payment_method_id
    LEFT JOIN customer_account_receipts r ON r.cash_movement_id=m.id
    ${perOrder ? "LEFT JOIN customer_account_allocations a ON a.receipt_id=r.id AND a.order_id=@order" : ""}
    LEFT JOIN orders o ON o.id=${perOrder ? "COALESCE(a.order_id,m.order_id)" : "m.order_id"}
    WHERE ${predicate("m")} ${perOrder ? "OR a.order_id IS NOT NULL" : ""} ORDER BY m.created_at,m.rowid`,
    )
    .all(scope) as Row[];
  const tenders = db
    .prepare(
      `SELECT p.*,NULL authorizer FROM payments p WHERE ${predicate("p")} ORDER BY p.rowid`,
    )
    .all(scope) as Row[];
  const refunds = db
    .prepare(
      `SELECT f.*,p.payment_method_id,u.full_name authorizer FROM payment_refunds f
    JOIN payments p ON p.id=f.payment_id LEFT JOIN users u ON u.id=f.authorized_by_user_id
    WHERE ${predicate("f")} ORDER BY f.rowid`,
    )
    .all(scope) as Row[];
  const key = (r: Row) =>
    JSON.stringify([
      r.cash_session_id,
      r.order_id,
      r.created_at,
      r.payment_method_id,
      r.amount_minor,
    ]);
  function queues(items: Row[]) {
    const grouped = new Map<string, Row[]>();
    for (const row of items) {
      const id = key(row);
      const group = grouped.get(id) ?? [];
      group.push(row);
      grouped.set(id, group);
    }
    return grouped;
  }
  const sales = queues(tenders),
    returns = queues(refunds);
  return rows.map((r) => {
    const kind = String(r.type),
      reason = str(r.reason),
      change =
        kind === "REFUND" &&
        Boolean(reason?.startsWith("Vuelto cobro pedido #"));
    const record =
      kind === "SALE"
        ? sales.get(key(r))?.shift()
        : kind === "REFUND" && !change
          ? returns.get(key(r))?.shift()
          : undefined;
    const amount =
      Number(r.allocated ?? r.amount_minor) * (signedOut.has(kind) ? -1 : 1);
    const inDrawer =
      Number(r.affects_cash) && kind !== "OPENING" && kind !== "CLOSING";
    const label = r.receipt_id
      ? "Cobro de cuenta corriente"
      : change
        ? "Vuelto"
        : kind === "SALE" && r.method_code === "ACCOUNT"
          ? "Venta a cuenta corriente"
          : (kinds[kind] ?? kind);
    return {
      id: String(r.id),
      occurredAt: String(r.created_at),
      cashSessionId: String(r.cash_session_id),
      sessionNumber: Number(r.session_number),
      orderId: perOrder ? scope.order : str(r.order_id),
      orderNumber: num(r.order_number),
      label,
      method: str(r.method),
      amountMinor: amount,
      cashEffectMinor: inDrawer ? amount : 0,
      operator: str(r.operator),
      authorizer: str(record?.authorizer),
      reason,
      receivedMinor: num(record?.received_minor),
      reference: str(record?.reference ?? r.receipt_reference),
      kind,
      collected:
        (kind === "SALE" || kind === "REFUND" || r.receipt_id) &&
        r.method_code !== "ACCOUNT"
          ? amount
          : 0,
    };
  });
}
const operational: Record<string, string> = {
  OrderCreated: "Creado",
  OrderConfirmed: "Confirmado",
  OrderPaid: "Cobro registrado",
  OrderUpdated: "Pedido modificado",
  OrderCancelled: "Anulado",
  OrderTableChanged: "Cambio de mesa",
  OrderServed: "Servido",
  OrderItemNotesUpdated: "Observación de un producto",
  ComboAdded: "Combo agregado",
};
const states: Record<string, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmado",
  IN_PREPARATION: "En preparación",
  READY: "Listo",
  OUT_FOR_DELIVERY: "En reparto",
  DELIVERED: "Entregado",
  CANCELLED: "Anulado",
  COMPLETED: "Completado",
};
function operationLabel(row: Row) {
  const payload = JSON.parse(String(row.payload_json)) as Row;
  if (payload.operationalStatus)
    return (
      states[String(payload.operationalStatus)] ??
      String(payload.operationalStatus)
    );
  if ("driverUserId" in payload)
    return payload.driverUserId ? "Repartidor asignado" : "Repartidor retirado";
  if ("depositMinor" in payload) return "Seña actualizada";
  return operational[String(row.event_type)] ?? "Pedido actualizado";
}
function operationRows(db: Db, scope: Scope): ShiftAuditEvent[] {
  const rows = db
    .prepare(
      `SELECT e.*,cs.id shift_id,cs.number session_number,COALESCE(o.shift_number,o.number) order_number,
    u.full_name operator FROM domain_events e JOIN orders o ON o.id=e.aggregate_id
    LEFT JOIN users u ON u.id=e.actor_user_id LEFT JOIN cash_sessions cs ON cs.id=${eventSession}
    WHERE e.aggregate_type='Order' AND ${"order" in scope ? "e.aggregate_id=@order" : "cs.id=@session AND (e.cash_session_id=@session OR (e.cash_session_id IS NULL AND e.occurred_at BETWEEN cs.opened_at AND COALESCE(cs.closed_at,'9999')))"}`,
    )
    .all(scope) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    orderId: String(r.aggregate_id),
    orderNumber: num(r.order_number),
    occurredAt: String(r.occurred_at),
    cashSessionId: str(r.shift_id),
    sessionNumber: num(r.session_number),
    label: operationLabel(r),
    method: null,
    amountMinor: null,
    cashEffectMinor: null,
    operator: str(r.operator),
    reason: str((JSON.parse(String(r.payload_json)) as Row).reason),
  }));
}
function orderRows(
  db: Db,
  session: string,
  movements: Money[],
): ShiftAuditOrder[] {
  const reasons = new Map<string, Set<string>>(),
    totals = new Map<string, number>();
  function reason(id: string, label: string) {
    const values = reasons.get(id) ?? new Set();
    values.add(label);
    reasons.set(id, values);
  }
  for (const e of operationRows(db, { session }))
    if (e.orderId) reason(e.orderId, e.label);
  for (const m of movements)
    if (m.orderId) {
      reason(m.orderId, m.label);
      totals.set(m.orderId, (totals.get(m.orderId) ?? 0) + m.collected);
    }
  const allocations = db
    .prepare(
      `SELECT a.order_id,sum(a.amount_minor) amount FROM customer_account_allocations a
    JOIN customer_account_receipts r ON r.id=a.receipt_id WHERE r.cash_session_id=? GROUP BY a.order_id`,
    )
    .all(session) as Row[];
  for (const a of allocations) {
    const id = String(a.order_id);
    reason(id, "Cobro de cuenta corriente");
    totals.set(id, (totals.get(id) ?? 0) + Number(a.amount));
  }
  const rows = db
    .prepare(
      `WITH ids AS (${involved})
    SELECT o.*,ids.id audit_order_id,u.full_name driver_name,x.order_json,x.settlement_status,dl.status current_settlement
    FROM ids LEFT JOIN orders o ON o.id=ids.id LEFT JOIN users u ON u.id=o.driver_user_id
    LEFT JOIN delivery_ledger dl ON dl.order_id=ids.id
    LEFT JOIN shift_order_closures x ON x.order_id=ids.id AND x.cash_session_id=@session
    WHERE o.id IS NOT NULL OR x.order_json IS NOT NULL ORDER BY o.created_at DESC,o.number DESC`,
    )
    .all({ session }) as Row[];
  return rows.map((r) => {
    const id = String(r.audit_order_id),
      snap = r.order_json
        ? (JSON.parse(String(r.order_json)) as OrderDto)
        : null;
    if (r.cash_session_created_id === session) reason(id, "Creado");
    if (r.cash_session_paid_id === session) reason(id, "Cobro registrado");
    const fee = snap?.deliveryFeeMinor ?? Number(r.delivery_fee_minor),
      pay = snap
        ? snap.driverRemunerationMinor
        : num(r.driver_remuneration_minor);
    const driverOwns = snap
      ? snap.deliveryFeeBelongsToDriver
      : r.delivery_fee_belongs_to_driver == null
        ? undefined
        : Boolean(r.delivery_fee_belongs_to_driver);
    const status = snap ? r.settlement_status : r.current_settlement;
    return {
      orderId: id,
      number: snap?.number ?? Number(r.shift_number ?? r.number),
      type: (snap?.type ?? r.type) as ShiftAuditOrder["type"],
      status: snap?.operationalStatus ?? String(r.operational_status),
      customerName: snap
        ? snap.customerNameSnapshot
        : str(r.customer_name_snapshot),
      driverName: snap ? snap.driverName : str(r.driver_name),
      totalMinor: snap?.totalMinor ?? Number(r.total_minor),
      collectedMinor: totals.get(id) ?? 0,
      reasons: [...(reasons.get(id) ?? [])],
      deliveryFeeMinor: fee,
      driverPayMinor:
        pay ??
        (driverOwns === undefined && fee > 0
          ? undefined
          : driverOwns
            ? fee
            : 0),
      settlementLabel:
        status === "PENDING"
          ? "Pendiente"
          : status === "SETTLED"
            ? "Rendido"
            : "Sin rendición",
      hasClosingSnapshot: Boolean(snap),
    };
  });
}
function pageNumber(value: number | undefined, fallback: number) {
  return value != null && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}
function summary(db: Db, id: string, deps: ShiftAuditReaderDeps) {
  const { movements, ...session } = deps.session(sessionRow(db, id));
  return session;
}
export function readShiftAudit(
  db: Db,
  input: ShiftAuditInput,
  deps: ShiftAuditReaderDeps,
): ShiftAuditDto {
  const session = summary(db, input.cashSessionId, deps),
    pageSize = Math.min(100, pageNumber(input.pageSize, 25));
  const money = moneyRows(db, { session: session.id });
  const needle =
    input.search?.trim().toLocaleLowerCase("es").replace(/^#/, "") ?? "";
  const matches = (values: unknown[]) =>
    !needle ||
    values.some(
      (v) => v != null && String(v).toLocaleLowerCase("es").includes(needle),
    );
  const orders =
    input.section === "movements"
      ? []
      : orderRows(db, session.id, money).filter(
          (o) =>
            (input.section !== "deliveries" || o.type === "DELIVERY") &&
            matches([
              o.number,
              o.type,
              o.status,
              o.customerName,
              o.driverName,
              ...o.reasons,
              o.settlementLabel,
            ]),
        );
  const events =
    input.section === "movements"
      ? money
          .filter((m) =>
            matches([
              m.orderNumber,
              m.label,
              m.reason,
              m.method,
              m.reference,
              m.operator,
              m.authorizer,
              m.amountMinor,
            ]),
          )
          .reverse()
      : [];
  const totalCount = orders.length + events.length,
    page = Math.min(
      Math.max(1, Math.ceil(totalCount / pageSize)),
      pageNumber(input.page, 1),
    );
  const start = (page - 1) * pageSize;
  return {
    session,
    orders: orders.slice(start, start + pageSize),
    movements: events.slice(start, start + pageSize),
    page,
    pageSize,
    totalCount,
  };
}
export function readShiftOrderAudit(
  db: Db,
  input: ShiftOrderAuditInput,
  deps: ShiftAuditReaderDeps,
): ShiftOrderAuditDto {
  const session = summary(db, input.cashSessionId, deps);
  if (
    !db
      .prepare(`SELECT 1 FROM (${involved}) AS ids WHERE ids.id=@order`)
      .get({ session: session.id, order: input.orderId })
  )
    throw new Error("El pedido no tuvo actividad en este turno.");
  const copy = db
    .prepare(
      "SELECT order_json FROM shift_order_closures WHERE cash_session_id=? AND order_id=?",
    )
    .get(session.id, input.orderId) as Row | undefined;
  const orderAtClose: OrderDto | null = copy
    ? JSON.parse(String(copy.order_json))
    : null;
  const order =
    orderAtClose &&
    !db.prepare("SELECT 1 FROM orders WHERE id=?").get(input.orderId)
      ? orderAtClose
      : deps.order(input.orderId);
  const scope = { order: order.id },
    events = [...operationRows(db, scope), ...moneyRows(db, scope)];
  events.sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  );
  return { session, order, orderAtClose, events };
}
