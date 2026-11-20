import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteGastronomyRepository } from "./sqlite-repository";
import { configuredTestRepository } from "./configured-test-repository";

/** A deliberately mixed tender/refund/reversal fixture used for before/after parity. */
function exercise(Repo: typeof SqliteGastronomyRepository, verifyMigration = false) {
  const path = join(tmpdir(), `gastronomy-cash-parity-${randomUUID()}.sqlite`);
  const repo = new Repo(path, { adminPin: "1234", seedStarterCatalog: true });
  try {
    if (repo.isInitialAdminPinSetupRequired()) repo.setInitialAdminPin({ currentPin: "1234", newPin: "2468" });
    const session = repo.openCashSession({ openingAmountMinor: 100_000 });
    const expense = repo.createFinanceExpense({ authorizerPin: "2468", title: "Parity expense", category: "QA", kind: "GENERAL", amountMinor: 1_000, incurredOn: "2026-11-20", dueOn: "2026-11-20", note: "cash reversal" });
    repo.payFinanceExpense({ authorizerPin: "2468", expenseId: expense.id, paymentMethodCode: "CASH", fromCash: true });
    const first = repo.createOrder({ type: "TAKEAWAY", customerName: "Parity A", customerPhone: "1100000001" });
    repo.addOrderItem({ orderId: first.id, productId: "starter-gaseosa", quantity: 2 });
    const confirmed = repo.confirmOrder({ orderId: first.id });
    const paid = repo.payOrder({ orderId: first.id, payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor + 500, receivedMinor: confirmed.totalMinor + 500 }], change: { methodCode: "TRANSFER", amountMinor: 500 } });
    repo.refundPayment({ orderId: first.id, paymentId: paid.payments[0]!.id, amountMinor: 100, reason: "Paridad parcial", authorizerPin: "2468" });

    const second = repo.createOrder({ type: "TAKEAWAY", customerName: "Parity B", customerPhone: "1100000002" });
    repo.addOrderItem({ orderId: second.id, productId: "starter-gaseosa", quantity: 1 });
    const secondConfirmed = repo.confirmOrder({ orderId: second.id });
    const secondPaid = repo.payOrder({ orderId: second.id, payments: [{ methodCode: "CASH", amountMinor: secondConfirmed.totalMinor }] });
    repo.refundPayment({ orderId: second.id, paymentId: secondPaid.payments[0]!.id, amountMinor: secondConfirmed.totalMinor, reason: "Paridad total", authorizerPin: "2468" });
    const updated = repo.registerCashMovement({ type: "INCOME", amountMinor: 777, reason: "Parity manual income", paymentMethodCode: "CASH" });
    const movement = updated.movements!.find(m => m.reason === "Parity manual income")!;
    repo.reverseCashMovement({ movementId: movement.id, reason: "Paridad reversión", authorizerPin: "2468", idempotencyKey: "parity-reversal" });
    const beforeClose = repo.bootstrap().cashSession;
    const report = repo.getCashSessionReport({ cashSessionId: session.id, paymentMethodCode: "CASH" });
    const closed = repo.closeCashSession({ countedAmountMinor: beforeClose!.expectedAmountMinor, closingFloatAmountMinor: 0, force: true, reason: "Parity close", authorizerPin: "2468" });
    const history = repo.listCashSessionHistory();
    const orders = [repo.getOrder(first.id), repo.getOrder(second.id)];
    assert.ok(beforeClose?.movements?.find(m => m.id === movement.id)?.reversedById);
    assert.equal(beforeClose?.expectedAmountMinor, 100_000 - 1_000 + confirmed.totalMinor + 500 - 100);
    assert.equal(report.totals.salesMinor, confirmed.totalMinor - 100);
    // Same persisted IDs, timestamps, reversal links and amounts before/after v53.
    if (verifyMigration) {
      const filters = [{}, {paymentMethodCode: "CASH"}, {productId: "starter-gaseosa"}, {categoryName: "Bebidas"}];
      const expected = filters.map(f => repo.getCashSessionReport({ ...f, cashSessionId: session.id }));
      const migrated = new SqliteGastronomyRepository(path);
      try {
        assert.deepEqual(filters.map(f => migrated.getCashSessionReport({ ...f, cashSessionId: session.id })), expected);
        assert.deepEqual(migrated.listCashSessionHistory(), history);
        const summary = migrated.listCashSessionHistoryPage().items[0]!;
        assert.equal(summary.id, session.id);
        assert.equal(summary.salesTotalMinor, history[0]!.session.salesTotalMinor);
        assert.deepEqual(orders.map(o => migrated.getOrder(o.id)), orders);
      } finally { migrated.close(); }
    }
    return { beforeClose, closed, report, history, orders };
  } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/^(id|.*Id|.*At|createdAt|openedAt|closedAt|timestamp)$/i.test(key)) continue;
    out[key] = comparable(item);
  }
  return out;
}

test("cash flow remains amount/DTO-parity safe across change, refunds, reversals, close and history", () => {
  const current = exercise(SqliteGastronomyRepository);
  assert.ok(current.beforeClose!.expectedAmountMinor >= 0);
  assert.equal(current.closed.expectedAmountMinor, current.closed.countedAmountMinor);
  assert.equal(current.orders[0]!.payments[0]!.refundedMinor, 100);
  assert.equal(current.orders[1]!.payments[0]!.refundedMinor, current.orders[1]!.payments[0]!.amountMinor);
  assert.equal(current.history.length, 1);

  const baselinePath = process.env.GASTRONOMY_CASH_BASELINE;
  if (!baselinePath) return;
  const baseline = createRequire(import.meta.url)(baselinePath).SqliteGastronomyRepository as typeof SqliteGastronomyRepository;
  assert.deepEqual(comparable(current), comparable(exercise(baseline, true)));
});

test("closed summary excludes both the tender and the change of a cancelled sale", () => {
  const repo = configuredTestRepository(":memory:", { adminPin: "2468", seedStarterCatalog: true });
  try {
    const session = repo.openCashSession({ openingAmountMinor: 100_000 });
    const draft = repo.createOrder({ type: "TAKEAWAY", customerName: "QA", customerPhone: "1100000000" });
    repo.addOrderItem({ orderId: draft.id, productId: "starter-gaseosa" });
    const { totalMinor } = repo.confirmOrder({ orderId: draft.id });
    const paid = repo.payOrder({ orderId: draft.id, payments: [{ methodCode: "TRANSFER", amountMinor: totalMinor + 400 }], change: { methodCode: "CASH", amountMinor: 400 } });
    repo.refundPayment({ orderId: draft.id, paymentId: paid.payments[0]!.id, reason: "QA devolución", authorizerPin: "2468" });
    repo.cancelOrder({ orderId: draft.id, reason: "QA anulación", authorizerPin: "2468" });
    const balance = repo.bootstrap().cashSession!.expectedAmountMinor;
    repo.closeCashSession({ countedAmountMinor: balance, closingFloatAmountMinor: 0 });
    const full = repo.getCashSessionReport({ cashSessionId: session.id });
    assert.equal(full.totals.salesMinor, 0);
    assert.equal(full.session.expectedAmountMinor, balance);
    assert.equal(repo.listCashSessionHistoryPage().items[0]!.salesTotalMinor, 0);
    const plan = repo.db.prepare("EXPLAIN QUERY PLAN SELECT id FROM cash_movements WHERE reference_id=?").all("any") as { detail: string }[];
    assert.ok(plan.some(step => step.detail.includes("cash_movements_reference_idx")));
  } finally { repo.close(); }
});

test("one order paid across two shifts appears once in each report with only that shift's money", () => {
  const repo = configuredTestRepository(":memory:", { seedStarterCatalog: true });
  try {
    const first = repo.openCashSession({ openingAmountMinor: 0 });
    const draft = repo.createOrder({ type: "TAKEAWAY", customerName: "QA", customerPhone: "1100000000" });
    repo.addOrderItem({ orderId: draft.id, productId: "starter-gaseosa" });
    const price = repo.confirmOrder({ orderId: draft.id }).totalMinor;
    const paid = repo.payOrder({ orderId: draft.id, payments: [{ methodCode: "CASH", amountMinor: price }] });
    repo.refundPayment({ orderId: draft.id, paymentId: paid.payments[0]!.id, amountMinor: price / 2,
      reason: "Reintegrar parte para cambiar el medio de pago", authorizerPin: "2468" });
    repo.closeCashSession({ countedAmountMinor: price / 2, force: true, reason: "Cambio de turno", authorizerPin: "2468" });
    const second = repo.openCashSession({ openingAmountMinor: 0 });
    repo.payOrder({ orderId: draft.id, payments: [{ methodCode: "TRANSFER", amountMinor: price / 2 }] });
    repo.updateOrderStatus(draft.id, "DELIVERED");
    repo.closeCashSession({ countedAmountMinor: 0 });
    for (const [session, method] of [[first, "CASH"], [second, "TRANSFER"]] as const) {
      const report = repo.getCashSessionReport({ cashSessionId: session.id, paymentMethodCode: method });
      assert.equal(report.totals.salesMinor, price / 2);
      assert.deepEqual(report.orders.map(o => [o.id, o.paidMinor]), [[draft.id, price / 2]]);
      assert.equal(report.byProduct[0]!.quantity, 0.5);
    }
    assert.deepEqual(repo.listCashSessionHistoryPage().items.map(s => s.salesTotalMinor), [price / 2, price / 2]);
  } finally { repo.close(); }
});
