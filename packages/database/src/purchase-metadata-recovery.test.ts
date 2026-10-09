import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function fixture(run: (repo: SqliteGastronomyRepository, db: InstanceType<typeof Database>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-purchase-metadata-"));
  const path = join(dir, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  const db = new Database(path);
  try { run(repo, db); }
  finally {
    db.close(); repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("gastronomy-purchase-metadata-"));
    rmSync(dir, { recursive: true, force: true });
  }
}
function setup(repo: SqliteGastronomyRepository) {
  const product = repo.bootstrap().products.find((row) => row.active)!;
  const creation = { supplierName: "Proveedor original", invoiceNumber: "FACT-1", notes: "Nota original",
    items: [{ productId: product.id, quantityMinor: 2500, unitCostMinor: 12000 }],
    authorizerPin: "2468", idempotencyKey: "purchase-original" };
  const purchase = repo.createPurchase(creation);
  const correction = { purchaseId: purchase.id, expectedRevision: 0, supplierName: "Proveedor corregido",
    invoiceNumber: "FACT-2", notes: "Nota corregida", reason: "Comprobante transcripto mal",
    authorizerPin: "2468", idempotencyKey: "purchase-correction" };
  return { product, creation, purchase, correction };
}
function correct(repo: SqliteGastronomyRepository, input: Record<string, unknown>) {
  return (repo as any).correctPurchaseMetadata(input);
}
function protectedState(db: InstanceType<typeof Database>) {
  const tables = ["products", "purchase_items", "orders", "order_items", "finance_order_item_costs", "finance_product_costs",
    "cash_sessions", "cash_movements", "finance_expenses", "finance_recurring", "finance_expense_returns",
    "finance_expense_payment_corrections", "finance_expense_closed_payment_corrections"];
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

test("purchase metadata correction preserves original identity, items, total, later stock, costs and money with a full audit", () => fixture((repo, db) => {
  const { product, purchase, correction } = setup(repo);
  repo.openCashSession({ openingAmountMinor: 50000 });
  repo.createPurchase({ supplierName: "Compra posterior", items: [{ productId: product.id, quantityMinor: 1000, unitCostMinor: 18000 }], authorizerPin: "2468", idempotencyKey: "later-purchase" });
  repo.adjustStock({ productId: product.id, newStockMinor: 9000, reason: "Conteo posterior", authorizerPin: "2468" });
  repo.setFinanceProductCost({ productId: product.id, unitCostMinor: 19000 });
  const before = protectedState(db);
  const other = repo.listPurchases().find((p) => p.id !== purchase.id);
  const changed = correct(repo, { ...correction, supplierName: "  Proveedor corregido  ", reason: "  Comprobante transcripto mal  " });
  assert.equal(changed.supplierName, "Proveedor corregido");
  assert.equal(changed.invoiceNumber, "FACT-2"); assert.equal(changed.notes, "Nota corregida"); assert.equal(changed.revision, 1);
  for (const field of ["id", "createdAt", "createdByUserId", "createdByUserName", "totalMinor", "items"] as const)
    assert.deepEqual(changed[field], purchase[field]);
  assert.deepEqual(protectedState(db), before);
  assert.deepEqual(repo.listPurchases().find((p) => p.id === other!.id), other);
  const audit = db.prepare("SELECT * FROM audit_log WHERE entity_id=? AND action='PURCHASE_METADATA_CORRECTED'").get(purchase.id) as any;
  assert.equal(audit.reason, correction.reason); assert.ok(audit.operator_user_id); assert.ok(audit.authorizer_user_id);
  assert.equal(JSON.parse(audit.before_json).supplierName, purchase.supplierName);
  assert.equal(JSON.parse(audit.after_json).supplierName, changed.supplierName);
}));

test("original creation and correction receipt replays preserve later corrected metadata and all stock", () => fixture((repo, db) => {
  const { creation, purchase, correction } = setup(repo);
  const first = correct(repo, correction);
  const second = correct(repo, { ...correction, supplierName: "Tercero", expectedRevision: 1, idempotencyKey: "second-correction" });
  const before = protectedState(db);
  const rowBefore = db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id);
  const countsBefore = db.prepare("SELECT (SELECT COUNT(*) FROM audit_log) audits,(SELECT COUNT(*) FROM command_receipts) receipts").get();
  assert.deepEqual(repo.createPurchase(creation), purchase);
  assert.deepEqual(correct(repo, correction), first);
  assert.equal(repo.listPurchases().find((p) => p.id === purchase.id)?.supplierName, second.supplierName);
  assert.deepEqual(db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id), rowBefore);
  assert.deepEqual(protectedState(db), before);
  assert.deepEqual(db.prepare("SELECT (SELECT COUNT(*) FROM audit_log) audits,(SELECT COUNT(*) FROM command_receipts) receipts").get(), countsBefore);
  assert.throws(() => correct(repo, { ...correction, supplierName: "different payload" }), /idempotencia|datos diferentes/i);
}));

test("purchase correction rejects stale concurrent revisions without a second write", () => fixture((repo, db) => {
  const { purchase, correction } = setup(repo);
  assert.equal(correct(repo, correction).revision, 1);
  assert.throws(() => correct(repo, { ...correction, idempotencyKey: "stale-other-terminal", terminalId: "SECOND" }), /modific|actualiz|revisión/i);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_id=? AND action='PURCHASE_METADATA_CORRECTED'").get(purchase.id) as any).n, 1);
  assert.equal(repo.listPurchases().find((p) => p.id === purchase.id)?.revision, 1);
}));

test("omitted purchase metadata preserves values; null or whitespace explicitly clears optional fields", () => fixture((repo) => {
  const { purchase, correction } = setup(repo);
  const { invoiceNumber: _invoice, notes: _notes, ...omitted } = correction;
  const first = correct(repo, omitted);
  assert.equal(first.invoiceNumber, purchase.invoiceNumber); assert.equal(first.notes, purchase.notes);
  const second = correct(repo, { ...correction, expectedRevision: 1, invoiceNumber: null, notes: "   ", idempotencyKey: "clear-options" });
  assert.equal(second.invoiceNumber, null); assert.equal(second.notes, null);
}));

test("invalid purchase corrections and unknown purchase leave every write table unchanged", () => fixture((repo, db) => {
  const { correction } = setup(repo);
  const snapshot = () => ({ protected: protectedState(db), purchases: db.prepare("SELECT * FROM purchases ORDER BY rowid").all(),
    receipts: db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all(), audits: db.prepare("SELECT * FROM audit_log ORDER BY rowid").all() });
  const before = snapshot();
  for (const patch of [{ supplierName: " " }, { supplierName: null }, { reason: "" }, { reason: "x".repeat(501) },
    { expectedRevision: -1 }, { expectedRevision: 0.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { expectedRevision: undefined }, { invoiceNumber: 12 }, { notes: {} }, { purchaseId: "unknown" }]) {
    assert.throws(() => correct(repo, { ...correction, ...patch, idempotencyKey: `invalid-${JSON.stringify(patch)}` }), /revisión|motivo|datos de compra|compra no existe/i);
    assert.deepEqual(snapshot(), before);
  }
}));

test("purchase correction requires an authorized purchases PIN and session permission even on receipt replay", () => fixture((repo, db) => {
  const { correction } = setup(repo);
  const cashier = repo.createUser({ fullName: "Cajero sin permiso", roleCode: "CASHIER", pin: "1357", authorizerPin: "2468" });
  const before = protectedState(db);
  assert.throws(() => correct(repo, { ...correction, authorizerPin: "wrong", idempotencyKey: "bad-pin" }), /PIN|autoriz/i);
  assert.throws(() => correct(repo, { ...correction, authorizerPin: "1357", idempotencyKey: "cashier-pin" }), /permiso|autoriz/i);
  assert.ok(cashier.id); assert.deepEqual(protectedState(db), before);
  correct(repo, correction);
  db.prepare("DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','purchases.manage')").run(repo.bootstrap().currentUser.id);
  assert.throws(() => correct(repo, correction), /permiso/i);
  assert.throws(() => correct(repo, { ...correction, expectedRevision: 1, idempotencyKey: "denied-new" }), /permiso/i);
}));

test("migration adds zero revision to existing purchases without changing any historical fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-purchase-metadata-"));
  const path = join(dir, "test.sqlite");
  let repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  let db = new Database(path);
  try {
    const { purchase } = setup(repo);
    // Reproduce an actual persisted v34 database, then let constructor migrate it.
    db.exec("DROP TABLE purchase_item_quantity_corrections");
    db.exec("DROP TABLE purchase_item_cost_corrections");
    if ((db.prepare("PRAGMA table_info(purchases)").all() as any[]).some((column) => column.name === "revision"))
      db.exec("ALTER TABLE purchases DROP COLUMN revision");
    db.prepare("DELETE FROM schema_migrations WHERE version>=35").run();
    const before = db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id) as any;
    const businessBefore = protectedState(db);
    const receiptsBefore = db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all();
    db.close(); repo.close();
    repo = new SqliteGastronomyRepository(path, { adminPin: "2468" }); db = new Database(path);
    const row = db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id) as any;
    const { revision, ...historical } = row;
    assert.equal(revision, 0); assert.deepEqual(historical, before);
    assert.equal(repo.listPurchases().find((p) => p.id === purchase.id)?.revision, 0);
    assert.deepEqual(protectedState(db), businessBefore);
    assert.deepEqual(db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all(), receiptsBefore);
    assert.equal((db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as any).version, 37);
    assert.deepEqual(db.prepare("SELECT version FROM schema_migrations WHERE version>=35 ORDER BY version").all(), [{ version: 35 }, { version: 36 }, { version: 37 }]);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM purchase_item_cost_corrections").get() as any).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM purchase_item_quantity_corrections").get() as any).count, 0);
  } finally {
    db.close(); repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("gastronomy-purchase-metadata-"));
    rmSync(dir, { recursive: true, force: true });
  }
});
