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
  ) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-expense-unmark-"));
  const path = join(dir, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  const db = new Database(path);
  try {
    run(repo, db);
  } finally {
    db.close();
    repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("gastronomy-expense-unmark-"));
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
const range = { from: "2026-10-01", to: "2026-10-31" };

test("desmarca pago externo manual con motivo, versión y auditoría inmutable, sin cambiar importe del informe", () =>
  fixture((repo, db) => {
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    assert.equal(paid.canUnmarkPayment, true);
    const reportBefore = repo.getFinanceReport(range);
    const result = repo.unmarkFinanceExpensePayment({
      expenseId: expense.id,
      expectedRevision: paid.revision ?? 0,
      reason: "Se marcó por error",
      idempotencyKey: "undo-payment-1",
    });
    assert.equal(result.paidAt, null);
    assert.equal(result.paymentMethodCode, null);
    assert.equal(result.revision, (paid.revision ?? 0) + 1);
    assert.equal(result.canUnmarkPayment, false);
    const reportAfter = repo.getFinanceReport(range);
    assert.equal(reportAfter.expensesMinor, reportBefore.expensesMinor);
    assert.equal(
      reportAfter.unpaidMinor,
      reportBefore.unpaidMinor + expense.amountMinor,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT payment_revision_required FROM finance_expenses WHERE id=?",
          )
          .get(expense.id) as { payment_revision_required: number }
      ).payment_revision_required,
      1,
    );
    const audit = db
      .prepare(
        "SELECT action,before_json,after_json,reason FROM audit_log WHERE entity_id=? AND action='FINANCE_EXPENSE_PAYMENT_UNMARKED'",
      )
      .get(expense.id) as {
      action: string;
      before_json: string;
      after_json: string;
      reason: string;
    };
    assert.equal(audit.action, "FINANCE_EXPENSE_PAYMENT_UNMARKED");
    assert.match(audit.before_json, /TRANSFER/);
    assert.match(audit.after_json, /"paidAt":null/);
    assert.equal(audit.reason, "Se marcó por error");
  }));

test("replay de pago previo no restaura y replay de deshacer tampoco revierte un pago posterior", () =>
  fixture((repo) => {
    const expense = repo.createFinanceExpense(expenseInput);
    const payInput = {
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: 0,
      idempotencyKey: "pay-once",
    };
    const receipt = repo.payFinanceExpense(payInput);
    const undoInput = {
      expenseId: expense.id,
      expectedRevision: receipt.revision ?? 0,
      reason: "Error",
      idempotencyKey: "undo-once",
    };
    const undone = repo.unmarkFinanceExpensePayment(undoInput);
    assert.deepEqual(repo.payFinanceExpense(payInput), receipt);
    assert.equal(
      repo.getFinanceReport(range).expenses.find((e) => e.id === expense.id)
        ?.paidAt,
      null,
    );
    const repaid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: undone.revision ?? 0,
      idempotencyKey: "pay-again",
    });
    assert.ok(repaid.paidAt);
    assert.deepEqual(repo.unmarkFinanceExpensePayment(undoInput), undone);
    assert.ok(
      repo.getFinanceReport(range).expenses.find((e) => e.id === expense.id)
        ?.paidAt,
    );
  }));

test("unauthorized, stale/missing revision, invalid reason y estados fuera de alcance se rechazan", () =>
  fixture((repo, db) => {
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    assert.throws(
      () =>
        repo.unmarkFinanceExpensePayment({
          expenseId: expense.id,
          expectedRevision: paid.revision ?? 0,
          reason: " ",
          idempotencyKey: "bad-reason",
        }),
      /motivo|razón/i,
    );
    assert.throws(
      () =>
        repo.unmarkFinanceExpensePayment({
          expenseId: expense.id,
          expectedRevision: (paid.revision ?? 0) - 1,
          reason: "Motivo",
          idempotencyKey: "stale",
        }),
      /revisión|modificad|actualiz/i,
    );
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','finance.manage')",
    ).run(repo.bootstrap().currentUser.id);
    assert.throws(
      () =>
        repo.unmarkFinanceExpensePayment({
          expenseId: expense.id,
          expectedRevision: paid.revision ?? 0,
          reason: "Sin permiso",
          idempotencyKey: "denied",
        }),
      /permiso/i,
    );
  }));

test("un pago posterior a un deshacer exige revisión; la marca permite reintento vigente y rechaza omitida", () =>
  fixture((repo) => {
    const expense = repo.createFinanceExpense(expenseInput);
    const legacyReceipt = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    const undone = repo.unmarkFinanceExpensePayment({
      expenseId: expense.id,
      expectedRevision: legacyReceipt.revision ?? 0,
      reason: "Corrección",
      idempotencyKey: "undo",
    });
    assert.throws(
      () =>
        repo.payFinanceExpense({
          expenseId: expense.id,
          paymentMethodCode: "TRANSFER",
          fromCash: false,
        }),
      /revisión|versión|required|obligatoria/i,
    );
    const repaid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
      expectedRevision: undone.revision ?? 0,
      idempotencyKey: "new-pay",
    });
    assert.ok(repaid.paidAt);
  }));

test("rechaza pagos ligados a caja, recurrentes y cancelados para deshacer", () =>
  fixture((repo, db) => {
    repo.openCashSession({ openingAmountMinor: 100000 });
    const linked = repo.createFinanceExpense(expenseInput);
    repo.payFinanceExpense({
      expenseId: linked.id,
      paymentMethodCode: "CASH",
      fromCash: true,
    });
    const linkedRow = db
      .prepare("SELECT revision FROM finance_expenses WHERE id=?")
      .get(linked.id) as { revision: number };
    assert.throws(
      () =>
        repo.unmarkFinanceExpensePayment({
          expenseId: linked.id,
          expectedRevision: linkedRow.revision,
          reason: "No",
          idempotencyKey: "cash",
        }),
      /caja|efectivo/i,
    );
    const canceled = repo.createFinanceExpense({
      ...expenseInput,
      title: "Cancelado",
    });
    repo.cancelFinanceExpense({
      expenseId: canceled.id,
      expectedRevision: 0,
      reason: "Duplicado",
      idempotencyKey: "cancel",
    });
    assert.throws(
      () =>
        repo.unmarkFinanceExpensePayment({
          expenseId: canceled.id,
          expectedRevision: 1,
          reason: "No",
          idempotencyKey: "cancelled",
        }),
      /cancelad/i,
    );
    const recurring = repo.createFinanceRecurring({
      title: "Alquiler",
      category: "Local",
      kind: "FIXED",
      amountMinor: 90000,
      dayOfMonth: 8,
      startMonth: "2026-10",
    });
    const recurringExpense = repo
      .getFinanceReport(range)
      .expenses.find((e) => e.recurringId === recurring.id)!;
    repo.payFinanceExpense({
      expenseId: recurringExpense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    assert.throws(
      () =>
        repo.unmarkFinanceExpensePayment({
          expenseId: recurringExpense.id,
          expectedRevision: recurringExpense.revision ?? 1,
          reason: "No",
          idempotencyKey: "recurring",
        }),
      /recurrente/i,
    );
    const pending = repo.createFinanceExpense({
      ...expenseInput,
      title: "Pendiente",
    });
    assert.throws(
      () =>
        repo.unmarkFinanceExpensePayment({
          expenseId: pending.id,
          expectedRevision: 0,
          reason: "No",
          idempotencyKey: "pending",
        }),
      /no está pagado/i,
    );
  }));

test("migration31 conserva pagos externos legados, agrega guard default 0 y el primer undo persiste tras reabrir", () => {
  const dir = mkdtempSync(
    join(tmpdir(), "gastronomy-expense-unmark-migration-"),
  );
  const path = join(dir, "test.sqlite");
  let repo = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  let db = new Database(path);
  try {
    const legacy = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: legacy.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    db.exec(
      "ALTER TABLE finance_expenses DROP COLUMN payment_revision_required; DELETE FROM schema_migrations WHERE version=31;",
    );
    db.close();
    repo.close();
    repo = new SqliteGastronomyRepository(path, {
      adminPin: "2468",
      seedStarterCatalog: true,
    });
    db = new Database(path);
    const preserved = repo
      .getFinanceReport(range)
      .expenses.find((e) => e.id === legacy.id)!;
    assert.ok(preserved.paidAt);
    assert.equal(preserved.revision, paid.revision);
    assert.equal(
      (
        db
          .prepare(
            "SELECT payment_revision_required FROM finance_expenses WHERE id=?",
          )
          .get(legacy.id) as { payment_revision_required: number }
      ).payment_revision_required,
      0,
    );
    const undone = repo.unmarkFinanceExpensePayment({
      expenseId: legacy.id,
      expectedRevision: paid.revision ?? 0,
      reason: "Carga equivocada",
      idempotencyKey: "migration-undo",
    });
    assert.equal(undone.paidAt, null);
    db.close();
    repo.close();
    repo = new SqliteGastronomyRepository(path, {
      adminPin: "2468",
      seedStarterCatalog: true,
    });
    db = new Database(path);
    assert.equal(
      (
        db
          .prepare(
            "SELECT payment_revision_required FROM finance_expenses WHERE id=?",
          )
          .get(legacy.id) as { payment_revision_required: number }
      ).payment_revision_required,
      1,
    );
    assert.throws(
      () =>
        repo.payFinanceExpense({
          expenseId: legacy.id,
          paymentMethodCode: "TRANSFER",
          fromCash: false,
        }),
      /revisión|versión|obligatoria/i,
    );
  } finally {
    db.close();
    repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("gastronomy-expense-unmark-migration-"));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("payroll manual externo puede desmarcarse sin mutar importes salariales ni stock, y pago externo no toca caja", () =>
  fixture((repo, db) => {
    const expense = repo.createFinanceExpense({
      ...expenseInput,
      kind: "PAYROLL",
      employeeId: repo.bootstrap().currentUser.id,
    });
    const cashCount = (
      db.prepare("SELECT COUNT(*) AS n FROM cash_movements").get() as {
        n: number;
      }
    ).n;
    const stockMinor = (
      db
        .prepare("SELECT COALESCE(SUM(stock_minor),0) AS n FROM products")
        .get() as { n: number }
    ).n;
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    const undone = repo.unmarkFinanceExpensePayment({
      expenseId: expense.id,
      expectedRevision: paid.revision ?? 0,
      reason: "Error",
      idempotencyKey: "payroll-undo",
    });
    assert.equal(undone.paidAt, null);
    assert.equal(
      repo.getFinanceReport(range).payrollMinor,
      expense.amountMinor,
    );
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS n FROM cash_movements").get() as {
          n: number;
        }
      ).n,
      cashCount,
    );
    assert.equal(
      (
        db
          .prepare("SELECT COALESCE(SUM(stock_minor),0) AS n FROM products")
          .get() as { n: number }
      ).n,
      stockMinor,
    );
  }));

test("deshacer rechaza clave reutilizada para otra petición y vuelve a validar permiso en replay", () =>
  fixture((repo, db) => {
    const expense = repo.createFinanceExpense(expenseInput);
    const paid = repo.payFinanceExpense({
      expenseId: expense.id,
      paymentMethodCode: "TRANSFER",
      fromCash: false,
    });
    const input = {
      expenseId: expense.id,
      expectedRevision: paid.revision ?? 0,
      reason: "Error",
      idempotencyKey: "undo-replay",
    };
    repo.unmarkFinanceExpensePayment(input);
    assert.throws(
      () =>
        repo.unmarkFinanceExpensePayment({ ...input, reason: "Otro motivo" }),
      /clave|idempotencia|diferentes/i,
    );
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','finance.manage')",
    ).run(repo.bootstrap().currentUser.id);
    assert.throws(() => repo.unmarkFinanceExpensePayment(input), /permiso/i);
  }));
