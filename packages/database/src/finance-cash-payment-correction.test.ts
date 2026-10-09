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
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-cash-correction-"));
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
    assert.ok(basename(dir).startsWith("gastronomy-cash-correction-"));
    rmSync(dir, { recursive: true, force: true });
  }
}

const expenseInput = {
  title: "Servicio técnico",
  category: "Mantenimiento",
  kind: "GENERAL" as const,
  amountMinor: 12000,
  incurredOn: "2026-10-08",
  dueOn: "2026-10-10",
  note: "Factura inicial",
};

test("corrige pago efectivo con reversión compensatoria auditable, conserva importe del gasto y permite nueva revisión", () =>
  fixture((repo, db) => {
    const session = repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const stockBefore = (
      db
        .prepare("SELECT COALESCE(SUM(stock_minor),0) AS total FROM products")
        .get() as { total: number }
    ).total;
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
    });
    const originalMovementBefore = db
      .prepare(
        "SELECT * FROM cash_movements WHERE id=(SELECT cash_movement_id FROM finance_expenses WHERE id=?)",
      )
      .get(expense.id);
    const financeRowBefore = db
      .prepare(
        "SELECT amount_minor,incurred_on,due_on,kind,employee_id,recurring_id,note,created_at FROM finance_expenses WHERE id=?",
      )
      .get(expense.id);
    const reportBefore = repo.getFinanceReport({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    assert.equal(repo.bootstrap().cashSession?.expectedAmountMinor, 88000);
    assert.deepEqual(paid.cashPaymentCorrection, {
      cashSessionId: session.id,
      cashSessionNumber: session.number,
      amountMinor: expense.amountMinor,
      paymentMethodName: "Efectivo",
      affectsCash: true,
    });
    const correctionInput = {
      expenseId: expense.id,
      expectedRevision: paid.revision ?? 0,
      reason: "Método de pago mal seleccionado",
      authorizerPin: "2468",
      idempotencyKey: "correct-cash-once",
    };
    const corrected = repo.correctFinanceExpenseCashPayment(correctionInput);
    assert.equal(corrected.paidAt, null);
    assert.equal(corrected.paymentMethodCode, null);
    assert.equal(corrected.revision, (paid.revision ?? 0) + 1);
    assert.deepEqual(
      repo.correctFinanceExpenseCashPayment(correctionInput),
      corrected,
    );
    const ledger = db
      .prepare(
        "SELECT original_movement_id,compensation_movement_id,reason FROM finance_expense_payment_corrections WHERE expense_id=?",
      )
      .get(expense.id) as any;
    assert.equal(ledger.reason, correctionInput.reason);
    const audit = db
      .prepare(
        "SELECT action,reason,before_json,after_json,authorizer_user_id FROM audit_log WHERE entity_id=? AND action='FINANCE_EXPENSE_CASH_PAYMENT_CORRECTED'",
      )
      .get(expense.id) as any;
    assert.equal(audit.action, "FINANCE_EXPENSE_CASH_PAYMENT_CORRECTED");
    assert.equal(audit.reason, correctionInput.reason);
    const auditBefore = JSON.parse(audit.before_json);
    const auditAfter = JSON.parse(audit.after_json);
    assert.equal(auditBefore.expense.paymentMethodCode, "CASH");
    assert.equal(auditBefore.movement.type, "EXPENSE");
    assert.equal(auditBefore.movement.amountMinor, expense.amountMinor);
    assert.equal(auditBefore.movement.affectsCash, true);
    assert.equal(auditAfter.expense.paidAt, null);
    assert.equal(auditAfter.compensation.type, "INCOME");
    assert.equal(auditAfter.compensation.amountMinor, expense.amountMinor);
    assert.equal(auditAfter.compensation.referenceId, auditBefore.movement.id);
    assert.equal(audit.authorizer_user_id, repo.bootstrap().currentUser.id);
    assert.equal(
      (
        db
          .prepare("SELECT COALESCE(SUM(stock_minor),0) AS total FROM products")
          .get() as { total: number }
      ).total,
      stockBefore,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT amount_minor,incurred_on,kind FROM finance_expenses WHERE id=?",
          )
          .get(expense.id) as any
      ).amount_minor,
      expense.amountMinor,
    );
    assert.deepEqual(
      db
        .prepare("SELECT * FROM cash_movements WHERE id=?")
        .get((originalMovementBefore as any).id),
      originalMovementBefore,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT amount_minor,incurred_on,due_on,kind,employee_id,recurring_id,note,created_at FROM finance_expenses WHERE id=?",
        )
        .get(expense.id),
      financeRowBefore,
    );
    assert.equal(repo.bootstrap().cashSession?.expectedAmountMinor, 100000);
    const movements = db
      .prepare(
        "SELECT type,amount_minor,cash_session_id,reference_id FROM cash_movements WHERE id IN (?,?) ORDER BY type",
      )
      .all(
        ledger.original_movement_id,
        ledger.compensation_movement_id,
      ) as any[];
    assert.equal(movements.length, 2);
    assert.equal(
      movements.find((m) => m.type === "INCOME")?.amount_minor,
      expense.amountMinor,
    );
    assert.ok(movements.every((m) => m.cash_session_id === session.id));
    assert.equal(
      movements.find((m) => m.type === "EXPENSE")?.reference_id,
      null,
    );
    const compensation = movements.find((m) => m.type === "INCOME")!;
    assert.equal(compensation.reference_id, ledger.original_movement_id);
    assert.throws(
      () =>
        repo.reverseCashMovement({
          movementId: ledger.compensation_movement_id,
          reason: "Segundo reverso",
          authorizerPin: "2468",
          idempotencyKey: "reverse-compensation",
        }),
      /correcci|revers|anul/i,
    );
    assert.throws(
      () =>
        repo.reverseCashMovement({
          movementId: ledger.original_movement_id,
          reason: "Reverso por API genérica",
          authorizerPin: "2468",
          idempotencyKey: "reverse-original",
        }),
      /correcci|revers|anul/i,
    );
    assert.equal(
      repo.getFinanceReport({ from: "2026-10-01", to: "2026-10-31" })
        .expensesMinor,
      expense.amountMinor,
    );
    const reportAfter = repo.getFinanceReport({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    assert.equal(reportAfter.grossProfitMinor, reportBefore.grossProfitMinor);
    assert.equal(
      reportAfter.estimatedOperatingProfitMinor,
      reportBefore.estimatedOperatingProfitMinor,
    );
    assert.equal(
      reportAfter.unpaidMinor,
      reportBefore.unpaidMinor + expense.amountMinor,
    );
    const reopened = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
      expectedRevision: corrected.revision ?? 0,
      idempotencyKey: "repay-after-correction",
    });
    assert.ok(reopened.paidAt);
    const secondCorrection = repo.correctFinanceExpenseCashPayment({
      ...correctionInput,
      expectedRevision: reopened.revision ?? 0,
      idempotencyKey: "correct-cash-second-cycle",
    });
    assert.equal(secondCorrection.paidAt, null);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM finance_expense_payment_corrections WHERE expense_id=?",
          )
          .get(expense.id) as { count: number }
      ).count,
      2,
    );
    assert.deepEqual(
      repo.correctFinanceExpenseCashPayment(correctionInput),
      corrected,
    );
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code='cash.expense'",
    ).run(repo.bootstrap().currentUser.id);
    assert.throws(
      () => repo.correctFinanceExpenseCashPayment(correctionInput),
      /PIN|permiso|autoriz/i,
    );
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','finance.manage')",
    ).run(repo.bootstrap().currentUser.id);
    assert.throws(
      () => repo.correctFinanceExpenseCashPayment(correctionInput),
      /permiso/i,
    );
  }));

test("captura la clasificación efectiva de caja del movimiento aunque luego se desactive o cambie el medio", () =>
  fixture((repo, db) => {
    const session = repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
    });
    const original = db
      .prepare(
        "SELECT id,payment_method_id,affects_cash,cash_session_id FROM cash_movements WHERE id=(SELECT cash_movement_id FROM finance_expenses WHERE id=?)",
      )
      .get(expense.id) as any;
    db.prepare(
      "UPDATE payment_methods SET active=0,affects_cash=0 WHERE id=?",
    ).run(original.payment_method_id);
    const result = repo.correctFinanceExpenseCashPayment({
      expenseId: expense.id,
      expectedRevision: paid.revision ?? 0,
      reason: "Cambio posterior del catálogo",
      authorizerPin: "2468",
      idempotencyKey: "snapshot-original",
    });
    const compensation = db
      .prepare(
        "SELECT payment_method_id,affects_cash,cash_session_id,amount_minor,reference_id FROM cash_movements WHERE reference_id=?",
      )
      .get(original.id) as any;
    assert.equal(compensation.payment_method_id, original.payment_method_id);
    assert.equal(compensation.affects_cash, original.affects_cash);
    assert.equal(compensation.cash_session_id, session.id);
    assert.equal(compensation.amount_minor, expense.amountMinor);
    assert.equal(compensation.reference_id, original.id);
    assert.equal(result.paymentMethodCode, null);
  }));

test("compensa transferencia vinculada a caja conservando affects_cash=false aunque cambie el catálogo", () =>
  fixture((repo, db) => {
    const session = repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: true,
    });
    const original = db
      .prepare(
        "SELECT id,payment_method_id,affects_cash FROM cash_movements WHERE id=(SELECT cash_movement_id FROM finance_expenses WHERE id=?)",
      )
      .get(expense.id) as any;
    assert.equal(original.affects_cash, 0);
    db.prepare(
      "UPDATE payment_methods SET active=0,affects_cash=1 WHERE id=?",
    ).run(original.payment_method_id);
    repo.correctFinanceExpenseCashPayment({
      expenseId: expense.id,
      expectedRevision: paid.revision ?? 0,
      reason: "Transferencia sin efectivo",
      authorizerPin: "2468",
      idempotencyKey: "transfer-from-register",
    });
    const compensation = db
      .prepare(
        "SELECT cash_session_id,affects_cash,payment_method_id FROM cash_movements WHERE reference_id=?",
      )
      .get(original.id) as any;
    assert.equal(compensation.cash_session_id, session.id);
    assert.equal(compensation.affects_cash, 0);
    assert.equal(compensation.payment_method_id, original.payment_method_id);
  }));

test("rechaza razón vacía, revisión obsoleta, transferencia externa y corrección sin autorización", () =>
  fixture((repo, db) => {
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    assert.equal(paid.cashPaymentCorrection, null);
    const base = {
      expenseId: expense.id,
      expectedRevision: paid.revision ?? 0,
      reason: "Corregir dato",
      authorizerPin: "2468",
      idempotencyKey: "bad-scope",
    };
    const unchanged = {
      expense: db
        .prepare(
          "SELECT revision,paid_at,payment_method_id,cash_movement_id,amount_minor FROM finance_expenses WHERE id=?",
        )
        .get(expense.id),
      movements: (
        db.prepare("SELECT COUNT(*) AS count FROM cash_movements").get() as {
          count: number;
        }
      ).count,
      corrections: (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM finance_expense_payment_corrections",
          )
          .get() as { count: number }
      ).count,
    };
    assert.throws(
      () => repo.correctFinanceExpenseCashPayment({ ...base, reason: " " }),
      /motivo|razón/i,
    );
    assert.throws(
      () =>
        repo.correctFinanceExpenseCashPayment({
          ...base,
          expectedRevision: (paid.revision ?? 0) - 1,
        }),
      /revisión|modificad|actualiz/i,
    );
    assert.throws(
      () =>
        repo.correctFinanceExpenseCashPayment({
          ...base,
          authorizerPin: "0000",
        }),
      /PIN|autoriz/i,
    );
    assert.throws(
      () => repo.correctFinanceExpenseCashPayment(base),
      /caja|efectivo|sesión/i,
    );
    assert.deepEqual(
      {
        expense: db
          .prepare(
            "SELECT revision,paid_at,payment_method_id,cash_movement_id,amount_minor FROM finance_expenses WHERE id=?",
          )
          .get(expense.id),
        movements: (
          db.prepare("SELECT COUNT(*) AS count FROM cash_movements").get() as {
            count: number;
          }
        ).count,
        corrections: (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM finance_expense_payment_corrections",
            )
            .get() as { count: number }
        ).count,
      },
      unchanged,
    );
  }));

test("migration 32 upgrades a v31 database without altering expenses, cash, audit, receipts or users", () =>
  fixture((repo, db, path) => {
    repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
      idempotencyKey: "legacy-payment-receipt",
    });
    const expenseBefore = db
      .prepare("SELECT * FROM finance_expenses WHERE id=?")
      .get(expense.id);
    const movementBefore = db
      .prepare(
        "SELECT * FROM cash_movements WHERE id=(SELECT cash_movement_id FROM finance_expenses WHERE id=?)",
      )
      .get(expense.id);
    const sessionBefore = db
      .prepare(
        "SELECT * FROM cash_sessions WHERE id=(SELECT cash_session_id FROM cash_movements WHERE id=?)",
      )
      .get((movementBefore as any).id);
    const auditBefore = db
      .prepare(
        "SELECT * FROM audit_log WHERE entity_id=? ORDER BY timestamp,id",
      )
      .all(expense.id);
    const receiptBefore = db
      .prepare(
        "SELECT * FROM command_receipts WHERE idempotency_key='legacy-payment-receipt'",
      )
      .get();
    const usersBefore = db.prepare("SELECT * FROM users ORDER BY id").all();
    db.exec(
      "DROP TABLE finance_expense_payment_corrections; DELETE FROM schema_migrations WHERE version=32;",
    );
    const upgraded = new SqliteGastronomyRepository(path, {
      adminPin: "2468",
      seedStarterCatalog: true,
    });
    const upgradedDb = new Database(path);
    try {
      assert.equal(
        (
          upgradedDb
            .prepare("SELECT version FROM schema_migrations WHERE version=32")
            .get() as any
        ).version,
        32,
      );
      assert.equal(
        (
          upgradedDb
            .prepare(
              "SELECT COUNT(*) AS count FROM finance_expense_payment_corrections",
            )
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(
        upgradedDb
          .prepare("SELECT * FROM finance_expenses WHERE id=?")
          .get(expense.id),
        expenseBefore,
      );
      assert.deepEqual(
        upgradedDb
          .prepare("SELECT * FROM cash_movements WHERE id=?")
          .get((movementBefore as any).id),
        movementBefore,
      );
      assert.deepEqual(
        upgradedDb
          .prepare("SELECT * FROM cash_sessions WHERE id=?")
          .get((sessionBefore as any).id),
        sessionBefore,
      );
      assert.deepEqual(
        upgradedDb
          .prepare(
            "SELECT * FROM audit_log WHERE entity_id=? ORDER BY timestamp,id",
          )
          .all(expense.id),
        auditBefore,
      );
      assert.deepEqual(
        upgradedDb
          .prepare(
            "SELECT * FROM command_receipts WHERE idempotency_key='legacy-payment-receipt'",
          )
          .get(),
        receiptBefore,
      );
      assert.deepEqual(
        upgradedDb.prepare("SELECT * FROM users ORDER BY id").all(),
        usersBefore,
      );
      assert.deepEqual(
        upgraded.payFinanceExpense({
          expenseId: expense.id,
          paymentMethodCode: "CASH",
          fromCash: true,
          idempotencyKey: "legacy-payment-receipt",
        }),
        paid,
      );
    } finally {
      upgradedDb.close();
      upgraded.close();
    }
  }));

test("no permite corregir si la caja original está cerrada o existe otra sesión abierta", () =>
  fixture((repo) => {
    const session = repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
    });
    repo.closeCashSession({
      countedAmountMinor: 88000,
      closingFloatAmountMinor: 0,
      force: false,
      authorizerPin: "2468",
    });
    assert.equal(
      repo
        .getFinanceReport({ from: "2026-10-01", to: "2026-10-31" })
        .expenses.find((item) => item.id === expense.id)?.cashPaymentCorrection,
      null,
    );
    assert.throws(
      () =>
        repo.correctFinanceExpenseCashPayment({
          expenseId: expense.id,
          expectedRevision: paid.revision ?? 0,
          reason: "Cerrada",
          authorizerPin: "2468",
          idempotencyKey: "closed-session",
        }),
      /caja|sesión|abierta/i,
    );
    repo.openCashSession({ openingAmountMinor: 100000 });
    assert.throws(
      () =>
        repo.correctFinanceExpenseCashPayment({
          expenseId: expense.id,
          expectedRevision: paid.revision ?? 0,
          reason: "Otra sesión",
          authorizerPin: "2468",
          idempotencyKey: "different-session",
        }),
      /caja|sesión|abierta/i,
    );
  }));

test("rechaza gasto pendiente, recurrente o cancelado fuera del alcance", () =>
  fixture((repo, db) => {
    repo.openCashSession({ openingAmountMinor: 100000 });
    const pending = repo.createFinanceExpense(expenseInput);
    const pendingInput = {
      expenseId: pending.id,
      expectedRevision: pending.revision ?? 0,
      reason: "No pagado",
      authorizerPin: "2468",
      idempotencyKey: "pending-expense",
    };
    assert.throws(
      () => repo.correctFinanceExpenseCashPayment(pendingInput),
      /pagado|vinculado/i,
    );
    const paidExpense = repo.createFinanceExpense({
      ...expenseInput,
      title: "Recurrente",
    });
    const paid = repo.payFinanceExpense({
      expenseId: paidExpense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
    });
    const recurring = repo.createFinanceRecurring({
      title: "Mantenimiento mensual",
      category: "Mantenimiento",
      kind: "FIXED",
      amountMinor: 12000,
      dayOfMonth: 8,
      startMonth: "2026-10",
    });
    db.prepare("UPDATE finance_expenses SET recurring_id=? WHERE id=?").run(
      recurring.id,
      paidExpense.id,
    );
    const correctionInput = {
      expenseId: paidExpense.id,
      expectedRevision: paid.revision ?? 0,
      reason: "Fuera de alcance",
      authorizerPin: "2468",
      idempotencyKey: "recurring-expense",
    };
    assert.throws(
      () => repo.correctFinanceExpenseCashPayment(correctionInput),
      /recurrente/i,
    );
    db.prepare(
      "UPDATE finance_expenses SET recurring_id=NULL,cancelled_at=? WHERE id=?",
    ).run(new Date().toISOString(), paidExpense.id);
    assert.throws(
      () =>
        repo.correctFinanceExpenseCashPayment({
          ...correctionInput,
          idempotencyKey: "cancelled-expense",
        }),
      /cancelado/i,
    );
  }));

test("la recuperación permite corregir y anular el gasto pendiente sin tocar el historial de caja", () =>
  fixture((repo, db) => {
    repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
    });
    const pending = repo.correctFinanceExpenseCashPayment({
      expenseId: expense.id,
      expectedRevision: paid.revision!,
      reason: "El dinero nunca salió",
      authorizerPin: "2468",
      idempotencyKey: "restore-pending",
    });
    const history = {
      movements: db.prepare("SELECT * FROM cash_movements ORDER BY id").all(),
      corrections: db
        .prepare(
          "SELECT * FROM finance_expense_payment_corrections ORDER BY id",
        )
        .all(),
    };
    const edited = repo.correctFinanceExpense({
      ...expenseInput,
      expenseId: expense.id,
      expectedRevision: pending.revision!,
      amountMinor: 13000,
      reason: "Actualizar importe pendiente",
      idempotencyKey: "edit-restored",
    });
    assert.equal(edited.amountMinor, 13000);
    const cancelled = repo.cancelFinanceExpense({
      expenseId: expense.id,
      expectedRevision: edited.revision!,
      reason: "Gasto no corresponde",
      idempotencyKey: "cancel-restored",
    });
    assert.ok(cancelled.cancelledAt);
    assert.deepEqual(
      {
        movements: db.prepare("SELECT * FROM cash_movements ORDER BY id").all(),
        corrections: db
          .prepare(
            "SELECT * FROM finance_expense_payment_corrections ORDER BY id",
          )
          .all(),
      },
      history,
    );
    assert.equal(
      repo.getFinanceReport({ from: "2026-10-01", to: "2026-10-31" })
        .expensesMinor,
      0,
    );
  }));
