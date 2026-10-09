import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function withFrozenDate<T>(iso: string, run: () => T): T {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: [] | [string | number]) { super(args.length === 0 ? iso : args[0]); }
    static now() { return new RealDate(iso).valueOf(); }
  }
  globalThis.Date = FrozenDate as DateConstructor;
  try { return run(); }
  finally { globalThis.Date = RealDate; }
}

function fixture(run: (repo: SqliteGastronomyRepository, db: InstanceType<typeof Database>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-monthly-recovery-"));
  const path = join(dir, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  const db = new Database(path);
  try { run(repo, db); }
  finally {
    db.close(); repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("gastronomy-monthly-recovery-"));
    rmSync(dir, { recursive: true, force: true });
  }
}

function dateRange(date: string) {
  const month = date.slice(0, 7);
  const [year, monthNo] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year!, monthNo!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function monthlyOccurrence(repo: SqliteGastronomyRepository, kind: "FIXED" | "PAYROLL", incurredOn: string, title = `Mensual ${kind}`) {
  const recurring = repo.createFinanceRecurring({
    title, category: "Servicios", kind, amountMinor: 12500,
    dayOfMonth: Number(incurredOn.slice(8, 10)), startMonth: incurredOn.slice(0, 7),
    ...(kind === "PAYROLL" ? { employeeId: repo.bootstrap().currentUser.id } : {}),
    idempotencyKey: `rule-${kind}-${title}`,
  });
  const report = repo.getFinanceReport(dateRange(incurredOn));
  const expense = report.expenses.find((row) => row.recurringId === recurring.id);
  assert.ok(expense, "the queried month materializes its occurrence");
  return { recurring, expense: expense! };
}

function correct(repo: SqliteGastronomyRepository, input: Record<string, unknown>) {
  return (repo as any).correctFinanceMonthlyExpense(input);
}
function cancel(repo: SqliteGastronomyRepository, input: Record<string, unknown>) {
  return (repo as any).cancelFinanceMonthlyExpense(input);
}

test("corrects one incurred monthly occurrence, preserving identity, rule, neighboring months, and current cash", () =>
  fixture((repo, db) => {
    const session = repo.openCashSession({ openingAmountMinor: 100000 });
    const today = session.businessDate;
    const { recurring, expense } = monthlyOccurrence(repo, "PAYROLL", today, "Sueldo mensual");
    const ruleBefore = db.prepare("SELECT * FROM finance_recurring WHERE id=?").get(recurring.id);
    const cashBefore = db.prepare("SELECT * FROM cash_sessions ORDER BY id").all();
    const movementsBefore = db.prepare("SELECT * FROM cash_movements ORDER BY rowid").all();
    const auditBefore = (db.prepare("SELECT COUNT(*) n FROM audit_log").get() as any).n;
    const neighborsBefore = repo.getFinanceReport({ from: `${today.slice(0, 7)}-01`, to: `${Number(today.slice(0, 4)) + 1}-12-31` })
      .expenses.filter((row) => row.recurringId === recurring.id).map((row) => ({ id: row.id, incurredOn: row.incurredOn, paidAt: row.paidAt }));
    const before = db.prepare("SELECT id,incurred_on,recurring_id,kind,employee_id FROM finance_expenses WHERE id=?").get(expense.id);
    const input = { expenseId: expense.id, expectedRevision: expense.revision ?? 0,
      reason: "Importe del mes corregido", title: "Sueldo mensual corregido", category: "Personal",
      amountMinor: 15000, dueOn: today, note: "Recibo revisado", idempotencyKey: "monthly-correct-once" };
    const corrected = correct(repo, input);
    assert.equal(corrected.title, input.title);
    assert.equal(corrected.category, input.category);
    assert.equal(corrected.amountMinor, input.amountMinor);
    assert.equal(corrected.dueOn, today);
    assert.equal(corrected.note, input.note);
    assert.equal(corrected.incurredOn, today);
    assert.equal(corrected.kind, "PAYROLL");
    assert.equal(corrected.recurringId, recurring.id);
    assert.equal(corrected.revision, (expense.revision ?? 0) + 1);
    assert.equal(corrected.canRecoverMonthlyExpense, true);
    assert.equal(corrected.paymentMethodCode, null);
    assert.deepEqual(correct(repo, input), corrected);
    assert.deepEqual(db.prepare("SELECT id,incurred_on,recurring_id,kind,employee_id FROM finance_expenses WHERE id=?").get(expense.id), before);
    assert.deepEqual(db.prepare("SELECT * FROM finance_recurring WHERE id=?").get(recurring.id), ruleBefore);
    assert.deepEqual(db.prepare("SELECT * FROM cash_sessions ORDER BY id").all(), cashBefore);
    assert.deepEqual(db.prepare("SELECT * FROM cash_movements ORDER BY rowid").all(), movementsBefore);
    const neighborsAfter = repo.getFinanceReport({ from: `${today.slice(0, 7)}-01`, to: `${Number(today.slice(0, 4)) + 1}-12-31` })
      .expenses.filter((row) => row.recurringId === recurring.id).map((row) => ({ id: row.id, incurredOn: row.incurredOn, paidAt: row.paidAt }));
    assert.deepEqual(neighborsAfter, neighborsBefore, "repeated report materialization keeps every monthly slot stable");
    const audit = db.prepare("SELECT action,reason,before_json,after_json,operator_user_id FROM audit_log WHERE entity_id=? AND action='FINANCE_MONTHLY_EXPENSE_CORRECTED'").get(expense.id) as any;
    assert.equal(audit.reason, input.reason);
    assert.ok(audit.operator_user_id);
    assert.match(audit.before_json, /12500/);
    assert.match(audit.after_json, /15000/);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log").get() as any).n, auditBefore + 1);
    assert.equal(repo.getFinanceReport(dateRange(today)).payrollMinor, 15000);
    assert.equal(repo.bootstrap().cashSession?.expectedAmountMinor, 100000);
  }));

test("FIXED active and stopped-rule occurrences are eligible only after incurred date, not for future slots", () =>
  fixture((repo) => {
    const session = repo.openCashSession({ openingAmountMinor: 50000 });
    const today = session.businessDate;
    const { recurring, expense } = monthlyOccurrence(repo, "FIXED", today, "Alquiler mensual");
    assert.equal(expense.canRecoverMonthlyExpense, true);
    repo.stopFinanceRecurring({ recurringId: recurring.id });
    const stopped = repo.getFinanceReport(dateRange(today)).expenses.find((row) => row.id === expense.id)!;
    assert.equal(stopped.canRecoverMonthlyExpense, true, "stopping future repetition does not remove an incurred obligation");
    const input = { expenseId: expense.id, expectedRevision: stopped.revision ?? 0, reason: "Mes actual con importe equivocado",
      title: stopped.title, category: stopped.category, amountMinor: stopped.amountMinor, idempotencyKey: "stopped-rule-correction" };
    assert.equal(correct(repo, input).recurringId, recurring.id);

    // The cutoff itself comes from the BA business date returned by opening a
    // session; UTC is used only for safe YYYY-MM-DD calendar arithmetic here.
    const nextDay = new Date(`${today}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const futureDate = nextDay.toISOString().slice(0, 10);
    const { expense: future } = monthlyOccurrence(repo, "FIXED", futureDate, "Futuro fuera de alcance");
    assert.equal(future.canRecoverMonthlyExpense, false);
    const futureBefore = (repo as any).financeExpense(future.id);
    const state = JSON.stringify(futureBefore);
    assert.throws(() => correct(repo, { ...input, expenseId: future.id, expectedRevision: future.revision ?? 0,
      idempotencyKey: "future-rejected" }), /fecha|llegado|incurrido|futuro/i);
    assert.equal(JSON.stringify((repo as any).financeExpense(future.id)), state);
  }));

test("monthly eligibility cutoff follows Buenos Aires date across UTC midnight", () =>
  fixture((repo) => withFrozenDate("2026-10-09T02:30:00.000Z", () => {
    const session = repo.openCashSession({ openingAmountMinor: 50000 });
    assert.equal(session.businessDate, "2026-10-08", "02:30Z is still the prior local day in Buenos Aires");
    const today = monthlyOccurrence(repo, "FIXED", "2026-10-08", "Local cutoff occurrence").expense;
    const tomorrow = monthlyOccurrence(repo, "PAYROLL", "2026-10-09", "After local cutoff").expense;
    assert.equal(today.canRecoverMonthlyExpense, true);
    assert.equal(tomorrow.canRecoverMonthlyExpense, false);
    assert.throws(() => correct(repo, { expenseId: tomorrow.id, expectedRevision: tomorrow.revision ?? 0,
      reason: "No incurrido aún", title: tomorrow.title, category: tomorrow.category,
      amountMinor: tomorrow.amountMinor, idempotencyKey: "ba-tomorrow-rejected" }), /fecha|llegado|incurrido|futuro/i);
  })));

test("cancel keeps the occurrence identity, excludes it from totals, and never regenerates the same monthly slot", () =>
  fixture((repo, db) => {
    const today = repo.openCashSession({ openingAmountMinor: 0 }).businessDate;
    const { recurring, expense } = monthlyOccurrence(repo, "FIXED", today, "Servicio mensual cancelado");
    const identity = db.prepare("SELECT id,incurred_on,recurring_id,kind,employee_id FROM finance_expenses WHERE id=?").get(expense.id);
    const ruleBefore = db.prepare("SELECT * FROM finance_recurring WHERE id=?").get(recurring.id);
    const cancelled = cancel(repo, { expenseId: expense.id, expectedRevision: expense.revision ?? 0,
      reason: "Servicio no contratado este mes", idempotencyKey: "cancel-monthly-slot" });
    assert.ok(cancelled.cancelledAt);
    assert.equal(cancelled.cancellationReason, "Servicio no contratado este mes");
    assert.equal(cancelled.revision, (expense.revision ?? 0) + 1);
    assert.equal(cancelled.canRecoverMonthlyExpense, false);
    assert.deepEqual(db.prepare("SELECT id,incurred_on,recurring_id,kind,employee_id FROM finance_expenses WHERE id=?").get(expense.id), identity);
    assert.deepEqual(db.prepare("SELECT * FROM finance_recurring WHERE id=?").get(recurring.id), ruleBefore);
    assert.deepEqual(cancel(repo, { expenseId: expense.id, expectedRevision: expense.revision ?? 0,
      reason: "Servicio no contratado este mes", idempotencyKey: "cancel-monthly-slot" }), cancelled);
    const report = repo.getFinanceReport(dateRange(today));
    assert.equal(report.expenses.find((row) => row.id === expense.id)?.cancelledAt, cancelled.cancelledAt);
    assert.equal(report.expensesMinor, 0);
    assert.equal(report.fixedMinor, 0);
    assert.equal(report.unpaidMinor, 0);
    assert.equal(report.monthly.find((row) => row.month === today.slice(0, 7))?.expensesMinor ?? 0, 0);
    const same = repo.getFinanceReport(dateRange(today)).expenses.filter((row) => row.recurringId === recurring.id && row.incurredOn === today);
    assert.equal(same.length, 1, "INSERT OR IGNORE reuses the cancelled occurrence key rather than creating a replacement");
    assert.equal(same[0]?.id, expense.id);
    const audit = db.prepare("SELECT action,reason FROM audit_log WHERE entity_id=? AND action='FINANCE_MONTHLY_EXPENSE_CANCELLED'").get(expense.id) as any;
    assert.equal(audit.reason, "Servicio no contratado este mes");
    assert.equal((db.prepare("SELECT COUNT(*) n FROM cash_movements").get() as any).n, 1, "only the fixture opening movement exists");
  }));

test("validates monthly correction content, amount, due date, reason, and revision without mutation", () =>
  fixture((repo, db) => {
    const today = repo.openCashSession({ openingAmountMinor: 10000 }).businessDate;
    const { expense } = monthlyOccurrence(repo, "PAYROLL", today, "Nómina mensual");
    const base = { expenseId: expense.id, expectedRevision: expense.revision ?? 0, reason: "Corregir nómina",
      title: "Nómina", category: "Personal", amountMinor: 12000, dueOn: today, note: null, idempotencyKey: "bad-monthly-input" };
    const snapshot = () => ({ expense: db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id),
      rules: db.prepare("SELECT * FROM finance_recurring ORDER BY id").all(), movements: db.prepare("SELECT * FROM cash_movements ORDER BY rowid").all(),
      audit: db.prepare("SELECT * FROM audit_log ORDER BY timestamp,id").all(), receipts: db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all() });
    const before = snapshot();
    for (const input of [
      { ...base, reason: " " },
      { ...base, amountMinor: 0, idempotencyKey: "zero-amount" },
      { ...base, amountMinor: -1, idempotencyKey: "negative-amount" },
      { ...base, dueOn: "2026-02-30", idempotencyKey: "invalid-due" },
      { ...base, dueOn: "bad", idempotencyKey: "malformed-due" },
      { ...base, expectedRevision: (expense.revision ?? 0) - 1, idempotencyKey: "stale-month" },
    ]) {
      assert.throws(() => correct(repo, input));
      assert.deepEqual(snapshot(), before);
    }
    db.prepare("DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','finance.manage')").run(repo.bootstrap().currentUser.id);
    assert.throws(() => correct(repo, { ...base, idempotencyKey: "denied-monthly" }), /permiso/i);
    assert.deepEqual(snapshot().expense, before.expense);
    assert.deepEqual(snapshot().movements, before.movements);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_id=? AND action='FINANCE_MONTHLY_EXPENSE_CORRECTED'").get(expense.id) as any).n, 0);
  }));

test("rejects paid, manual, cash-linked, and cancelled rows without mutating related records", () =>
  fixture((repo, db) => {
    const session = repo.openCashSession({ openingAmountMinor: 100000 });
    const today = session.businessDate;
    const { expense: paid } = monthlyOccurrence(repo, "FIXED", today, "Pago mensual");
    const paidExpense = repo.payFinanceExpense({ expenseId: paid.id, paymentMethodCode: "CASH", fromCash: true });
    const { expense: linkedLegacy } = monthlyOccurrence(repo, "PAYROLL", today, "Vínculo histórico mensual");
    repo.payFinanceExpense({ expenseId: linkedLegacy.id, paymentMethodCode: "CASH", fromCash: true });
    // Simulate legacy/corrupt state: displayed unpaid but a cash link remains.
    // Keep its own unique movement; never alias the paid row's UNIQUE link.
    db.prepare("UPDATE finance_expenses SET paid_at=NULL WHERE id=?").run(linkedLegacy.id);
    const { expense: manual } = (() => {
      const e = repo.createFinanceExpense({ title: "Manual", category: "Servicios", kind: "GENERAL", amountMinor: 5000, incurredOn: today });
      return { expense: e };
    })();
    const { expense: cancelled } = monthlyOccurrence(repo, "FIXED", today, "Fila mensual anulada");
    const cancellation = cancel(repo, { expenseId: cancelled.id, expectedRevision: cancelled.revision ?? 0,
      reason: "Preparar fila anulada", idempotencyKey: "prepare-cancelled-month" });
    const snapshot = () => ({ paid: db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(paid.id),
      linked: db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(linkedLegacy.id),
      manual: db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(manual.id),
      cancelled: db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(cancelled.id),
      movements: db.prepare("SELECT * FROM cash_movements ORDER BY rowid").all(),
      ledgers: db.prepare("SELECT * FROM finance_recurring ORDER BY id").all() });
    const before = snapshot();
    for (const [target, revision, key] of [[paid.id, paidExpense.revision!, "paid-month"], [linkedLegacy.id, linkedLegacy.revision ?? 0, "cash-linked"],
      [manual.id, manual.revision ?? 0, "manual-month"], [cancelled.id, cancellation.revision!, "cancelled-month"]] as const) {
      assert.throws(() => correct(repo, { expenseId: target, expectedRevision: revision, reason: "Fuera de alcance",
        title: "x", category: "x", amountMinor: 1, idempotencyKey: key }));
      assert.deepEqual(snapshot(), before);
    }
  }));

test("requires current revision to pay after monthly correction and historic receipt replay cannot undo a real payment", () =>
  fixture((repo, db) => {
    const today = repo.openCashSession({ openingAmountMinor: 50000 }).businessDate;
    const { expense } = monthlyOccurrence(repo, "FIXED", today, "Gasto corregido luego pagable");
    const input = { expenseId: expense.id, expectedRevision: expense.revision ?? 0, reason: "Ajustar concepto",
      title: "Gasto revisado", category: "Servicios", amountMinor: 14000, idempotencyKey: "monthly-receipt" };
    const corrected = correct(repo, input);
    assert.throws(() => repo.payFinanceExpense({ expenseId: expense.id, paymentMethodCode: "CASH", fromCash: true }), /revisión|actualiz/i);
    assert.throws(() => repo.payFinanceExpense({ expenseId: expense.id, paymentMethodCode: "CASH", fromCash: true,
      expectedRevision: expense.revision ?? 0 }), /revisión|actualiz/i);
    assert.equal((db.prepare("SELECT paid_at FROM finance_expenses WHERE id=?").get(expense.id) as any).paid_at, null);
    const paid = repo.payFinanceExpense({ expenseId: expense.id, paymentMethodCode: "CASH", fromCash: true,
      expectedRevision: corrected.revision, idempotencyKey: "monthly-real-payment" });
    assert.ok(paid.paidAt);
    const paidState = db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id);
    assert.deepEqual(correct(repo, input), corrected);
    assert.deepEqual(db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(expense.id), paidState);
    assert.equal(repo.getFinanceReport(dateRange(today)).expenses.find((row) => row.id === expense.id)?.paidAt, paid.paidAt);
  }));
