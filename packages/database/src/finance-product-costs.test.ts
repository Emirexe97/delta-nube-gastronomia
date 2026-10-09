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
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-cost-read-"));
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
    assert.ok(basename(dir).startsWith("gastronomy-cost-read-"));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("lectura de costos incluye inactivos, cero y compras sin materializar gastos", () =>
  fixture((repo, db) => {
    const products = repo.bootstrap().products;
    const manual = products[0]!;
    const purchase = products[1]!;
    repo.setFinanceProductCost({ productId: manual.id, unitCostMinor: 0 });
    repo.createPurchase({
      supplierName: "Prueba costos",
      authorizerPin: "2468",
      items: [
        { productId: purchase.id, quantityMinor: 1000, unitCostMinor: 45000 },
      ],
    });
    db.prepare("UPDATE products SET active = 0 WHERE id = ?").run(manual.id);
    repo.createFinanceRecurring({
      title: "No materializar al filtrar",
      category: "Local",
      kind: "FIXED",
      amountMinor: 10000,
      dayOfMonth: 1,
      startMonth: "2026-01",
    });
    const before = db
      .prepare("SELECT COUNT(*) AS n FROM finance_expenses")
      .get();
    const costs = repo.getFinanceProductCosts();
    assert.equal(costs.length, products.length);
    assert.deepEqual(
      costs.find((item) => item.productId === manual.id),
      {
        productId: manual.id,
        productName: manual.name,
        unitCostMinor: 0,
        source: "MANUAL",
      },
    );
    assert.equal(
      costs.find((item) => item.productId === purchase.id)?.source,
      "PURCHASE",
    );
    assert.equal(
      costs.find((item) => item.productId === purchase.id)?.unitCostMinor,
      45000,
    );
    assert.ok(
      costs.some(
        (item) => item.unitCostMinor === null && item.source === "UNKNOWN",
      ),
    );
    assert.deepEqual(
      db.prepare("SELECT COUNT(*) AS n FROM finance_expenses").get(),
      before,
    );
    assert.deepEqual(repo.getFinanceProductCosts(), costs);
    assert.deepEqual(
      db.prepare("SELECT COUNT(*) AS n FROM finance_expenses").get(),
      before,
    );
  }));

test("costos de catálogo conservan finance.view y no amplían permisos", () =>
  fixture((repo, db) => {
    db.prepare(
      "DELETE FROM role_permissions WHERE role_id = (SELECT role_id FROM users WHERE id = ?) AND permission_code IN ('*', 'finance.view')",
    ).run(repo.bootstrap().currentUser.id);
    assert.throws(() => repo.getFinanceProductCosts(), /permiso/i);
    assert.ok(repo.bootstrap().products.length > 0);
  }));
