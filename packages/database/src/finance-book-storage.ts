import type Database from "better-sqlite3-multiple-ciphers";
import type {
  FinanceBookEvent,
  FinanceBookSources,
  PurchaseDto,
} from "@gastronomy/contracts";
import {
  businessDateFromOpening,
  financePurchaseSources,
  financeReceivedQuantities,
  financeReplacementMonth,
  financeTenderSources,
  type BookChange,
  type BookTender,
} from "@gastronomy/domain";

type Db = InstanceType<typeof Database>;

export function readFinanceBookEvents(db: Db): FinanceBookEvent[] {
  const rows = db
    .prepare("SELECT entry_json FROM finance_book_entries ORDER BY sequence")
    .all() as { entry_json: string }[];
  return rows.map((row) => JSON.parse(row.entry_json) as FinanceBookEvent);
}

export function saveFinanceBookEvent(db: Db, event: FinanceBookEvent) {
  db.prepare(
    "INSERT INTO finance_book_entries (id,request_key,entry_json) VALUES (?,?,?)",
  ).run(event.id, event.idempotencyKey, JSON.stringify(event));
}

/** Called inside the same transaction as the receipt and the finance entry. */
export function applyFinanceScheduleChange(db: Db, event: FinanceBookEvent) {
  const i = event.input;
  if (i.kind === "cash_category") {
    const valid = db
      .prepare(
        `SELECT 1 FROM cash_movements cm WHERE cm.id=? AND cm.type='EXPENSE'
      AND cm.reference_id IS NULL AND cm.order_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM cash_movements rev WHERE rev.reference_id=cm.id)
      AND NOT EXISTS (SELECT 1 FROM finance_expenses e WHERE e.cash_movement_id=cm.id)
      AND NOT EXISTS (SELECT 1 FROM finance_expense_closed_payment_corrections c WHERE c.original_movement_id=cm.id)
      AND NOT EXISTS (SELECT 1 FROM delivery_ledger l WHERE l.status='SETTLED' AND l.settled_at=cm.created_at AND l.settled_amount_minor=cm.amount_minor AND cm.reason LIKE 'Liquidación de reparto%')`,
      )
      .get(i.movementId);
    if (!valid)
      throw new Error(
        "Este egreso de caja ya no está disponible para clasificar.",
      );
  }
  if (i.kind !== "recurring_rate") return;
  const rule = db
    .prepare(
      "SELECT start_month,amount_minor FROM finance_recurring WHERE id=? AND active=1",
    )
    .get(i.recurringId) as
    { start_month: string; amount_minor: number } | undefined;
  if (!rule || rule.amount_minor !== i.expectedAmountMinor)
    throw new Error("La regla mensual cambió. Actualizá la pantalla.");
  const previousEnd = financeReplacementMonth(
    i.startMonth,
    rule.start_month,
    businessDateFromOpening(event.createdAt),
  );
  const from = i.startMonth + "-01";
  if (
    db
      .prepare(
        `SELECT 1 FROM finance_expenses WHERE recurring_id=? AND incurred_on>=?
      AND ((revision<>0 AND amount_minor<>?) OR paid_at IS NOT NULL OR cancelled_at IS NOT NULL) LIMIT 1`,
      )
      .get(i.recurringId, from, rule.amount_minor)
  )
    throw new Error(
      "Hay cuotas modificadas o pagadas desde ese mes. Elegí una vigencia posterior.",
    );
  db.prepare(
    "UPDATE finance_recurring SET active=0,stop_month=? WHERE id=?",
  ).run(previousEnd, i.recurringId);
  db.prepare(
    `INSERT INTO finance_recurring(id,title,category,kind,amount_minor,day_of_month,start_month,employee_id,active,created_at)
    SELECT ?,title,category,kind,?,day_of_month,?,employee_id,1,? FROM finance_recurring WHERE id=?`,
  ).run(event.id, i.amountMinor, i.startMonth, event.createdAt, i.recurringId);
  db.prepare(
    "UPDATE finance_expenses SET recurring_id=?, amount_minor=?, revision=revision+1 WHERE recurring_id=? AND incurred_on>=?",
  ).run(event.id, i.amountMinor, i.recurringId, from);
}

export function readFinanceBookSources(
  db: Db,
  purchases: PurchaseDto[],
): FinanceBookSources {
  const tenders = db
    .prepare(
      `SELECT p.id, p.order_id AS orderId, COALESCE(o.shift_number,o.number) AS orderNumber,
      p.created_at AS occurredAt, p.amount_minor AS amountMinor, pm.code AS method,
      COALESCE(r.total,0) AS refundedMinor, o.operational_status = 'CANCELLED' AS voided
    FROM payments p JOIN orders o ON o.id=p.order_id JOIN payment_methods pm ON pm.id=p.payment_method_id
    LEFT JOIN (SELECT payment_id,SUM(amount_minor) AS total FROM payment_refunds GROUP BY payment_id) r ON r.payment_id=p.id
    WHERE pm.affects_cash=0 AND pm.code NOT IN ('ACCOUNT','CASH') ORDER BY p.created_at,p.rowid`,
    )
    .all() as BookTender[];
  const change = db
    .prepare(
      `SELECT cm.order_id AS orderId, cm.created_at AS occurredAt, pm.code AS method, cm.amount_minor AS amountMinor
    FROM cash_movements cm JOIN payment_methods pm ON pm.id=cm.payment_method_id
    WHERE cm.type='REFUND' AND cm.reason LIKE 'Vuelto cobro pedido #%' AND pm.affects_cash=0`,
    )
    .all() as BookChange[];
  const theoreticalInventory = db
    .prepare(
      `SELECT p.id AS itemId, p.name, p.stock_minor / 1000.0 AS quantity, 'un.' AS unit
    FROM products p JOIN categories c ON c.id=p.category_id
    WHERE p.active=1 AND c.stock_control_enabled=1 AND p.stock_minor IS NOT NULL ORDER BY p.name COLLATE NOCASE`,
    )
    .all() as FinanceBookSources["theoreticalInventory"];
  const customerBalances = db
    .prepare(
      `SELECT cu.id, cu.name,
      SUM(c.amount_minor+c.adjustment_minor-COALESCE(a.settled,0)) AS outstandingMinor
    FROM customer_account_charges c JOIN customers cu ON cu.id=c.customer_id
    LEFT JOIN (SELECT order_id,SUM(amount_minor) AS settled FROM customer_account_allocations GROUP BY order_id) a ON a.order_id=c.order_id
    GROUP BY cu.id HAVING outstandingMinor>0 ORDER BY outstandingMinor DESC`,
    )
    .all() as { id: string; name: string; outstandingMinor: number }[];
  const received = financeReceivedQuantities(purchases);
  const adjustmentTargets = db
    .prepare(
      "SELECT 'expense' AS type, id, incurred_on AS occurredAt FROM finance_expenses",
    )
    .all() as NonNullable<FinanceBookSources["adjustmentTargets"]>;
  return {
    adjustmentTargets,
    purchases: financePurchaseSources(purchases),
    posPayments: financeTenderSources(tenders, change),
    theoreticalInventory: theoreticalInventory.map((p) => ({
      ...p,
      receivedQuantity: (received.get(p.itemId) ?? 0) / 1000,
    })),
    customerBalances,
  };
}
