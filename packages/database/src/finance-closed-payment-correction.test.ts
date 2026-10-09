import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function fixture(
  run: (
    repo: SqliteGastronomyRepository,
    db: InstanceType<typeof Database>,
    path: string,
  ) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-closed-payment-"));
  const path = join(dir, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  const db = new Database(path);
  try {
    run(repo, db, path);
  } finally {
    db.close();
    repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("gastronomy-closed-payment-"));
    rmSync(dir, { recursive: true, force: true });
  }
}

const expenseInput = {
  title: "Proveedor aún adeudado",
  category: "Servicios",
  kind: "GENERAL" as const,
  amountMinor: 23450,
  incurredOn: "2026-10-07",
};

function setupClosed(repo: SqliteGastronomyRepository, method: "CASH" | "TRANSFER") {
  const session = repo.openCashSession({ openingAmountMinor: 100000 });
  const expense = repo.createFinanceExpense(expenseInput);
  const paid = repo.payFinanceExpense({
    expenseId: expense.id,
    paymentMethodCode: method,
    fromCash: true,
    idempotencyKey: `original-${method}`,
  });
  repo.closeCashSession({
    countedAmountMinor: 100000,
    closingFloatAmountMinor: 5000,
    force: true,
    reason: "El pago se marcó, pero el dinero no salió",
    authorizerPin: "2468",
  });
  return { session, expense, paid };
}

function correction(repo: SqliteGastronomyRepository, expenseId: string, expectedRevision: number, key: string) {
  return (repo as any).correctFinanceExpenseClosedCashPayment({
    expenseId,
    expectedRevision,
    confirmedUnpaid: true,
    reason: "El dinero nunca salió y la obligación sigue pendiente",
    authorizerPin: "2468",
    idempotencyKey: key,
  });
}

for (const method of ["CASH", "TRANSFER"] as const) {
  test(`${method}: closed-session payment correction preserves cash history and expense cost`, () =>
    fixture((repo, db) => {
      const { session, expense, paid } = setupClosed(repo, method);
      const eligible = repo.getFinanceReport({ from: "2026-10-01", to: "2026-10-31" }).expenses.find((row) => row.id === expense.id);
      assert.deepEqual(eligible?.closedCashPaymentCorrection, {
        cashSessionId: session.id,
        cashSessionNumber: session.number,
        amountMinor: expense.amountMinor,
        paymentMethodName: method === "CASH" ? "Efectivo" : "Transferencia",
        affectsCash: method === "CASH",
      });
      const movementsBefore = db.prepare("SELECT * FROM cash_movements ORDER BY id").all();
      const originalMovement = db
        .prepare("SELECT * FROM cash_movements WHERE id=(SELECT cash_movement_id FROM finance_expenses WHERE id=?)")
        .get(expense.id);
      const closeBefore = db.prepare("SELECT * FROM cash_sessions WHERE id=?").get(session.id);
      const reportBefore = repo.getCashSessionReport({ cashSessionId: session.id });
      const stockBefore = db.prepare("SELECT COALESCE(SUM(stock_minor),0) total FROM products").get();

      const corrected = correction(repo, expense.id, paid.revision!, `closed-${method}`);
      assert.equal(corrected.paidAt, null);
      assert.equal(corrected.paymentMethodCode, null);
      assert.equal(corrected.revision, paid.revision! + 1);
      assert.equal(corrected.closedCashPaymentCorrection, null);
      assert.deepEqual(
        correction(repo, expense.id, paid.revision!, `closed-${method}`),
        corrected,
        "same command receipt replays even after state changes",
      );
      assert.deepEqual(repo.payFinanceExpense({
        expenseId: expense.id, paymentMethodCode: method, fromCash: true,
        idempotencyKey: `original-${method}`,
      }), paid, "replaying the historic payment receipt cannot undo the correction");

      assert.deepEqual(
        db.prepare("SELECT * FROM cash_movements WHERE id=?").get((originalMovement as any).id),
        originalMovement,
      );
      assert.deepEqual(db.prepare("SELECT * FROM cash_sessions WHERE id=?").get(session.id), closeBefore);
      assert.deepEqual(repo.getCashSessionReport({ cashSessionId: session.id }), reportBefore);
      assert.deepEqual(db.prepare("SELECT * FROM cash_movements ORDER BY id").all(), movementsBefore);
      assert.equal((db.prepare("SELECT COALESCE(SUM(stock_minor),0) total FROM products").get() as any).total, (stockBefore as any).total);

      const history = db.prepare("SELECT * FROM finance_expense_closed_payment_corrections WHERE original_movement_id=?").get((originalMovement as any).id) as any;
      assert.equal(history.reason, "El dinero nunca salió y la obligación sigue pendiente");
      assert.equal(history.expense_id, expense.id);
      assert.equal(history.cash_session_id, session.id);
      assert.equal(history.operator_user_id, repo.bootstrap().currentUser.id);
      assert.ok(history.authorizer_user_id);
      assert.ok(history.before_json && history.after_json && history.created_at);
      assert.equal(
        (db.prepare("SELECT COUNT(*) n FROM finance_expense_payment_corrections WHERE expense_id=?").get(expense.id) as any).n,
        0,
        "closed correction is not the open-session compensating correction",
      );

      const report = repo.getFinanceReport({ from: "2026-10-01", to: "2026-10-31" });
      assert.equal(report.expensesMinor, expense.amountMinor);
      assert.equal(report.unpaidMinor, expense.amountMinor);
      assert.equal(report.expenses.find((row) => row.id === expense.id)?.paidAt, null);
      assert.equal(repo.getFinanceReport({ from: expense.incurredOn, to: expense.incurredOn }).expensesMinor, expense.amountMinor);
      assert.equal(repo.getFinanceReport({ from: session.businessDate, to: session.businessDate }).expensesMinor, 0,
        "historical movement must not reappear as unclassified expense on the old cash date");
      assert.equal((report as any).expenseReturnsMinor ?? 0, 0);
      assert.equal((db.prepare("SELECT COUNT(*) n FROM cash_movements WHERE type IN ('INCOME','ADJUSTMENT')").get() as any).n, 0);

      const current = repo.openCashSession({ openingAmountMinor: 5000 });
      assert.equal(current.expectedAmountMinor, 5000);
      repo.registerCashMovement({ type: "INCOME", amountMinor: 20000, paymentMethodCode: "CASH", reason: "Fondos reales", idempotencyKey: `fund-new-session-${method}` });
      assert.equal(repo.bootstrap().cashSession?.expectedAmountMinor, 25000);
      const repaid = repo.payFinanceExpense({
        expenseId: expense.id,
        paymentMethodCode: "CASH",
        fromCash: true,
        expectedRevision: corrected.revision,
        idempotencyKey: `real-repay-${method}`,
      });
      assert.ok(repaid.paidAt);
      assert.equal(repaid.canReceiveReturn, true, "a later genuine payment retains normal return eligibility");
      const repaidRow = db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id);
      assert.deepEqual(correction(repo, expense.id, paid.revision!, `closed-${method}`), corrected,
        "replaying the closed-correction receipt cannot undo a later genuine payment");
      assert.deepEqual(db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id), repaidRow);
      const newMovementId = (db.prepare("SELECT cash_movement_id FROM finance_expenses WHERE id=?").get(expense.id) as any).cash_movement_id;
      assert.notEqual(newMovementId, (originalMovement as any).id);
      assert.equal((db.prepare("SELECT COUNT(*) n FROM finance_expense_closed_payment_corrections WHERE original_movement_id=?").get(newMovementId) as any).n, 0);
      assert.throws(
        () => repo.reverseCashMovement({ movementId: (originalMovement as any).id, reason: "Revertir pago histórico", authorizerPin: "2468", idempotencyKey: `reverse-historical-${method}` }),
        /correcci|revers|finanzas|gasto/i,
      );
      const currentAfter = repo.getCashSessionReport({ cashSessionId: current.id });
      assert.equal(currentAfter.session.expectedAmountMinor, 1550);
      const returned = repo.receiveFinanceExpenseReturn({ expenseId: expense.id, expectedRevision: repaid.revision!,
        destination: "CASH_SESSION", paymentMethodCode: "CASH", reason: "Devolución real del pago nuevo",
        authorizerPin: "2468", idempotencyKey: `real-return-${method}` });
      assert.equal(returned.returnInfo?.originalMovementId, newMovementId,
        "a legitimate return references only the later genuine payment, never the historical marked payment");
    }));
}

test("closed correction requires explicit unpaid confirmation, GENERAL/unlinked expense, valid revision, permission, and PIN", () =>
  fixture((repo, db) => {
    const { expense, paid } = setupClosed(repo, "CASH");
    const base = {
      expenseId: expense.id,
      expectedRevision: paid.revision!,
      reason: "El dinero nunca salió y se sigue debiendo",
      authorizerPin: "2468",
      idempotencyKey: "closed-invalid-cases",
    };
    const snapshot = () => ({
      expense: db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id),
      movements: db.prepare("SELECT * FROM cash_movements ORDER BY id").all(),
      sessions: db.prepare("SELECT * FROM cash_sessions ORDER BY id").all(),
      ledgers: db.prepare("SELECT * FROM finance_expense_closed_payment_corrections ORDER BY id").all(),
      receipts: db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all(),
    });
    const before = snapshot();
    for (const input of [
      { ...base, confirmedUnpaid: false, idempotencyKey: "not-confirmed" },
      { ...base, confirmedUnpaid: undefined, idempotencyKey: "missing-confirmation" },
      { ...base, confirmedUnpaid: true, expectedRevision: paid.revision! - 1, idempotencyKey: "stale-revision" },
      { ...base, confirmedUnpaid: true, authorizerPin: "0000", idempotencyKey: "bad-pin" },
      { ...base, confirmedUnpaid: true, reason: " ", idempotencyKey: "blank-reason" },
    ]) {
      assert.throws(() => (repo as any).correctFinanceExpenseClosedCashPayment(input));
      assert.deepEqual(snapshot(), before);
    }

    db.prepare("DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code='cash.expense'").run(repo.bootstrap().currentUser.id);
    assert.throws(() => correction(repo, expense.id, paid.revision!, "permission-rejected"), /PIN|permiso|autoriz/i);
    assert.deepEqual(snapshot().expense, before.expense);
    assert.deepEqual(snapshot().movements, before.movements);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM finance_expense_closed_payment_corrections").get() as any).n, 0);
  }));

test("migration 33 upgrade adds the closed-correction ledger without rewriting existing finance or cash rows", () =>
  fixture((repo, db, path) => {
    const { session, expense, paid } = setupClosed(repo, "CASH");
    const oldExpense = db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id);
    const oldMovement = db.prepare("SELECT * FROM cash_movements WHERE id=(SELECT cash_movement_id FROM finance_expenses WHERE id=?)").get(expense.id);
    const oldSession = db.prepare("SELECT * FROM cash_sessions WHERE id=?").get(session.id);
    assert.ok(paid.paidAt);
    db.exec("DROP TABLE IF EXISTS finance_expense_closed_payment_corrections; DELETE FROM schema_migrations WHERE version=34;");
    const upgraded = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
    const upgradedDb = new Database(path);
    try {
      assert.equal((upgradedDb.prepare("SELECT version FROM schema_migrations WHERE version=34").get() as any).version, 34);
      assert.equal((upgradedDb.prepare("SELECT COUNT(*) n FROM finance_expense_closed_payment_corrections").get() as any).n, 0);
      assert.deepEqual(upgradedDb.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id), oldExpense);
      assert.deepEqual(upgradedDb.prepare("SELECT * FROM cash_movements WHERE id=?").get((oldMovement as any).id), oldMovement);
      assert.deepEqual(upgradedDb.prepare("SELECT * FROM cash_sessions WHERE id=?").get(session.id), oldSession);
    } finally {
      upgradedDb.close();
      upgraded.close();
    }
  }));

test("closed correction rejects unsupported kind, recurring expense, and an original session that is still open", () =>
  fixture((repo, db) => {
    const { expense, paid } = setupClosed(repo, "CASH");
    const base = { expenseId: expense.id, expectedRevision: paid.revision!, confirmedUnpaid: true,
      reason: "No se pagó y aún se debe", authorizerPin: "2468", idempotencyKey: "unsupported-scope" };
    const before = () => ({
      expense: db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id),
      movements: db.prepare("SELECT * FROM cash_movements ORDER BY rowid").all(),
      closedCorrections: db.prepare("SELECT * FROM finance_expense_closed_payment_corrections ORDER BY rowid").all(),
    });
    db.prepare("UPDATE finance_expenses SET kind='FIXED' WHERE id=?").run(expense.id);
    const fixed = before();
    assert.throws(() => (repo as any).correctFinanceExpenseClosedCashPayment({ ...base, idempotencyKey: "fixed-kind" }), /General|manual/i);
    assert.deepEqual(before(), fixed);
    db.prepare("UPDATE finance_expenses SET kind='GENERAL' WHERE id=?").run(expense.id);
    const recurring = repo.createFinanceRecurring({ title: "Regla fuera de alcance", category: "Servicios", kind: "FIXED",
      amountMinor: expense.amountMinor, dayOfMonth: 7, startMonth: "2026-10", idempotencyKey: "recurring-out-of-scope" });
    db.prepare("UPDATE finance_expenses SET recurring_id=? WHERE id=?").run(recurring.id, expense.id);
    const recurringState = before();
    assert.throws(() => (repo as any).correctFinanceExpenseClosedCashPayment({ ...base, idempotencyKey: "recurring-kind" }), /recurrente/i);
    assert.deepEqual(before(), recurringState);
    db.prepare("UPDATE finance_expenses SET recurring_id=NULL WHERE id=?").run(expense.id);
    const closedSessionId = (db.prepare("SELECT cash_session_id FROM cash_movements WHERE id=(SELECT cash_movement_id FROM finance_expenses WHERE id=?)").get(expense.id) as any).cash_session_id;
    db.prepare("UPDATE cash_sessions SET status='OPEN' WHERE id=?").run(closedSessionId);
    const openState = before();
    assert.throws(() => (repo as any).correctFinanceExpenseClosedCashPayment({ ...base, idempotencyKey: "open-session" }), /cerrada/i);
    assert.deepEqual(before(), openState);
  }));

test("finance permission and PIN are rechecked before replay; later cancellation does not resurrect historical cash expense", () =>
  fixture((repo, db) => {
    const { session, expense, paid } = setupClosed(repo, "CASH");
    const key = "closed-replay-permission";
    const corrected = correction(repo, expense.id, paid.revision!, key);
    const unchanged = () => ({ expense: db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id),
      movements: db.prepare("SELECT * FROM cash_movements ORDER BY rowid").all(),
      history: db.prepare("SELECT * FROM finance_expense_closed_payment_corrections ORDER BY rowid").all(),
      receipts: db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all() });
    const afterCorrection = unchanged();
    db.prepare("DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code='finance.manage'").run(repo.bootstrap().currentUser.id);
    assert.throws(() => correction(repo, expense.id, paid.revision!, key), /permiso/i);
    assert.deepEqual(unchanged(), afterCorrection, "revoked finance.manage cannot replay a cached success");
    db.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_code) SELECT role_id,'finance.manage' FROM users WHERE id=?").run(repo.bootstrap().currentUser.id);
    db.prepare("DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code='cash.expense'").run(repo.bootstrap().currentUser.id);
    assert.throws(() => correction(repo, expense.id, paid.revision!, key), /PIN|permiso|autoriz/i);
    assert.deepEqual(unchanged(), afterCorrection, "revoked PIN authorization cannot replay a cached success");
    db.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_code) SELECT role_id,'cash.expense' FROM users WHERE id=?").run(repo.bootstrap().currentUser.id);
    const cancelled = repo.cancelFinanceExpense({ expenseId: expense.id, expectedRevision: corrected.revision!,
      reason: "La obligación fue cancelada luego", idempotencyKey: "cancel-after-closed-correction" });
    assert.ok(cancelled.cancelledAt);
    assert.equal(repo.getFinanceReport({ from: session.businessDate, to: session.businessDate }).expensesMinor, 0,
      "cancelling the restored expense must not expose its orphan historical EXPENSE in the old cash period");
    assert.equal((db.prepare("SELECT COUNT(*) n FROM finance_expense_closed_payment_corrections WHERE original_movement_id IN (SELECT id FROM cash_movements WHERE type='EXPENSE')").get() as any).n, 1);
  }));
