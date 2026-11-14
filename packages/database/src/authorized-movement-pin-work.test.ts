import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { configuredTestRepository } from "./configured-test-repository";

test("a pending authorized movement cannot land in a different cash shift", async () => {
  const repo = configuredTestRepository(":memory:", { adminPin: "2468" });
  try {
    const original = repo.openCashSession({ openingAmountMinor: 10000 });
    const input = { type: "WITHDRAWAL" as const, amountMinor: 500, reason: "Retiro", authorizerPin: "2468" };
    let wrote = false;
    const pending = repo.withPreparedUserPins(input, () => {
      wrote = true;
      return repo.registerCashMovement(input);
    });
    repo.closeCashSession({ countedAmountMinor: 10000 });
    const next = repo.openCashSession({ openingAmountMinor: 20000 });
    assert.notEqual(next.id, original.id);
    await assert.rejects(pending, /Cambió el turno de caja/);
    assert.equal(wrote, false);
    assert.equal(repo.bootstrap().cashSession?.expectedAmountMinor, 20000);
  } finally { repo.close(); }
});

test("prepared PIN work covers withdrawals, expenses, and expense corrections without sync bcrypt in writes", async () => {
  const repo = configuredTestRepository(":memory:", { adminPin: "2468", seedStarterCatalog: true });
  const authorizer = repo.createUser({ fullName: "Encargada", roleCode: "MANAGER", pin: "3691", authorizerPin: "2468" });
  const session = repo.openCashSession({ openingAmountMinor: 10_000 });
  const expenseInput = {
    title: "Reparación", category: "Mantenimiento", kind: "GENERAL" as const,
    amountMinor: 1000, incurredOn: "2026-11-08", authorizerPin: "3691",
  };
  let compares = 0;
  let syncDuringWrite = 0;
  let inWrite = false;
  const compare = bcrypt.compare;
  const compareSync = bcrypt.compareSync;
  (bcrypt as any).compare = async (...args: Parameters<typeof bcrypt.compare>) => { compares++; return compare(...args); };
  (bcrypt as any).compareSync = (...args: Parameters<typeof bcrypt.compareSync>) => {
    if (inWrite) syncDuringWrite++;
    return compareSync(...args);
  };
  const prepared = async (input: unknown, operation: () => unknown) => {
    const before = compares;
    const expected = new Set(repo.db.prepare("SELECT pin_hash FROM users WHERE active=1").all().map((r: any) => r.pin_hash)).size;
    await repo.withPreparedUserPins(input, () => { inWrite = true; try { return operation(); } finally { inWrite = false; } });
    assert.equal(compares - before, expected, "one async compare per distinct PIN/hash pair");
  };
  try {
    const withdrawal = { type: "WITHDRAWAL" as const, amountMinor: 500, reason: "Retiro", idempotencyKey: "prepared-withdrawal", authorizerPin: "3691" };
    await prepared(withdrawal, () => repo.registerCashMovement(withdrawal));
    const expense = await (async () => {
      let value: any;
      await prepared(expenseInput, () => { value = repo.createFinanceExpense(expenseInput); return value; });
      return value;
    })();
    const correction = {
      expenseId: expense.id, expectedRevision: expense.revision, reason: "Corrección de importe",
      title: "Reparación ajustada", category: "Mantenimiento", kind: "GENERAL" as const,
      amountMinor: 1200, incurredOn: "2026-11-08", authorizerPin: "3691", idempotencyKey: "prepared-correction",
    };
    await prepared(correction, () => repo.correctFinanceExpense(correction));
    const paidExpense = await repo.createFinanceExpense({ ...expenseInput, title: "Servicio", idempotencyKey: "prepared-payment-expense" });
    const payment = { expenseId: paidExpense.id, paymentMethodCode: "CASH", fromCash: true, idempotencyKey: "prepared-payment", authorizerPin: "3691" };
    await prepared(payment, () => repo.payFinanceExpense(payment));
    const paid = repo.getFinanceReport({ from: "2026-11-01", to: "2026-11-30" }).expenses.find(row => row.id === paidExpense.id)!;
    const cashCorrection = { expenseId: paidExpense.id, expectedRevision: paid.revision!, reason: "Pago mal registrado", authorizerPin: "3691", idempotencyKey: "prepared-cash-correction" };
    // This operation authorizes the same PIN before receipt lookup and again in its write transaction.
    await prepared(cashCorrection, () => repo.correctFinanceExpenseCashPayment(cashCorrection));
    assert.equal(syncDuringWrite, 0, "prepared operations must not run bcrypt sync comparisons");
    const audits = repo.db.prepare("SELECT authorizer_user_id,after_json FROM audit_log WHERE action IN ('CASH_WITHDRAWAL','FINANCE_EXPENSE_CREATED','FINANCE_EXPENSE_CORRECTED','FINANCE_EXPENSE_CASH_PAYMENT_CORRECTED') ORDER BY rowid").all() as any[];
    assert.equal(audits.length, 5);
    assert.ok(audits.every(row => row.authorizer_user_id === authorizer.id));
    assert.ok(audits.every(row => !/authorizerPin|3691/.test(row.after_json)));
    assert.equal(repo.bootstrap().cashSession?.id, session.id);
  } finally {
    (bcrypt as any).compare = compare;
    (bcrypt as any).compareSync = compareSync;
    repo.close();
  }
});

test("prepared movement PIN work yields late continuations outside transactions and is not reused", async () => {
  const repo = configuredTestRepository(":memory:", { adminPin: "2468", seedStarterCatalog: true });
  try {
    repo.createUser({ fullName: "Encargada", roleCode: "MANAGER", pin: "3691", authorizerPin: "2468" });
    repo.openCashSession({ openingAmountMinor: 10_000 });
    const input = { type: "WITHDRAWAL" as const, amountMinor: 500, reason: "Retiro", idempotencyKey: "late-prepared", authorizerPin: "3691" };
    let beats = 0;
    let transactionDuringPreparation = false;
    const timer = setInterval(() => { beats++; transactionDuringPreparation ||= repo.db.inTransaction; }, 2);
    try {
      const operation = () => repo.registerCashMovement(input);
      await repo.withPreparedUserPins(input, operation);
      assert.ok(beats > 0);
      assert.equal(repo.db.inTransaction, false);
      const secondCommand = { ...input, idempotencyKey: "late-prepared-second" };
      let compares = 0;
      const originalCompare = bcrypt.compare;
      (bcrypt as any).compare = async (...args: Parameters<typeof bcrypt.compare>) => { compares++; return originalCompare(...args); };
      try {
        await repo.withPreparedUserPins(secondCommand, () => repo.registerCashMovement(secondCommand));
      } finally { (bcrypt as any).compare = originalCompare; }
      assert.ok(compares > 0, "each command prepares its own comparisons rather than reusing cached results");
    } finally { clearInterval(timer); }
    assert.equal(transactionDuringPreparation, false);
  } finally { repo.close(); }
});

test("movement write is rejected if the authorizer PIN or activation changes during preparation", async () => {
  for (const change of ["pin", "activation"] as const) {
    const repo = configuredTestRepository(":memory:", { adminPin: "2468", seedStarterCatalog: true });
    const authorizer = repo.createUser({ fullName: "Encargada", roleCode: "MANAGER", pin: "3691", authorizerPin: "2468" });
    repo.openCashSession({ openingAmountMinor: 10_000 });
    const input = { type: "WITHDRAWAL" as const, amountMinor: 500, reason: "Retiro", idempotencyKey: `invalidate-${change}`, authorizerPin: "3691" };
    let started!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const originalCompare = bcrypt.compare;
    (bcrypt as any).compare = async (...args: Parameters<typeof bcrypt.compare>) => { started(); await gate; return originalCompare(...args); };
    try {
      const pending = repo.withPreparedUserPins(input, () => repo.registerCashMovement(input));
      await entered;
      if (change === "pin") repo.db.prepare("UPDATE users SET pin_hash=? WHERE id=?").run(bcrypt.hashSync("9753", 4), authorizer.id);
      else repo.db.prepare("UPDATE users SET active=0 WHERE id=?").run(authorizer.id);
      resume();
      await assert.rejects(pending, /usuarios cambiaron/);
      assert.equal((repo.db.prepare("SELECT COUNT(*) n FROM cash_movements WHERE type='WITHDRAWAL'").get() as any).n, 0);
    } finally { resume(); (bcrypt as any).compare = originalCompare; repo.close(); }
  }
});

test("movement authorization rechecks permission and rejects an ambiguous legacy PIN", async () => {
  const repo = configuredTestRepository(":memory:", { adminPin: "2468", seedStarterCatalog: true });
  try {
    const authorizer = repo.createUser({ fullName: "Encargada", roleCode: "MANAGER", pin: "3691", authorizerPin: "2468" });
    repo.openCashSession({ openingAmountMinor: 10_000 });
    const input = { type: "WITHDRAWAL" as const, amountMinor: 500, reason: "Retiro", idempotencyKey: "revoke-movement-permission", authorizerPin: "3691" };
    const pending = repo.withPreparedUserPins(input, () => repo.registerCashMovement(input));
    repo.db.prepare("DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code='cash.withdraw'").run(authorizer.id);
    await assert.rejects(pending, /PIN incorrecto o usuario sin permiso/);
    repo.db.prepare("UPDATE users SET pin_hash=(SELECT pin_hash FROM users WHERE id='user-admin') WHERE id=?").run(authorizer.id);
    const ambiguous = { ...input, idempotencyKey: "ambiguous-movement", authorizerPin: "2468" };
    await assert.rejects(repo.withPreparedUserPins(ambiguous, () => repo.registerCashMovement(ambiguous)), /PIN ambiguo/);
    assert.equal((repo.db.prepare("SELECT COUNT(*) n FROM cash_movements WHERE type='WITHDRAWAL'").get() as any).n, 0);
  } finally { repo.close(); }
});
