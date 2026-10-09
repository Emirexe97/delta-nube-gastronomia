import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function fixture(run: (repo: SqliteGastronomyRepository, db: InstanceType<typeof Database>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-purchase-cost-"));
  const path = join(dir, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  const db = new Database(path);
  try { run(repo, db); }
  finally { db.close(); repo.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith("gastronomy-purchase-cost-")); rmSync(dir, { recursive: true, force: true }); }
}
function setup(repo: SqliteGastronomyRepository) {
  const products = repo.bootstrap().products.filter((p) => p.active).slice(0, 2);
  const purchase = repo.createPurchase({ supplierName: "Proveedor", items: [
    { productId: products[0]!.id, quantityMinor: 1500, unitCostMinor: 10001 },
    { productId: products[1]!.id, quantityMinor: 2000, unitCostMinor: 20000 },
  ], authorizerPin: "2468", idempotencyKey: "original-purchase" });
  const input = { purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0,
    unitCostMinor: 13000, reason: "Costo ingresado incorrectamente", authorizerPin: "2468", idempotencyKey: "correct-cost" };
  return { products, purchase, input };
}
function correct(repo: SqliteGastronomyRepository, input: Record<string, unknown>) { return (repo as any).correctPurchaseItemCost(input); }
function protectedTables(db: InstanceType<typeof Database>) {
  return Object.fromEntries(["products", "purchase_items", "orders", "order_items", "finance_order_item_costs", "finance_product_costs", "cash_sessions", "cash_movements", "finance_expenses"]
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

test("item cost correction appends immutable ledger, leaves purchase/item raw fields intact, and projects effective totals", () => fixture((repo, db) => {
  const { purchase, input } = setup(repo);
  const rawPurchase = db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id) as any;
  const { revision: _revision, ...rawHistoricalPurchase } = rawPurchase;
  const rawItems = db.prepare("SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid").all(purchase.id);
  const corrected = correct(repo, input);
  assert.equal(corrected.revision, 1);
  assert.equal(corrected.effectiveTotalMinor, 59500); // round(1.5 * 13000) + 2 * 20000
  assert.equal(corrected.items[0]!.effectiveUnitCostMinor, 13000);
  assert.equal(corrected.items[0]!.effectiveLineTotalMinor, 19500);
  assert.equal(corrected.items[1]!.effectiveUnitCostMinor, undefined);
  assert.equal(corrected.items[1]!.effectiveLineTotalMinor, undefined);
  const changedRawPurchase = db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id) as any;
  const { revision: _changedRevision, ...changedHistoricalPurchase } = changedRawPurchase;
  assert.equal(changedRawPurchase.revision, rawPurchase.revision + 1);
  assert.deepEqual(changedHistoricalPurchase, rawHistoricalPurchase);
  assert.deepEqual(db.prepare("SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid").all(purchase.id), rawItems);
  const ledger = db.prepare("SELECT * FROM purchase_item_cost_corrections WHERE purchase_id=?").get(purchase.id) as any;
  assert.equal(ledger.previous_unit_cost_minor, 10001); assert.equal(ledger.corrected_unit_cost_minor, 13000);
  assert.equal(ledger.previous_line_total_minor, 15002); assert.equal(ledger.corrected_line_total_minor, 19500);
  assert.equal(ledger.purchase_revision, 1); assert.equal(ledger.reason, input.reason);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_id=? AND action='PURCHASE_ITEM_COST_CORRECTED'").get(purchase.id) as any).n, 1);
}));

test("correction receipt replay and original create receipt never undo or duplicate later cost corrections", () => fixture((repo, db) => {
  const { purchase, input } = setup(repo);
  const first = correct(repo, input);
  const later = correct(repo, { ...input, unitCostMinor: 15000, expectedRevision: 1, idempotencyKey: "later-cost" });
  const receiptsBefore = db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all();
  assert.deepEqual(correct(repo, input), first);
  assert.equal(repo.listPurchases().find((p) => p.id === purchase.id)?.items[0]?.effectiveUnitCostMinor, 15000);
  assert.deepEqual(db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all(), receiptsBefore);
  assert.throws(() => correct(repo, { ...input, unitCostMinor: 14000 }), /idempotencia|datos diferentes/i);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM purchase_item_cost_corrections WHERE purchase_id=?").get(purchase.id) as any).n, 2);
  assert.equal(later.revision, 2);
}));

test("correcting one line retains the persisted historical amount of every untouched legacy line", () => fixture((repo, db) => {
  const { purchase, input } = setup(repo);
  db.prepare("UPDATE purchase_items SET line_total_minor=23456 WHERE id=?").run(purchase.items[1]!.id);
  correct(repo, input);
  const projected = repo.listPurchases().find((p) => p.id === purchase.id)!;
  assert.equal(projected.effectiveTotalMinor, 19500 + 23456);
  assert.equal(projected.items[1]!.effectiveLineTotalMinor, undefined);
  assert.equal(projected.items[1]!.lineTotalMinor, 23456);
}));

test("revision CAS, stale attempts and cross-purchase item IDs reject without partial writes", () => fixture((repo, db) => {
  const { products, purchase, input } = setup(repo);
  const before = () => ({ raw: protectedTables(db), ledger: db.prepare("SELECT * FROM purchase_item_cost_corrections ORDER BY rowid").all(), audits: db.prepare("SELECT * FROM audit_log ORDER BY rowid").all() });
  correct(repo, input); const afterFirst = before();
  assert.throws(() => correct(repo, { ...input, expectedRevision: 0, idempotencyKey: "stale" }), /modific|revisión/i);
  const another = repo.createPurchase({ supplierName: "Otra compra", items: [{ productId: products[0]!.id, quantityMinor: 1000, unitCostMinor: 7000 }], authorizerPin: "2468" });
  const stable = before();
  assert.throws(() => correct(repo, { ...input, purchaseId: another.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0, idempotencyKey: "foreign" }), /artículo|compra|existe/i);
  assert.deepEqual(before(), stable); assert.notDeepEqual(afterFirst.ledger, []);
}));

test("validation rejects malformed reason, negative/fractional/unsafe cost and no-op corrections", () => fixture((repo, db) => {
  const { input } = setup(repo); const snapshot = () => ({ ledger: db.prepare("SELECT * FROM purchase_item_cost_corrections ORDER BY rowid").all(), receipts: db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all(), audits: db.prepare("SELECT * FROM audit_log ORDER BY rowid").all() });
  const before = snapshot();
  for (const [patch, key] of [[{ reason: "  " }, "empty"], [{ reason: "x".repeat(501) }, "long"], [{ unitCostMinor: -1 }, "negative"], [{ unitCostMinor: 1.5 }, "fraction"], [{ unitCostMinor: Number.MAX_SAFE_INTEGER + 1 }, "unsafe"], [{ unitCostMinor: 10001 }, "same"]] as const) {
    assert.throws(() => correct(repo, { ...input, ...patch, idempotencyKey: key }), /costo|motivo|igual|inválid/i);
    assert.deepEqual(snapshot(), before);
  }
}));

test("unsafe next revision and corrupt legacy quantity reject without a ledger append", () => fixture((repo, db) => {
  const { purchase, input } = setup(repo);
  db.prepare("UPDATE purchases SET revision=? WHERE id=?").run(Number.MAX_SAFE_INTEGER, purchase.id);
  const before = db.prepare("SELECT * FROM purchase_item_cost_corrections").all();
  assert.throws(() => correct(repo, { ...input, expectedRevision: Number.MAX_SAFE_INTEGER, idempotencyKey: "revision-overflow" }), /revisión|límite/i);
  assert.deepEqual(db.prepare("SELECT * FROM purchase_item_cost_corrections").all(), before);
  db.prepare("UPDATE purchases SET revision=0 WHERE id=?").run(purchase.id);
  db.prepare("UPDATE purchase_items SET quantity_minor=? WHERE id=?").run(Number.MAX_SAFE_INTEGER + 1, purchase.items[0]!.id);
  assert.throws(() => correct(repo, { ...input, idempotencyKey: "bad-historical-quantity" }), /cantidad|artículo/i);
  assert.deepEqual(db.prepare("SELECT * FROM purchase_item_cost_corrections").all(), before);
}));

test("correction ledger rejects mutation and deletion", () => fixture((repo, db) => {
  const { input } = setup(repo); correct(repo, input);
  assert.throws(() => db.prepare("UPDATE purchase_item_cost_corrections SET reason='alterado'").run(), /immutable|inmutable/i);
  assert.throws(() => db.prepare("DELETE FROM purchase_item_cost_corrections").run(), /immutable|inmutable/i);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM purchase_item_cost_corrections").get() as any).n, 1);
}));

test("authorized purchases permission and valid same-permission PIN are required", () => fixture((repo, db) => {
  const { input } = setup(repo); const cashier = repo.createUser({ fullName: "Cajero", roleCode: "CASHIER", pin: "1357", authorizerPin: "2468" });
  const before = protectedTables(db);
  assert.throws(() => correct(repo, { ...input, authorizerPin: "bad", idempotencyKey: "bad-pin" }), /PIN|autoriz/i);
  assert.throws(() => correct(repo, { ...input, authorizerPin: "1357", idempotencyKey: "no-permission" }), /permiso|autoriz/i);
  assert.ok(cashier.id); assert.deepEqual(protectedTables(db), before);
  correct(repo, input);
  db.prepare("DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','purchases.manage')").run(repo.bootstrap().currentUser.id);
  assert.throws(() => correct(repo, input), /permiso/i);
  assert.throws(() => correct(repo, { ...input, expectedRevision: 1, idempotencyKey: "denied-new" }), /permiso/i);
}));

test("zero cost and rounded fractional quantity use integer half-up arithmetic; overflow is rejected", () => fixture((repo, db) => {
  const { input } = setup(repo);
  const zero = correct(repo, { ...input, unitCostMinor: 0, idempotencyKey: "zero-cost" });
  assert.equal(zero.items[0]!.effectiveLineTotalMinor, 0);
  const rounded = repo.createPurchase({ supplierName: "Fracción", items: [{ productId: repo.bootstrap().products[2]!.id, quantityMinor: 500, unitCostMinor: 20 }], authorizerPin: "2468" });
  const fractional = correct(repo, { purchaseId: rounded.id, purchaseItemId: rounded.items[0]!.id, expectedRevision: 0, unitCostMinor: 1, reason: "Ajuste mínimo", authorizerPin: "2468" });
  assert.equal(fractional.items[0]!.effectiveLineTotalMinor, 1);
  const tooLarge = repo.createPurchase({ supplierName: "Desborde", items: [{ productId: repo.bootstrap().products[3]!.id, quantityMinor: 1_000_000_000_000, unitCostMinor: 0 }], authorizerPin: "2468" });
  const snapshot = db.prepare("SELECT * FROM purchase_item_cost_corrections WHERE purchase_id=?").all(tooLarge.id);
  assert.throws(() => correct(repo, { purchaseId: tooLarge.id, purchaseItemId: tooLarge.items[0]!.id, expectedRevision: 0, unitCostMinor: Number.MAX_SAFE_INTEGER, reason: "Desborde", authorizerPin: "2468" }), /límite|seguro|total|overflow/i);
  assert.deepEqual(db.prepare("SELECT * FROM purchase_item_cost_corrections WHERE purchase_id=?").all(tooLarge.id), snapshot);
}));

test("historical finance report adjusts purchase amount only; it does not rewrite order COGS", () => fixture((repo) => {
  const { products, purchase, input } = setup(repo);
  const day = purchase.createdAt.slice(0, 10);
  const before = repo.getFinanceReport({ from: day, to: day });
  correct(repo, input);
  const after = repo.getFinanceReport({ from: day, to: day });
  assert.equal(after.purchasesMinor, before.purchasesMinor + 4498);
  assert.equal(after.cogsMinor, before.cogsMinor);
  assert.equal(after.estimatedOperatingProfitMinor, before.estimatedOperatingProfitMinor);
  assert.ok(products.length > 0);
}));

test("manual product cost remains preferred over purchase correction; new purchase cost discovery uses correction", () => fixture((repo) => {
  const { products, purchase, input } = setup(repo);
  repo.setFinanceProductCost({ productId: products[0]!.id, unitCostMinor: 555 });
  correct(repo, input);
  assert.equal(repo.getFinanceProductCosts().find((row) => row.productId === products[0]!.id)?.unitCostMinor, 555);
  const next = repo.createPurchase({ supplierName: "Compra futura", items: [{ productId: products[0]!.id, quantityMinor: 1000, unitCostMinor: 18000 }], authorizerPin: "2468" });
  assert.ok(next.id);
  assert.equal(repo.getFinanceProductCosts().find((row) => row.productId === products[1]!.id)?.unitCostMinor, 20000);
}));

test("migration from schema 35 creates empty append-only correction ledger without changing historical purchase rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-purchase-cost-")); const path = join(dir, "test.sqlite");
  let repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true }); let db = new Database(path);
  try {
    const { purchase } = setup(repo); const before = db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id);
    db.exec("DROP TABLE purchase_item_quantity_corrections"); db.exec("DROP TABLE purchase_item_cost_corrections"); db.prepare("DELETE FROM schema_migrations WHERE version>=36").run();
    db.close(); repo.close(); repo = new SqliteGastronomyRepository(path, { adminPin: "2468" }); db = new Database(path);
    assert.deepEqual(db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id), before);
    assert.equal((db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as any).version, 37);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM purchase_item_cost_corrections").get() as any).n, 0);
  } finally { db.close(); repo.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith("gastronomy-purchase-cost-")); rmSync(dir, { recursive: true, force: true }); }
});
