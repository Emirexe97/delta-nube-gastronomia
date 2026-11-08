import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3-multiple-ciphers";
import { configuredTestRepository } from "./configured-test-repository";

test("finance expense authorizer is required, audited, and excluded from idempotency", () => {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-finance-auth-"));
  const path = join(dir, "test.sqlite");
  const repo = configuredTestRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  const db = new Database(path);
  try {
    const authorizer = repo.createUser({ fullName: "Encargada", roleCode: "MANAGER", pin: "3691", authorizerPin: "2468" });
    repo.createUser({ fullName: "Supervisor", roleCode: "MANAGER", pin: "2580", authorizerPin: "2468" });
    const input = {
      title: "Reparación", category: "Mantenimiento", kind: "GENERAL" as const,
      amountMinor: 1000, incurredOn: "2026-11-08", idempotencyKey: "finance-auth-create",
    };
    // @ts-expect-error Also reject calls from an older renderer without the field.
    assert.throws(() => repo.createFinanceExpense(input), /PIN incorrecto/);
    const expense = repo.createFinanceExpense({ ...input, authorizerPin: "3691" });
    assert.equal(repo.createFinanceExpense({ ...input, authorizerPin: "2580" }).id, expense.id,
      "a different valid authorizer PIN does not alter idempotency");
    const audit = db.prepare("SELECT authorizer_user_id,after_json FROM audit_log WHERE entity_id=? AND action='FINANCE_EXPENSE_CREATED'")
      .get(expense.id) as { authorizer_user_id: string; after_json: string };
    assert.equal(audit.authorizer_user_id, authorizer.id);
    assert.doesNotMatch(audit.after_json, /authorizerPin|3691/);
    const receipt = db.prepare("SELECT request_hash FROM command_receipts WHERE idempotency_key=?")
      .get(input.idempotencyKey) as { request_hash: string };
    assert.equal(receipt.request_hash, createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      "PIN is not part of the idempotency fingerprint");
    const session = repo.openCashSession({ openingAmountMinor: 10000 });
    repo.payFinanceExpense({ expenseId: expense.id, paymentMethodCode: "CASH", fromCash: true,
      idempotencyKey: "finance-auth-pay", authorizerPin: "3691" });
    const paymentMovement = db.prepare("SELECT user_id FROM cash_movements WHERE cash_session_id=? AND type='EXPENSE'")
      .get(session.id) as { user_id: string };
    assert.equal(paymentMovement.user_id, authorizer.id);
  } finally {
    db.close(); repo.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a legacy shared PIN cannot impersonate another role for a withdrawal or restoration", () => {
  const repo = configuredTestRepository(":memory:", { adminPin: "2468" });
  try {
    const waiter = repo.createUser({fullName: "Mozo de prueba", roleCode: "WAITER", pin: "6083", authorizerPin: "2468"});
    assert.throws(() => repo.authorizeBackupRestore("6083"), /ADMIN/i);
    // Simulate a database from before PIN uniqueness was enforced.
    repo.db.prepare("UPDATE users SET pin_hash=(SELECT pin_hash FROM users WHERE id='user-admin') WHERE id=?").run(waiter.id);
    assert.throws(() => repo.authorizeBackupRestore("2468"), /ambiguo/i);
    const opened = repo.openCashSession({ openingAmountMinor: 3000 });
    assert.throws(() => repo.registerCashMovement({type:"WITHDRAWAL",amountMinor:300,reason:"Retiro QA",authorizerPin:"2468"}), /ambiguo/i);
    assert.equal(repo.bootstrap().cashSession?.expectedAmountMinor, opened.expectedAmountMinor);
  } finally { repo.close(); }
});

test("cash withdrawal requires cash.withdraw and records the authorizer", () => {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-cash-auth-"));
  const path = join(dir, "test.sqlite");
  const repo = configuredTestRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  const db = new Database(path);
  try {
    const authorizer = repo.createUser({ fullName: "Encargada", roleCode: "MANAGER", pin: "3691", authorizerPin: "2468" });
    const session = repo.openCashSession({ openingAmountMinor: 10000 });
    for (const [type, amountMinor] of [["WITHDRAWAL", 500], ["EXPENSE", 400], ["ADJUSTMENT", -300]] as const) {
      const input = { type, amountMinor, reason: "retiro", idempotencyKey: `cash-auth-${type}` };
      assert.throws(() => repo.registerCashMovement(input), /PIN incorrecto/);
      repo.registerCashMovement({ ...input, authorizerPin: "3691" });
      const movement = db.prepare("SELECT id,user_id FROM cash_movements WHERE cash_session_id=? AND type=? ORDER BY created_at DESC LIMIT 1")
        .get(session.id, type) as { id: string; user_id: string };
      const audit = db.prepare("SELECT authorizer_user_id FROM audit_log WHERE entity_id=? AND action=?")
        .get(session.id, `CASH_${type}`) as { authorizer_user_id: string };
      assert.equal(movement.user_id, authorizer.id);
      assert.equal(audit.authorizer_user_id, authorizer.id);
    }
    assert.throws(() => repo.registerCashMovement({ type: "REFUND" as never, amountMinor: 1, reason: "no", authorizerPin: "3691" }), /tipo de movimiento/);
  } finally {
    db.close(); repo.close(); rmSync(dir, { recursive: true, force: true });
  }
});
