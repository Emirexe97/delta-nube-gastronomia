import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";
import { migrations } from "./migrations";
import {
  removeNewNullablePurchaseColumns,
  rewindPurchaseTestSchema,
} from "./purchase-migration-test-helper";

function fixture(
  run: (
    repo: SqliteGastronomyRepository,
    db: InstanceType<typeof Database>,
    dir: string,
    path: string,
  ) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-purchase-document-"));
  const path = join(dir, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  const db = new Database(path);
  try {
    run(repo, db, dir, path);
  } finally {
    db.close();
    repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("gastronomy-purchase-document-"));
    rmSync(dir, { recursive: true, force: true });
  }
}
function setup(repo: SqliteGastronomyRepository) {
  const products = repo
    .bootstrap()
    .products.filter((p) => p.active)
    .slice(0, 3);
  const purchase = repo.createPurchase({
    supplierName: "Proveedor",
    items: [
      { productId: products[0]!.id, quantityMinor: 1500, unitCostMinor: 10001 },
      { productId: products[1]!.id, quantityMinor: 2000, unitCostMinor: 20000 },
    ],
    authorizerPin: "2468",
    idempotencyKey: "purchase-document-original",
  });
  return { products, purchase };
}
const cancel = (
  repo: SqliteGastronomyRepository,
  input: Record<string, unknown>,
) => (repo as any).cancelPurchase(input);
const correctProduct = (
  repo: SqliteGastronomyRepository,
  input: Record<string, unknown>,
) => (repo as any).correctPurchaseItemProduct(input);
const purchaseSnapshot = (
  db: InstanceType<typeof Database>,
  purchaseId: string,
) => ({
  purchase: db.prepare("SELECT * FROM purchases WHERE id=?").get(purchaseId),
  items: db
    .prepare("SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid")
    .all(purchaseId),
  cancellation: db
    .prepare(
      "SELECT * FROM purchase_cancellations WHERE purchase_id=? ORDER BY rowid",
    )
    .all(purchaseId),
  products: db.prepare("SELECT id,stock_minor FROM products ORDER BY id").all(),
  cash: db.prepare("SELECT * FROM cash_sessions ORDER BY rowid").all(),
  movements: db.prepare("SELECT * FROM cash_movements ORDER BY rowid").all(),
  cogs: db
    .prepare("SELECT * FROM finance_order_item_costs ORDER BY rowid")
    .all(),
});

test("purchase cancellation is documentary-only, preserves original data and excludes future reference/finance", () =>
  fixture((repo, db) => {
    const { products, purchase } = setup(repo);
    const day = purchase.createdAt.slice(0, 10);
    repo.openCashSession({ openingAmountMinor: 50000 });
    repo.setFinanceProductCost({
      productId: products[0]!.id,
      unitCostMinor: 7000,
    });
    const order = repo.createOrder({
      type: "TAKEAWAY",
      customerName: "COGS snapshot",
      customerPhone: "1155550010",
    });
    repo.addOrderItem({ orderId: order.id, productId: products[0]!.id });
    repo.confirmOrder({ orderId: order.id });
    const stockBefore = db
      .prepare("SELECT id,stock_minor FROM products ORDER BY id")
      .all();
    const itemBefore = db
      .prepare(
        "SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid",
      )
      .all(purchase.id);
    const purchaseBefore = db
      .prepare("SELECT * FROM purchases WHERE id=?")
      .get(purchase.id) as any;
    const cogsBefore = db
      .prepare("SELECT * FROM finance_order_item_costs WHERE order_id=?")
      .all(order.id);
    const cashBefore = repo.bootstrap().cashSession!.expectedAmountMinor;
    const reportBefore = repo.getFinanceReport({ from: day, to: day });
    const input = {
      purchaseId: purchase.id,
      expectedRevision: 0,
      reason: "Compra duplicada",
      authorizerPin: "2468",
      idempotencyKey: "cancel-document",
    };
    const result = cancel(repo, input);
    assert.equal(result.cancelledAt != null, true);
    assert.equal(result.cancellationReason, input.reason);
    assert.equal(result.revision, 1);
    assert.equal(
      repo.getFinanceReport({ from: day, to: day }).purchasesMinor,
      reportBefore.purchasesMinor - purchase.totalMinor,
    );
    assert.deepEqual(
      db.prepare("SELECT id,stock_minor FROM products ORDER BY id").all(),
      stockBefore,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid",
        )
        .all(purchase.id),
      itemBefore,
    );
    const rawAfter = db
      .prepare("SELECT * FROM purchases WHERE id=?")
      .get(purchase.id) as any;
    for (const key of Object.keys(purchaseBefore))
      if (
        key !== "revision" &&
        key !== "cancelled_at" &&
        key !== "cancellation_reason"
      )
        assert.deepEqual(rawAfter[key], purchaseBefore[key]);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM finance_order_item_costs WHERE order_id=?")
        .all(order.id),
      cogsBefore,
    );
    assert.equal(repo.bootstrap().cashSession!.expectedAmountMinor, cashBefore);
    // Manual references continue to outrank purchases; after removing manual, a cancelled receipt is not reused.
    assert.equal(
      repo.getFinanceProductCosts().find((r) => r.productId === products[0]!.id)
        ?.unitCostMinor,
      7000,
    );
    repo.setFinanceProductCost({
      productId: products[0]!.id,
      unitCostMinor: null,
    });
    assert.notEqual(
      repo.getFinanceProductCosts().find((r) => r.productId === products[0]!.id)
        ?.unitCostMinor,
      10001,
    );
    assert.throws(
      () =>
        (repo as any).correctPurchaseItemCost({
          purchaseId: purchase.id,
          purchaseItemId: purchase.items[0]!.id,
          expectedRevision: 1,
          unitCostMinor: 9000,
          reason: "after cancel",
          authorizerPin: "2468",
          idempotencyKey: "cost-after-cancel",
        }),
      /anulada/i,
    );
  }));

test("product correction composes quantity/cost ledgers and changes only valid future product reference", () =>
  fixture((repo, db) => {
    const { products, purchase } = setup(repo);
    const item = purchase.items[0]!;
    (repo as any).correctPurchaseItemCost({
      purchaseId: purchase.id,
      purchaseItemId: item.id,
      expectedRevision: 0,
      unitCostMinor: 12000,
      reason: "Costo",
      authorizerPin: "2468",
      idempotencyKey: "cost-before-product",
    });
    (repo as any).correctPurchaseItemQuantity({
      purchaseId: purchase.id,
      purchaseItemId: item.id,
      expectedRevision: 1,
      quantityMinor: 2500,
      reason: "Cantidad",
      authorizerPin: "2468",
      idempotencyKey: "quantity-before-product",
    });
    const stockBefore = db
      .prepare("SELECT id,stock_minor FROM products ORDER BY id")
      .all();
    const replacement = products[2]!;
    const corrected = correctProduct(repo, {
      purchaseId: purchase.id,
      purchaseItemId: item.id,
      expectedRevision: 2,
      productId: replacement.id,
      reason: "Producto mal asignado",
      authorizerPin: "2468",
      idempotencyKey: "product-reassignment",
    });
    assert.equal(corrected.revision, 3);
    assert.deepEqual(corrected.items[0], {
      ...corrected.items[0],
      productId: item.productId,
      productName: item.productName,
      effectiveProductId: replacement.id,
      effectiveProductName: replacement.name,
      effectiveUnitCostMinor: 12000,
      effectiveQuantityMinor: 2500,
      effectiveLineTotalMinor: 30000,
    });
    assert.deepEqual(
      db.prepare("SELECT id,stock_minor FROM products ORDER BY id").all(),
      stockBefore,
    );
    const ledger = db
      .prepare(
        "SELECT * FROM purchase_item_product_corrections WHERE purchase_item_id=?",
      )
      .get(item.id) as any;
    assert.deepEqual(
      [
        ledger.previous_product_id,
        ledger.corrected_product_id,
        ledger.purchase_revision,
      ],
      [item.productId, replacement.id, 3],
    );
    assert.equal(
      repo.getFinanceProductCosts().find((r) => r.productId === replacement.id)
        ?.unitCostMinor,
      12000,
    );
    // An explicit later valid purchase remains the reference after this correction.
    const later = repo.createPurchase({
      supplierName: "Compra posterior",
      items: [
        {
          productId: replacement.id,
          quantityMinor: 1000,
          unitCostMinor: 32100,
        },
      ],
      authorizerPin: "2468",
      idempotencyKey: "valid-later",
    });
    assert.ok(later.createdAt >= purchase.createdAt);
    assert.equal(
      repo.getFinanceProductCosts().find((r) => r.productId === replacement.id)
        ?.unitCostMinor,
      32100,
    );
  }));

test("purchase document actions enforce permissions before replay, PIN/reason/revision/no-op, and idempotency", () =>
  fixture((repo, db) => {
    const { products, purchase } = setup(repo);
    const base = {
      purchaseId: purchase.id,
      expectedRevision: 0,
      reason: "Duplicada",
      authorizerPin: "2468",
      idempotencyKey: "cancel-key",
    };
    const first = cancel(repo, base);
    assert.deepEqual(cancel(repo, base), first);
    assert.throws(
      () => cancel(repo, { ...base, reason: "different" }),
      /idempotencia|datos diferentes/i,
    );
    assert.throws(
      () =>
        correctProduct(repo, {
          purchaseId: purchase.id,
          purchaseItemId: purchase.items[0]!.id,
          expectedRevision: 1,
          productId: products[1]!.id,
          reason: "after cancel",
          authorizerPin: "2468",
          idempotencyKey: "after-cancel",
        }),
      /anulada/i,
    );
    const another = repo.createPurchase({
      supplierName: "Otra",
      items: [
        { productId: products[0]!.id, quantityMinor: 1000, unitCostMinor: 5 },
      ],
      authorizerPin: "2468",
    });
    const productInput = {
      purchaseId: another.id,
      purchaseItemId: another.items[0]!.id,
      expectedRevision: 0,
      productId: products[0]!.id,
      reason: "no op",
      authorizerPin: "2468",
      idempotencyKey: "no-op",
    };
    assert.throws(
      () => correctProduct(repo, productInput),
      /vigente|distinto/i,
    );
    for (const patch of [
      { reason: " " },
      { reason: "x".repeat(501) },
      { authorizerPin: "bad" },
      { expectedRevision: 2 },
    ])
      assert.throws(() =>
        cancel(repo, {
          ...base,
          ...patch,
          idempotencyKey: `invalid-${Object.keys(patch)[0]}`,
        }),
      );
    const originalReceipts = db
      .prepare("SELECT * FROM command_receipts ORDER BY rowid")
      .all();
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND permission_code IN ('*','purchases.manage')",
    ).run(repo.bootstrap().currentUser.id);
    assert.throws(() => cancel(repo, base), /permiso/i);
    assert.throws(
      () => cancel(repo, { ...base, idempotencyKey: "denied-new" }),
      /permiso/i,
    );
    assert.ok(originalReceipts.length > 0);
  }));

test("transaction rollback and immutable document ledgers protect cancellation and product correction", () =>
  fixture((repo, db) => {
    const { products, purchase } = setup(repo);
    db.exec(
      `CREATE TRIGGER fail_purchase_audit BEFORE INSERT ON audit_log WHEN NEW.action IN ('PURCHASE_CANCELLED','PURCHASE_ITEM_PRODUCT_CORRECTED') BEGIN SELECT RAISE(ABORT,'forced audit failure'); END`,
    );
    const beforeCancel = purchaseSnapshot(db, purchase.id);
    assert.throws(
      () =>
        cancel(repo, {
          purchaseId: purchase.id,
          expectedRevision: 0,
          reason: "Rollback",
          authorizerPin: "2468",
          idempotencyKey: "rollback-cancel",
        }),
      /forced audit failure/i,
    );
    assert.deepEqual(purchaseSnapshot(db, purchase.id), beforeCancel);
    assert.throws(
      () =>
        correctProduct(repo, {
          purchaseId: purchase.id,
          purchaseItemId: purchase.items[0]!.id,
          expectedRevision: 0,
          productId: products[2]!.id,
          reason: "Rollback",
          authorizerPin: "2468",
          idempotencyKey: "rollback-product",
        }),
      /forced audit failure/i,
    );
    assert.deepEqual(purchaseSnapshot(db, purchase.id), beforeCancel);
    db.exec("DROP TRIGGER fail_purchase_audit");
    const cancelled = cancel(repo, {
      purchaseId: purchase.id,
      expectedRevision: 0,
      reason: "OK",
      authorizerPin: "2468",
      idempotencyKey: "cancel-success",
    });
    assert.equal(cancelled.revision, 1);
    assert.throws(
      () => db.prepare("UPDATE purchase_cancellations SET reason='x'").run(),
      /immutable|inmutable/i,
    );
    assert.throws(
      () => db.prepare("DELETE FROM purchase_cancellations").run(),
      /immutable|inmutable/i,
    );
    assert.throws(
      () =>
        cancel(repo, {
          purchaseId: purchase.id,
          expectedRevision: 1,
          reason: "Again",
          authorizerPin: "2468",
          idempotencyKey: "cancel-again",
        }),
      /anulada/i,
    );
  }));

test("migration 39 upgrades a v38 database without changing purchase snapshots", () =>
  fixture((repo, db, _dir, path) => {
    const { purchase } = setup(repo);
    const purchaseRaw = removeNewNullablePurchaseColumns(
      db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id) as any,
    );
    const itemsRaw = db
      .prepare(
        "SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid",
      )
      .all(purchase.id);
    // Rewind both later migrations so this is genuinely schema v38, including no combo columns.
    rewindPurchaseTestSchema(db, 38);
    assert.equal(
      (db
        .prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version=38")
        .get() as any) &&
        (
          db
            .prepare(
              "SELECT COUNT(*) n FROM schema_migrations WHERE version=38",
            )
            .get() as any
        ).n,
      1,
    );
    const upgraded = new SqliteGastronomyRepository(path, {
      adminPin: "2468",
      seedStarterCatalog: true,
    });
    try {
      const upgradedDb = new Database(path);
      try {
        assert.deepEqual(
          removeNewNullablePurchaseColumns(
            upgradedDb
              .prepare("SELECT * FROM purchases WHERE id=?")
              .get(purchase.id) as any,
          ),
          purchaseRaw,
        );
        assert.deepEqual(
          upgradedDb
            .prepare(
              "SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid",
            )
            .all(purchase.id),
          itemsRaw,
        );
        assert.equal(
          (
            upgradedDb
              .prepare("SELECT MAX(version) version FROM schema_migrations")
              .get() as any
          ).version,
          Math.max(...migrations.map((m) => m.version)),
        );
        const projected = upgraded
          .listPurchases()
          .find((p) => p.id === purchase.id)!;
        assert.equal(projected.cancelledAt, null);
        assert.equal(projected.cancellationReason, null);
      } finally {
        upgradedDb.close();
      }
    } finally {
      upgraded.close();
    }
  }));
