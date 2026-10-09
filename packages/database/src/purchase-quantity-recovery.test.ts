import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function fixture(run: (repo: SqliteGastronomyRepository, db: InstanceType<typeof Database>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-purchase-quantity-"));
  const path = join(dir, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  const db = new Database(path);
  try { run(repo, db); }
  finally { db.close(); repo.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith("gastronomy-purchase-quantity-")); rmSync(dir, { recursive: true, force: true }); }
}
function setup(repo: SqliteGastronomyRepository) {
  const products = repo.bootstrap().products.filter((p) => p.active).slice(0, 2);
  const purchase = repo.createPurchase({ supplierName: "Compra histórica", items: [
    { productId: products[0]!.id, quantityMinor: 1500, unitCostMinor: 10001 },
    { productId: products[1]!.id, quantityMinor: 2000, unitCostMinor: 20000 },
  ], authorizerPin: "2468", idempotencyKey: "original-purchase" });
  const input = { purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0,
    quantityMinor: 2500, reason: "Cantidad documental incorrecta", authorizerPin: "2468", idempotencyKey: "correct-quantity" };
  return { products, purchase, input };
}
function correctQuantity(repo: SqliteGastronomyRepository, input: Record<string, unknown>) { return (repo as any).correctPurchaseItemQuantity(input); }
function correctCost(repo: SqliteGastronomyRepository, input: Record<string, unknown>) { return (repo as any).correctPurchaseItemCost(input); }

test("quantity correction is documentary only: appends ledger, keeps raw purchase/items and stock unchanged", () => fixture((repo, db) => {
  const { products, purchase, input } = setup(repo);
  const originalPurchase = db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id) as any;
  const originalItems = db.prepare("SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid").all(purchase.id);
  const stockBefore = db.prepare("SELECT id,stock_minor,updated_at FROM products ORDER BY id").all();
  const changed = correctQuantity(repo, input);
  assert.equal(changed.revision, 1);
  assert.equal(changed.items[0]!.quantityMinor, 1500);
  assert.equal(changed.items[0]!.effectiveQuantityMinor, 2500);
  assert.equal(changed.items[0]!.effectiveUnitCostMinor, undefined);
  assert.equal(changed.items[0]!.effectiveLineTotalMinor, 25003);
  assert.equal(changed.effectiveTotalMinor, 65003);
  assert.equal(changed.items[1]!.effectiveQuantityMinor, undefined);
  const rawAfter = db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id) as any;
  const { revision: _beforeRevision, ...rawBefore } = originalPurchase;
  const { revision: _afterRevision, ...rawAfterFields } = rawAfter;
  assert.equal(rawAfter.revision, originalPurchase.revision + 1);
  assert.deepEqual(rawAfterFields, rawBefore);
  assert.deepEqual(db.prepare("SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid").all(purchase.id), originalItems);
  assert.deepEqual(db.prepare("SELECT id,stock_minor,updated_at FROM products ORDER BY id").all(), stockBefore);
  const ledger = db.prepare("SELECT * FROM purchase_item_quantity_corrections WHERE purchase_id=?").get(purchase.id) as any;
  assert.equal(ledger.previous_quantity_minor, 1500);
  assert.equal(ledger.effective_quantity_minor, 2500);
  assert.equal(ledger.effective_unit_cost_minor, 10001);
  assert.equal(ledger.effective_line_total_minor, 25003);
  assert.equal(ledger.purchase_revision, 1);
  assert.equal(ledger.reason, input.reason);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_id=? AND action='PURCHASE_ITEM_QUANTITY_CORRECTED'").get(purchase.id) as any).n, 1);
  assert.ok(products.length > 0);
}));

test("physical stock counts, confirmed-order COGS/profit/cash, and current cost stay unchanged by documentary quantity correction", () => fixture((repo, db) => {
  const { products } = setup(repo);
  const product = products[0]!;
  repo.openCashSession({ openingAmountMinor: 50000 });
  repo.setFinanceProductCost({ productId: product.id, unitCostMinor: 4000 });
  const draft = repo.createOrder({ type: "TAKEAWAY", customerName: "Venta de prueba", customerPhone: "1155557200" });
  repo.addOrderItem({ orderId: draft.id, productId: product.id });
  repo.confirmOrder({ orderId: draft.id });
  const day = repo.bootstrap().cashSession!.businessDate;
  const snapshot = db.prepare("SELECT * FROM finance_order_item_costs WHERE order_id=?").all(draft.id);
  assert.ok(snapshot.length > 0);
  const reportBefore = repo.getFinanceReport({ from: day, to: day });
  assert.ok(reportBefore.cogsMinor > 0);
  const cashBefore = repo.bootstrap().cashSession!.expectedAmountMinor;
  const purchase = repo.createPurchase({ supplierName: "Compra documental", items: [{ productId: product.id, quantityMinor: 1500, unitCostMinor: 10001 }], authorizerPin: "2468" });
  // A legacy item may belong to a product whose tracked stock is intentionally NULL.
  db.prepare("UPDATE products SET stock_minor=NULL WHERE id=?").run(products[1]!.id);
  const nullStockPurchase = repo.createPurchase({ supplierName: "Compra sin stock controlado", items: [{ productId: products[1]!.id, quantityMinor: 1000, unitCostMinor: 100 }], authorizerPin: "2468" });
  db.prepare("UPDATE products SET stock_minor=NULL WHERE id=?").run(products[1]!.id);
  repo.adjustStock({ productId: product.id, newStockMinor: 7777, reason: "Conteo físico", authorizerPin: "2468" });
  const countedStock = db.prepare("SELECT stock_minor FROM products WHERE id=?").get(product.id);
  const costBefore = repo.getFinanceProductCosts().find((row) => row.productId === product.id);
  const beforeCorrectionReport = repo.getFinanceReport({ from: day, to: day });
  const changed = correctQuantity(repo, { purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0,
    quantityMinor: 2500, reason: "Ajuste documental", authorizerPin: "2468", idempotencyKey: "physical-count-safe" });
  assert.equal(changed.items[0]!.effectiveQuantityMinor, 2500);
  assert.deepEqual(db.prepare("SELECT stock_minor FROM products WHERE id=?").get(product.id), countedStock);
  assert.equal((db.prepare("SELECT stock_minor FROM products WHERE id=?").get(products[1]!.id) as any).stock_minor, null);
  const reportAfter = repo.getFinanceReport({ from: day, to: day });
  assert.equal(reportAfter.cogsMinor, beforeCorrectionReport.cogsMinor);
  assert.equal(reportAfter.estimatedOperatingProfitMinor, beforeCorrectionReport.estimatedOperatingProfitMinor);
  assert.equal(repo.bootstrap().cashSession!.expectedAmountMinor, cashBefore);
  assert.deepEqual(repo.getFinanceProductCosts().find((row) => row.productId === product.id), costBefore);
  assert.deepEqual(db.prepare("SELECT * FROM finance_order_item_costs WHERE order_id=?").all(draft.id), snapshot);
  const nullChanged = correctQuantity(repo, { purchaseId: nullStockPurchase.id, purchaseItemId: nullStockPurchase.items[0]!.id, expectedRevision: 0,
    quantityMinor: 1500, reason: "Ajuste documental nulo", authorizerPin: "2468", idempotencyKey: "null-stock-safe" });
  assert.equal(nullChanged.items[0]!.effectiveQuantityMinor, 1500);
  assert.equal((db.prepare("SELECT stock_minor FROM products WHERE id=?").get(products[1]!.id) as any).stock_minor, null);
}));

test("cost and quantity corrections compose in either order on shared purchase revision and latest line amount", () => fixture((repo) => {
  const { purchase, input } = setup(repo);
  const firstQty = correctQuantity(repo, input);
  assert.equal(firstQty.effectiveTotalMinor, 65003);
  const cost = correctCost(repo, { purchaseId: purchase.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 1,
    unitCostMinor: 13000, reason: "Costo corregido", authorizerPin: "2468", idempotencyKey: "cost-after-qty" });
  assert.equal(cost.revision, 2);
  assert.equal(cost.items[0]!.effectiveQuantityMinor, 2500);
  assert.equal(cost.items[0]!.effectiveUnitCostMinor, 13000);
  assert.equal(cost.items[0]!.effectiveLineTotalMinor, 32500);
  assert.equal(cost.effectiveTotalMinor, 72500);
  const quantityAgain = correctQuantity(repo, { ...input, expectedRevision: 2, quantityMinor: 500, idempotencyKey: "qty-after-cost" });
  assert.equal(quantityAgain.revision, 3);
  assert.equal(quantityAgain.items[0]!.effectiveQuantityMinor, 500);
  assert.equal(quantityAgain.items[0]!.effectiveUnitCostMinor, 13000);
  assert.equal(quantityAgain.items[0]!.effectiveLineTotalMinor, 6500);
  assert.equal(quantityAgain.effectiveTotalMinor, 46500);
}));

test("quantity correction retains persisted rounding on untouched lines and report uses original purchase date", () => fixture((repo, db) => {
  const { purchase, input } = setup(repo);
  db.prepare("UPDATE purchase_items SET line_total_minor=23456 WHERE id=?").run(purchase.items[1]!.id);
  db.prepare("UPDATE purchases SET total_minor=? WHERE id=?").run(15002 + 23456, purchase.id);
  const day = purchase.createdAt.slice(0, 10);
  const before = repo.getFinanceReport({ from: day, to: day });
  correctQuantity(repo, input);
  const after = repo.getFinanceReport({ from: day, to: day });
  assert.equal(after.purchasesMinor, before.purchasesMinor + 10001);
  assert.equal(after.cogsMinor, before.cogsMinor);
  assert.equal(after.estimatedOperatingProfitMinor, before.estimatedOperatingProfitMinor);
  const projected = repo.listPurchases().find((p) => p.id === purchase.id)!;
  assert.equal(projected.effectiveTotalMinor, 25003 + 23456);
  assert.equal(projected.items[1]!.lineTotalMinor, 23456);
}));

test("same-quantity, invalid inputs, unsafe/zero quantities and aggregate overflow reject without ledger writes", () => fixture((repo, db) => {
  const { purchase, input } = setup(repo);
  const snapshot = () => ({ ledger: db.prepare("SELECT * FROM purchase_item_quantity_corrections ORDER BY rowid").all(), receipts: db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all(), audits: db.prepare("SELECT * FROM audit_log ORDER BY rowid").all() });
  const before = snapshot();
  for (const [patch, key] of [[{ quantityMinor: 1500 }, "same"], [{ quantityMinor: 0 }, "zero"], [{ quantityMinor: -1 }, "negative"], [{ quantityMinor: 1.2 }, "fraction"], [{ quantityMinor: Number.MAX_SAFE_INTEGER + 1 }, "unsafe"], [{ reason: " " }, "reason"], [{ reason: "x".repeat(501) }, "long-reason"]] as const) {
    assert.throws(() => correctQuantity(repo, { ...input, ...patch, idempotencyKey: key }), /cantidad|motivo|válid|igual|límite/i);
    assert.deepEqual(snapshot(), before);
  }
  const huge = repo.createPurchase({ supplierName: "Desborde", items: [{ productId: repo.bootstrap().products[2]!.id, quantityMinor: 1_000_000_000_000, unitCostMinor: 10000 }], authorizerPin: "2468" });
  assert.throws(() => correctQuantity(repo, { purchaseId: huge.id, purchaseItemId: huge.items[0]!.id, expectedRevision: 0,
    quantityMinor: Number.MAX_SAFE_INTEGER, reason: "Desborde", authorizerPin: "2468" }), /límite|seguro|total|overflow/i);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM purchase_item_quantity_corrections WHERE purchase_id=?").get(huge.id) as any).n, 0);
  assert.equal(purchase.revision, 0);
}));

test("quantity receipt replay, stale revision and foreign item reject without duplicating audit or ledger", () => fixture((repo, db) => {
  const { products, purchase, input } = setup(repo);
  const first = correctQuantity(repo, input);
  assert.deepEqual(correctQuantity(repo, input), first);
  const another = repo.createPurchase({ supplierName: "Otra", items: [{ productId: products[1]!.id, quantityMinor: 1000, unitCostMinor: 2 }], authorizerPin: "2468" });
  const before = () => ({ ledger: db.prepare("SELECT * FROM purchase_item_quantity_corrections ORDER BY rowid").all(), audits: db.prepare("SELECT * FROM audit_log ORDER BY rowid").all() });
  const stable = before();
  assert.throws(() => correctQuantity(repo, { ...input, expectedRevision: 0, idempotencyKey: "stale" }), /modific|revisión/i);
  assert.throws(() => correctQuantity(repo, { ...input, purchaseId: another.id, purchaseItemId: purchase.items[0]!.id, expectedRevision: 0, idempotencyKey: "foreign" }), /artículo|compra|existe/i);
  assert.deepEqual(before(), stable);
}));

test("quantity correction ledger insert failure rolls back revision, receipt, audit, and can retry the same idempotency key", () => fixture((repo, db) => {
  const { purchase, input } = setup(repo);
  db.exec(`CREATE TRIGGER reject_quantity_correction BEFORE INSERT ON purchase_item_quantity_corrections
    BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END;`);
  const baseline = () => ({ purchase: db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id),
    item: db.prepare("SELECT * FROM purchase_items WHERE id=?").get(input.purchaseItemId),
    ledger: db.prepare("SELECT * FROM purchase_item_quantity_corrections ORDER BY rowid").all(),
    receipts: db.prepare("SELECT * FROM command_receipts ORDER BY rowid").all(),
    audits: db.prepare("SELECT * FROM audit_log ORDER BY rowid").all() });
  const before = baseline();
  assert.throws(() => correctQuantity(repo, input), /injected ledger failure/i);
  assert.deepEqual(baseline(), before);
  db.exec("DROP TRIGGER reject_quantity_correction");
  const result = correctQuantity(repo, input);
  assert.equal(result.revision, 1);
  assert.equal(result.items[0]!.effectiveQuantityMinor, input.quantityMinor);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM purchase_item_quantity_corrections WHERE purchase_id=?").get(purchase.id) as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_id=? AND action='PURCHASE_ITEM_QUANTITY_CORRECTED'").get(purchase.id) as any).n, 1);
  assert.equal((db.prepare("SELECT revision FROM purchases WHERE id=?").get(purchase.id) as any).revision, 1);
}));

test("quantity correction requires purchases.manage and a valid same-permission authorizer PIN", () => fixture((repo, db) => {
  const { input } = setup(repo);
  const cashier = repo.createUser({ fullName: "Cajero", roleCode: "CASHIER", pin: "1357", authorizerPin: "2468" });
  const before = db.prepare("SELECT * FROM purchase_item_quantity_corrections ORDER BY rowid").all();
  assert.throws(() => correctQuantity(repo, { ...input, authorizerPin: "bad", idempotencyKey: "bad-pin" }), /PIN|autoriz/i);
  assert.throws(() => correctQuantity(repo, { ...input, authorizerPin: "1357", idempotencyKey: "cashier-pin" }), /permiso|autoriz/i);
  assert.ok(cashier.id); assert.deepEqual(db.prepare("SELECT * FROM purchase_item_quantity_corrections ORDER BY rowid").all(), before);
  correctQuantity(repo, input);
  db.prepare("DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','purchases.manage')").run(repo.bootstrap().currentUser.id);
  assert.throws(() => correctQuantity(repo, input), /permiso/i);
  assert.throws(() => correctQuantity(repo, { ...input, expectedRevision: 1, idempotencyKey: "denied-new" }), /permiso/i);
}));

test("quantity ledger is immutable and migration 37 upgrades schema 36 without changing historical values", () => {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-purchase-quantity-")); const path = join(dir, "test.sqlite");
  let repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true }); let db = new Database(path);
  try {
    const { purchase, input } = setup(repo);
    const purchaseBefore = db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id);
    const itemsBefore = db.prepare("SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid").all(purchase.id);
    // Return the fixture to schema 36 while retaining all real historical business rows.
    db.exec("DROP TABLE IF EXISTS purchase_item_quantity_corrections"); db.prepare("DELETE FROM schema_migrations WHERE version=37").run();
    db.close(); repo.close(); repo = new SqliteGastronomyRepository(path, { adminPin: "2468" }); db = new Database(path);
    assert.equal((db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as any).version, 37);
    assert.deepEqual(db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id), purchaseBefore);
    assert.deepEqual(db.prepare("SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid").all(purchase.id), itemsBefore);
    correctQuantity(repo, input);
    assert.throws(() => db.prepare("UPDATE purchase_item_quantity_corrections SET reason='edited'").run(), /immutable|inmutable/i);
    assert.throws(() => db.prepare("DELETE FROM purchase_item_quantity_corrections").run(), /immutable|inmutable/i);
  } finally { db.close(); repo.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith("gastronomy-purchase-quantity-")); rmSync(dir, { recursive: true, force: true }); }
});
