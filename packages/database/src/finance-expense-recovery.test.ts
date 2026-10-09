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
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-expense-recovery-"));
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
    assert.ok(basename(dir).startsWith("gastronomy-expense-recovery-"));
    rmSync(dir, { recursive: true, force: true });
  }
}

const range = { from: "2026-10-01", to: "2026-10-31" };
const expenseInput = {
  title: "Servicio técnico",
  category: "Mantenimiento",
  kind: "GENERAL" as const,
  amountMinor: 12000,
  incurredOn: "2026-10-08",
  dueOn: "2026-10-10",
  note: "Factura inicial",
};

test("corrige un gasto manual sin pago, conserva revisión y audita antes/después", () =>
  fixture((repo, db) => {
    const before = repo.createFinanceExpense(expenseInput);
    const corrected = repo.correctFinanceExpense({
      ...expenseInput,
      expenseId: before.id,
      expectedRevision: 0,
      reason: "Importe y fecha corregidos",
      title: "Service de gas",
      category: "Local",
      amountMinor: 18000,
      incurredOn: "2026-11-09",
      dueOn: "2026-11-10",
      idempotencyKey: "correct-expense",
    });
    assert.equal(corrected.revision, 1);
    assert.equal(corrected.amountMinor, 18000);
    assert.equal(
      repo.getFinanceReport(range).expensesMinor,
      0,
      "the previous period no longer carries the corrected expense",
    );
    assert.equal(
      repo.getFinanceReport({ from: "2026-11-01", to: "2026-11-30" })
        .expensesMinor,
      18000,
    );
    const audit = db
      .prepare(
        "SELECT action,before_json,after_json FROM audit_log WHERE entity_id=? AND action='FINANCE_EXPENSE_CORRECTED'",
      )
      .get(before.id) as {
      action: string;
      before_json: string;
      after_json: string;
    };
    assert.equal(audit.action, "FINANCE_EXPENSE_CORRECTED");
    assert.match(audit.before_json, /12000/);
    assert.match(
      String(
        (
          db
            .prepare(
              "SELECT reason FROM audit_log WHERE entity_id=? AND action='FINANCE_EXPENSE_CORRECTED'",
            )
            .get(before.id) as { reason: string }
        ).reason,
      ),
      /Importe y fecha corregidos/,
    );
    assert.match(audit.after_json, /18000/);
  }));

test("cancela sin borrar historial ni crear movimiento, excluye el gasto de todos los totales", () =>
  fixture((repo, db) => {
    const original = repo.createFinanceExpense(expenseInput);
    const cancelled = repo.cancelFinanceExpense({
      expenseId: original.id,
      expectedRevision: 0,
      reason: "Carga duplicada",
      idempotencyKey: "cancel-expense",
    });
    assert.ok(cancelled.cancelledAt);
    assert.equal(cancelled.cancellationReason, "Carga duplicada");
    assert.equal(cancelled.revision, 1);
    const report = repo.getFinanceReport(range);
    assert.equal(report.expenses.length, 1);
    assert.equal(report.expenses[0]?.id, original.id);
    assert.equal(report.expensesMinor, 0);
    assert.equal(report.unpaidMinor, 0);
    assert.equal(
      report.monthly.find((m) => m.month === "2026-10")?.expensesMinor ?? 0,
      0,
    );
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS n FROM cash_movements").get() as {
          n: number;
        }
      ).n,
      0,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND action='FINANCE_EXPENSE_CANCELLED'",
          )
          .get(original.id) as { n: number }
      ).n,
      1,
    );
    assert.throws(
      () =>
        repo.cancelFinanceExpense({
          expenseId: original.id,
          expectedRevision: 1,
          reason: "Repetida",
          idempotencyKey: "second-cancel",
        }),
      /ya está cancelado/i,
    );
    assert.throws(
      () =>
        repo.payFinanceExpense({
          expenseId: original.id,
          paymentMethodCode: "CASH",
          fromCash: false,
        }),
      /cancelado/i,
    );
  }));

test("replays idempotently and rejects a stale revision", () =>
  fixture((repo) => {
    const original = repo.createFinanceExpense(expenseInput);
    const input = {
      ...expenseInput,
      expenseId: original.id,
      expectedRevision: 0,
      reason: "Corrección",
      amountMinor: 15000,
      idempotencyKey: "same-correction",
    };
    const first = repo.correctFinanceExpense(input);
    assert.deepEqual(repo.correctFinanceExpense(input), first);
    assert.throws(
      () =>
        repo.cancelFinanceExpense({
          expenseId: original.id,
          expectedRevision: 0,
          reason: "stale",
          idempotencyKey: "stale-cancel",
        }),
      /revisión|versión|modificado|actualiz/i,
    );
  }));

test("rechaza cancelar/corregir gastos pagados y recurrentes", () =>
  fixture((repo) => {
    const paid = repo.createFinanceExpense(expenseInput);
    repo.payFinanceExpense({
      expenseId: paid.id,
      paymentMethodCode: "CASH",
      fromCash: false,
    });
    assert.throws(
      () =>
        repo.correctFinanceExpense({
          ...expenseInput,
          expenseId: paid.id,
          expectedRevision: 0,
          reason: "No",
          idempotencyKey: "paid-correction",
        }),
      /pagado|revisión|modificado/i,
    );
    assert.throws(
      () =>
        repo.cancelFinanceExpense({
          expenseId: paid.id,
          expectedRevision: 0,
          reason: "No",
          idempotencyKey: "paid-cancel",
        }),
      /pagado|revisión|modificado/i,
    );
    const recurring = repo.createFinanceRecurring({
      title: "Alquiler",
      category: "Local",
      kind: "FIXED",
      amountMinor: 90000,
      dayOfMonth: 8,
      startMonth: "2026-10",
    });
    const materialized = repo
      .getFinanceReport(range)
      .expenses.find((e) => e.recurringId === recurring.id);
    assert.ok(materialized);
    assert.throws(
      () =>
        repo.correctFinanceExpense({
          ...expenseInput,
          expenseId: materialized!.id,
          expectedRevision: 0,
          reason: "No",
          idempotencyKey: "recurring-correction",
        }),
      /recurrente/i,
    );
    assert.throws(
      () =>
        repo.cancelFinanceExpense({
          expenseId: materialized!.id,
          expectedRevision: 0,
          reason: "No",
          idempotencyKey: "recurring-cancel",
        }),
      /recurrente/i,
    );
  }));

test("un pago invalida la revisión previa para corrección posterior", () =>
  fixture((repo) => {
    const e = repo.createFinanceExpense(expenseInput);
    repo.payFinanceExpense({
      expenseId: e.id,
      paymentMethodCode: "CASH",
      fromCash: false,
    });
    assert.throws(
      () =>
        repo.correctFinanceExpense({
          ...expenseInput,
          expenseId: e.id,
          expectedRevision: 0,
          reason: "Cambio tardío",
          idempotencyKey: "after-payment",
        }),
      /pagado|revisión|modificado/i,
    );
  }));

test("valida motivo, fechas, longitudes y permisos de finanzas", () =>
  fixture((repo, db) => {
    const e = repo.createFinanceExpense(expenseInput);
    const base = {
      ...expenseInput,
      expenseId: e.id,
      expectedRevision: 0,
      reason: "ok",
      idempotencyKey: "invalid-case",
    };
    assert.throws(
      () => repo.correctFinanceExpense({ ...base, reason: "   " }),
      /motivo|razón|válid/i,
    );
    assert.throws(
      () => repo.correctFinanceExpense({ ...base, incurredOn: "2026-02-30" }),
      /fecha|válid/i,
    );
    assert.throws(
      () => repo.correctFinanceExpense({ ...base, title: "x".repeat(161) }),
      /título|largo|válid/i,
    );
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','finance.manage')",
    ).run(repo.bootstrap().currentUser.id);
    assert.throws(
      () =>
        repo.cancelFinanceExpense({
          expenseId: e.id,
          expectedRevision: 0,
          reason: "sin permiso",
          idempotencyKey: "permission-denied",
        }),
      /permiso/i,
    );
  }));

test("los gastos fijos y de nómina actualizan sus totales y el mensual al corregirlos", () =>
  fixture((repo) => {
    const e = repo.createFinanceExpense({
      ...expenseInput,
      kind: "GENERAL",
      amountMinor: 10000,
    });
    const changed = repo.correctFinanceExpense({
      ...expenseInput,
      expenseId: e.id,
      expectedRevision: 0,
      reason: "Clasificación y período",
      kind: "PAYROLL",
      employeeId: "user-admin",
      amountMinor: 22000,
      incurredOn: "2026-11-12",
      idempotencyKey: "payroll-correction",
    });
    assert.equal(changed.kind, "PAYROLL");
    const nov = repo.getFinanceReport({ from: "2026-11-01", to: "2026-11-30" });
    assert.equal(nov.payrollMinor, 22000);
    assert.equal(nov.fixedMinor, 0);
    assert.equal(nov.unpaidMinor, 22000);
    assert.equal(
      nov.monthly.find((m) => m.month === "2026-11")?.expensesMinor,
      22000,
    );
    repo.correctFinanceExpense({
      ...expenseInput,
      expenseId: e.id,
      expectedRevision: 1,
      reason: "Marcar fijo",
      kind: "FIXED",
      amountMinor: 24000,
      incurredOn: "2026-11-12",
      idempotencyKey: "fixed-correction",
    });
    const fixed = repo.getFinanceReport({
      from: "2026-11-01",
      to: "2026-11-30",
    });
    assert.equal(fixed.payrollMinor, 0);
    assert.equal(fixed.fixedMinor, 24000);
  }));

test("la migración de recuperación agrega columnas sin alterar gastos pagados o recurrentes", () => {
  const dir = mkdtempSync(
    join(tmpdir(), "gastronomy-expense-recovery-migration-"),
  );
  const path = join(dir, "test.sqlite");
  let repo = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  const db = new Database(path);
  const paid = repo.createFinanceExpense(expenseInput);
  repo.payFinanceExpense({
    expenseId: paid.id,
    paymentMethodCode: "CASH",
    fromCash: false,
  });
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
  db.exec(
    "ALTER TABLE finance_expenses DROP COLUMN cancelled_by_user_id; ALTER TABLE finance_expenses DROP COLUMN cancellation_reason; ALTER TABLE finance_expenses DROP COLUMN cancelled_at; ALTER TABLE finance_expenses DROP COLUMN revision; DELETE FROM schema_migrations WHERE version=30;",
  );
  db.close();
  repo.close();
  try {
    repo = new SqliteGastronomyRepository(path, {
      adminPin: "2468",
      seedStarterCatalog: true,
    });
    const preserved = repo.getFinanceReport(range).expenses;
    const restoredPaid = preserved.find((e) => e.id === paid.id)!;
    const restoredRecurring = preserved.find(
      (e) => e.id === recurringExpense.id,
    )!;
    assert.ok(restoredPaid.paidAt);
    assert.equal(restoredPaid.revision, 0);
    assert.equal(restoredRecurring.recurringId, recurring.id);
    assert.equal(restoredRecurring.revision, 0);
    assert.equal(restoredRecurring.cancelledAt, null);
  } finally {
    repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(
      basename(dir).startsWith("gastronomy-expense-recovery-migration-"),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});

test("revalida permiso en replay y no confunde corregir con anular al reutilizar clave", () =>
  fixture((repo, db) => {
    const e = repo.createFinanceExpense(expenseInput);
    const input = {
      ...expenseInput,
      expenseId: e.id,
      expectedRevision: 0,
      reason: "corregir",
      idempotencyKey: "shared-intent",
    };
    repo.correctFinanceExpense(input);
    assert.throws(() => repo.cancelFinanceExpense(input), /clave|diferentes/i);
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','finance.manage')",
    ).run(repo.bootstrap().currentUser.id);
    assert.throws(() => repo.correctFinanceExpense(input), /permiso/i);
  }));
test("bloquea vínculo a caja aunque estado legado figure impago", () =>
  fixture((repo, db) => {
    repo.openCashSession({ openingAmountMinor: 100000 });
    const e = repo.createFinanceExpense(expenseInput);
    repo.payFinanceExpense({
      expenseId: e.id,
      paymentMethodCode: "CASH",
      fromCash: true,
    });
    db.prepare("UPDATE finance_expenses SET paid_at=NULL WHERE id=?").run(e.id);
    const row = db
      .prepare("SELECT * FROM finance_expenses WHERE id=?")
      .get(e.id) as { revision: number };
    assert.throws(
      () =>
        repo.cancelFinanceExpense({
          expenseId: e.id,
          expectedRevision: row.revision,
          reason: "legacy",
          idempotencyKey: "linked",
        }),
      /caja/i,
    );
    assert.throws(
      () =>
        repo.correctFinanceExpense({
          ...expenseInput,
          expenseId: e.id,
          expectedRevision: row.revision,
          reason: "legacy",
          idempotencyKey: "linked-correct",
        }),
      /caja/i,
    );
  }));
