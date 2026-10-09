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
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-expense-return-"));
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
    assert.ok(basename(dir).startsWith("gastronomy-expense-return-"));
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
const returnInput = (
  expenseId: string,
  expectedRevision: number,
  destination: "CASH_SESSION" | "EXTERNAL",
  paymentMethodCode: string,
  idempotencyKey: string,
) => ({
  expenseId,
  expectedRevision,
  destination,
  paymentMethodCode,
  reason: "Proveedor reintegró el importe",
  authorizerPin: "2468",
  idempotencyKey,
});

test("recibe devolución total en caja con método real distinto, preserva pago original y la registra en el período de recepción", () =>
  fixture((repo, db) => {
    const session = repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
    });
    const paidRow = db
      .prepare("SELECT * FROM finance_expenses WHERE id=?")
      .get(expense.id) as any;
    const stockBefore = (
      db
        .prepare("SELECT COALESCE(SUM(stock_minor),0) AS total FROM products")
        .get() as any
    ).total;
    const original = db
      .prepare(
        "SELECT * FROM cash_movements WHERE id=(SELECT cash_movement_id FROM finance_expenses WHERE id=?)",
      )
      .get(expense.id);
    const returned = repo.receiveFinanceExpenseReturn(
      returnInput(
        expense.id,
        paid.revision ?? 0,
        "CASH_SESSION",
        "TRANSFER",
        "return-cash",
      ),
    );
    assert.equal(returned.paidAt, paid.paidAt);
    assert.equal(returned.paymentMethodCode, paid.paymentMethodCode);
    assert.equal(returned.revision, (paid.revision ?? 0) + 1);
    assert.equal(returned.cancelledAt, null);
    assert.equal(returned.canReceiveReturn, false);
    assert.equal(returned.returnInfo?.amountMinor, expense.amountMinor);
    assert.equal(returned.returnInfo?.paymentMethodCode, "TRANSFER");
    assert.equal(returned.returnInfo?.destination, "CASH_SESSION");
    assert.equal(returned.returnInfo?.cashSessionId, session.id);
    assert.equal(returned.returnInfo?.originalMovementId, (original as any).id);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM cash_movements WHERE id=?")
        .get((original as any).id),
      original,
    );
    const returnedRow = db
      .prepare("SELECT * FROM finance_expenses WHERE id=?")
      .get(expense.id) as any;
    assert.deepEqual(
      { ...returnedRow, revision: paidRow.revision },
      paidRow,
      "receipt changes only the expense revision",
    );
    assert.equal(
      (
        db
          .prepare("SELECT COALESCE(SUM(stock_minor),0) AS total FROM products")
          .get() as any
      ).total,
      stockBefore,
    );
    assert.equal(repo.bootstrap().cashSession?.expectedAmountMinor, 88000);
    const ledger = db
      .prepare("SELECT * FROM finance_expense_returns WHERE expense_id=?")
      .get(expense.id) as any;
    assert.equal(ledger.amount_minor, 12000);
    const income = db
      .prepare(
        "SELECT type,amount_minor,affects_cash,reference_id FROM cash_movements WHERE id=?",
      )
      .get(ledger.cash_movement_id) as any;
    assert.equal(income.type, "INCOME");
    assert.equal(income.amount_minor, expense.amountMinor);
    assert.equal(income.affects_cash, 0);
    assert.equal(income.reference_id, null); // Provenance belongs to the return ledger, not a reversal of the payment.
    assert.deepEqual(
      repo.receiveFinanceExpenseReturn(
        returnInput(
          expense.id,
          paid.revision ?? 0,
          "CASH_SESSION",
          "TRANSFER",
          "return-cash",
        ),
      ),
      returned,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM finance_expense_returns WHERE expense_id=?",
        )
        .get(expense.id) &&
        (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM finance_expense_returns WHERE expense_id=?",
            )
            .get(expense.id) as any
        ).n,
      1,
    );
    const report = repo.getFinanceReport({
      from: "2026-10-01",
      to: "2026-10-31",
    }) as any;
    assert.equal(report.expensesMinor, 12000);
    assert.equal(report.expenseReturnsMinor, 12000);
    assert.equal(report.netExpensesMinor, 0);
    assert.equal(report.expenseReturns.length, 1);
    const audit = db
      .prepare(
        "SELECT action,reason,before_json,after_json,operator_user_id,authorizer_user_id FROM audit_log WHERE entity_id=? AND action='FINANCE_EXPENSE_RETURN_RECEIVED'",
      )
      .get(expense.id) as any;
    assert.equal(audit.reason, "Proveedor reintegró el importe");
    assert.equal(audit.operator_user_id, repo.bootstrap().currentUser.id);
    assert.equal(audit.authorizer_user_id, repo.bootstrap().currentUser.id);
    assert.match(audit.before_json, /CASH/);
    assert.match(audit.after_json, /TRANSFER/);
    assert.throws(
      () =>
        repo.unmarkFinanceExpensePayment({
          expenseId: expense.id,
          expectedRevision: returned.revision ?? 0,
          reason: "Intento posterior",
          idempotencyKey: "unmark-after-return",
        }),
      /devolución recibida/,
    );
    assert.throws(
      () =>
        repo.correctFinanceExpenseCashPayment({
          expenseId: expense.id,
          expectedRevision: returned.revision ?? 0,
          reason: "Intento posterior",
          authorizerPin: "2468",
          idempotencyKey: "correct-after-return",
        }),
      /devolución recibida/,
    );
    assert.throws(
      () =>
        repo.reverseCashMovement({
          movementId: (original as any).id,
          reason: "No",
          authorizerPin: "2468",
          idempotencyKey: "reverse-original",
        }),
      /devolución de gasto/,
    );
    assert.throws(
      () =>
        repo.reverseCashMovement({
          movementId: ledger.cash_movement_id,
          reason: "No",
          authorizerPin: "2468",
          idempotencyKey: "reverse-return",
        }),
      /devolución de gasto/,
    );
  }));

test("registra devolución externa sin crear movimiento de caja y separa gasto bruto y devolución por fecha de recepción", () =>
  fixture((repo, db) => {
    const expense = repo.createFinanceExpense({
      ...expenseInput,
      incurredOn: "2026-09-30",
    });
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    const returned = repo.receiveFinanceExpenseReturn(
      returnInput(
        expense.id,
        paid.revision ?? 0,
        "EXTERNAL",
        "TRANSFER",
        "return-external",
      ),
    );
    assert.equal(returned.returnInfo?.destination, "EXTERNAL");
    assert.equal(returned.returnInfo?.affectsCash, false);
    assert.equal(returned.returnInfo?.cashMovementId, null);
    assert.equal(returned.returnInfo?.originalMovementId, null);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM cash_movements WHERE type='INCOME'",
          )
          .get() as any
      ).n,
      0,
    );
    const sep = repo.getFinanceReport({
      from: "2026-09-01",
      to: "2026-09-30",
    }) as any;
    assert.equal(sep.expensesMinor, 12000);
    assert.equal(sep.expenseReturnsMinor, 0);
    assert.equal(sep.netExpensesMinor, 12000);
    const oct = repo.getFinanceReport({
      from: "2026-10-01",
      to: "2026-10-31",
    }) as any;
    assert.equal(oct.expensesMinor, 0);
    assert.equal(oct.expenseReturnsMinor, 12000);
    assert.equal(oct.netExpensesMinor, -12000);
    assert.equal(oct.expenseReturns[0].expenseTitle, expense.title);
    assert.equal(
      oct.monthly.find((row: any) => row.month === "2026-10")
        .expenseReturnsMinor,
      12000,
    );
    assert.equal(
      oct.monthly.find((row: any) => row.month === "2026-10").netExpensesMinor,
      -12000,
    );
  }));

test("rechaza saldo pendiente, recurrencias/fijos/cancelados, revisión obsoleta, replay conflictivo y reversión genérica", () =>
  fixture((repo, db) => {
    const pending = repo.createFinanceExpense(expenseInput);
    assert.throws(
      () =>
        repo.receiveFinanceExpenseReturn(
          returnInput(pending.id, 0, "EXTERNAL", "TRANSFER", "pending"),
        ),
      /completamente pagado/,
    );
    const fixed = repo.createFinanceExpense({
      ...expenseInput,
      title: "Alquiler",
      kind: "FIXED",
    });
    repo.payFinanceExpense({
      expenseId: fixed.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    assert.throws(
      () =>
        repo.receiveFinanceExpenseReturn(
          returnInput(fixed.id, 1, "EXTERNAL", "TRANSFER", "fixed"),
        ),
      /General/,
    );
    const recurring = repo.createFinanceRecurring({
      title: "Abono",
      category: "Servicios",
      kind: "FIXED",
      amountMinor: 5000,
      dayOfMonth: 8,
      startMonth: "2026-10",
    });
    const recurringExpense = repo
      .getFinanceReport({ from: "2026-10-01", to: "2026-10-31" })
      .expenses.find((item) => item.recurringId === recurring.id)!;
    repo.payFinanceExpense({
      expenseId: recurringExpense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    assert.throws(
      () =>
        repo.receiveFinanceExpenseReturn(
          returnInput(
            recurringExpense.id,
            1,
            "EXTERNAL",
            "TRANSFER",
            "recurring",
          ),
        ),
      /General|recurrente/,
    );
    const cancelled = repo.createFinanceExpense({
      ...expenseInput,
      incurredOn: "2026-10-07",
    });
    repo.cancelFinanceExpense({
      expenseId: cancelled.id,
      expectedRevision: 0,
      reason: "No correspondía",
      idempotencyKey: "cancelled-expense",
    });
    assert.throws(
      () =>
        repo.receiveFinanceExpenseReturn(
          returnInput(cancelled.id, 1, "EXTERNAL", "TRANSFER", "cancelled"),
        ),
      /cancelado/,
    );
    const expense = repo.createFinanceExpense({
      ...expenseInput,
      incurredOn: "2026-10-09",
    });
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    assert.throws(
      () =>
        repo.receiveFinanceExpenseReturn(
          returnInput(expense.id, 0, "EXTERNAL", "TRANSFER", "stale"),
        ),
      /modificad|revisión/i,
    );
    const input = returnInput(
      expense.id,
      paid.revision ?? 0,
      "EXTERNAL",
      "TRANSFER",
      "once",
    );
    repo.receiveFinanceExpenseReturn(input);
    assert.throws(
      () =>
        repo.receiveFinanceExpenseReturn({
          ...input,
          reason: "different replay",
        }),
      /clave|diferentes/i,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM finance_expense_returns WHERE expense_id=?",
          )
          .get(expense.id) as any
      ).n,
      1,
    );
  }));

test("receives into the current open session even when original session is closed, preserving its closed snapshot exactly", () =>
  fixture((repo, db) => {
    const originalSession = repo.openCashSession({
      openingAmountMinor: 100000,
    });
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
    const closedSession = db
      .prepare("SELECT * FROM cash_sessions WHERE id=?")
      .get(originalSession.id);
    const closedMovements = db
      .prepare(
        "SELECT * FROM cash_movements WHERE cash_session_id=? ORDER BY id",
      )
      .all(originalSession.id);
    const current = repo.openCashSession({ openingAmountMinor: 50000 });
    const returned = repo.receiveFinanceExpenseReturn(
      returnInput(
        expense.id,
        paid.revision ?? 0,
        "CASH_SESSION",
        "CASH",
        "closed-source-return",
      ),
    );
    assert.equal(returned.returnInfo?.cashSessionId, current.id);
    assert.equal(returned.returnInfo?.cashSessionNumber, current.number);
    assert.equal(
      returned.returnInfo?.originalMovementId,
      (closedMovements as any[]).find((row) => row.type === "EXPENSE").id,
    );
    assert.equal(repo.bootstrap().cashSession?.expectedAmountMinor, 62000);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM cash_sessions WHERE id=?")
        .get(originalSession.id),
      closedSession,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT * FROM cash_movements WHERE cash_session_id=? ORDER BY id",
        )
        .all(originalSession.id),
      closedMovements,
    );
    assert.equal(
      (
        db
          .prepare("SELECT status FROM cash_sessions WHERE id=?")
          .get(originalSession.id) as any
      ).status,
      "CLOSED",
    );
  }));

test("migration 33 retains migration 32 and grants cash.income without dropping finance permissions", () =>
  fixture((repo, db) => {
    assert.ok(
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=32").get(),
    );
    assert.ok(
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=33").get(),
    );
    const roleId = (
      db
        .prepare("SELECT role_id FROM users WHERE id=?")
        .get(repo.bootstrap().currentUser.id) as any
    ).role_id;
    const codes = (
      db
        .prepare("SELECT permission_code FROM role_permissions WHERE role_id=?")
        .all(roleId) as any[]
    ).map((row) => row.permission_code);
    assert.ok(codes.includes("finance.manage"));
    assert.ok(codes.includes("finance.view"));
    assert.ok(codes.includes("cash.income"));
    const correction = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='finance_expense_payment_corrections'",
      )
      .get();
    assert.ok(correction);
  }));

test("exige PIN con capacidad cash.income antes de devolver en caja y deja operativa la recepción externa", () =>
  fixture((repo, db) => {
    repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    const input = returnInput(
      expense.id,
      paid.revision ?? 0,
      "CASH_SESSION",
      "CASH",
      "cash-income-auth",
    );
    const adminRole = (
      db
        .prepare("SELECT role_id FROM users WHERE id=?")
        .get(repo.bootstrap().currentUser.id) as any
    ).role_id;
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=? AND permission_code='cash.income'",
    ).run(adminRole);
    assert.throws(
      () => repo.receiveFinanceExpenseReturn(input),
      /PIN incorrecto o usuario sin permiso/,
    );
    const external = repo.receiveFinanceExpenseReturn({
      ...input,
      destination: "EXTERNAL",
      idempotencyKey: "external-no-cash-pin",
      authorizerPin: undefined,
    });
    assert.equal(external.returnInfo?.destination, "EXTERNAL");
  }));

test("upgrade32→33 conserva pagos, cierres, stock, auditoría y recibos previos", () =>
  fixture((repo, db, path) => {
    const session = repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const pay = {
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
      idempotencyKey: "legacy-receipt",
    };
    const paid = repo.payFinanceExpense(pay);
    const tables = [
      "finance_expenses",
      "cash_movements",
      "cash_sessions",
      "products",
      "audit_log",
      "command_receipts",
      "finance_expense_payment_corrections",
      "users",
    ];
    const snapshot = () =>
      Object.fromEntries(
        tables.map((t) => [
          t,
          db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        ]),
      );
    const before = snapshot();
    db.exec(
      "DROP TABLE finance_expense_returns; DELETE FROM schema_migrations WHERE version=33",
    );
    const upgraded = new SqliteGastronomyRepository(path, {
      adminPin: "2468",
      seedStarterCatalog: true,
    });
    try {
      assert.deepEqual(snapshot(), before);
      assert.equal(
        (
          db
            .prepare("SELECT COUNT(*) AS n FROM finance_expense_returns")
            .get() as { n: number }
        ).n,
        0,
      );
      assert.deepEqual(upgraded.payFinanceExpense(pay), paid);
      assert.equal(upgraded.bootstrap().cashSession!.id, session.id);
    } finally {
      upgraded.close();
    }
  }));
test("recibo exitoso revalida permisos actuales y PIN sin alterar datos", () =>
  fixture((repo, db) => {
    repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense(expenseInput);
    const pay = {
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
      idempotencyKey: "pay-with-receipt",
    };
    const paid = repo.payFinanceExpense(pay);
    const input = returnInput(
      expense.id,
      paid.revision!,
      "CASH_SESSION",
      "CASH",
      "return-with-receipt",
    );
    const returned = repo.receiveFinanceExpenseReturn(input);
    assert.deepEqual(repo.receiveFinanceExpenseReturn(input), returned);
    assert.deepEqual(repo.payFinanceExpense(pay), paid);
    const tables = [
      "finance_expenses",
      "finance_expense_returns",
      "cash_movements",
      "cash_sessions",
      "audit_log",
      "command_receipts",
      "products",
    ];
    const snapshot = () =>
      Object.fromEntries(
        tables.map((t) => [
          t,
          db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        ]),
      );
    const before = snapshot();
    const role = (
      db
        .prepare("SELECT role_id FROM users WHERE id=?")
        .get(repo.bootstrap().currentUser.id) as { role_id: string }
    ).role_id;
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=? AND permission_code='cash.income'",
    ).run(role);
    assert.throws(() => repo.receiveFinanceExpenseReturn(input), /PIN|permiso/);
    assert.deepEqual(snapshot(), before);
    db.prepare(
      "INSERT INTO role_permissions(role_id,permission_code) VALUES(?,'cash.income')",
    ).run(role);
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=? AND permission_code='finance.manage'",
    ).run(role);
    assert.throws(() => repo.receiveFinanceExpenseReturn(input), /permiso/);
    assert.deepEqual(snapshot(), before);
  }));
test("fecha recibida no hereda día de una caja abierta de otra jornada ni flags originales", () =>
  fixture((repo, db) => {
    const session = repo.openCashSession({ openingAmountMinor: 100000 });
    const expense = repo.createFinanceExpense({
      ...expenseInput,
      incurredOn: "2026-09-30",
    });
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "CASH",
      fromCash: true,
    });
    db.prepare(
      "UPDATE cash_sessions SET business_date='2026-09-30' WHERE id=?",
    ).run(session.id);
    db.prepare(
      "UPDATE payment_methods SET affects_cash=0,active=0 WHERE code='CASH'",
    ).run();
    const original = db
      .prepare(
        "SELECT * FROM cash_movements WHERE id=(SELECT cash_movement_id FROM finance_expenses WHERE id=?)",
      )
      .get(expense.id);
    const returned = repo.receiveFinanceExpenseReturn(
      returnInput(
        expense.id,
        paid.revision!,
        "CASH_SESSION",
        "TRANSFER",
        "today-not-opening-date",
      ),
    );
    assert.notEqual(returned.returnInfo!.receivedOn, "2026-09-30");
    assert.equal(returned.returnInfo!.cashSessionId, session.id);
    assert.equal(returned.returnInfo!.affectsCash, false);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM cash_movements WHERE id=?")
        .get(returned.returnInfo!.originalMovementId),
      original,
    );
    const old = repo.getFinanceReport({ from: "2026-09-01", to: "2026-09-30" });
    assert.equal(old.expenseReturnsMinor, 0);
    assert.equal(old.expensesMinor, expense.amountMinor);
  }));
