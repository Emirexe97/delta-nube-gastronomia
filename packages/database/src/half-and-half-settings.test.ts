import { configuredTestRepository } from "./configured-test-repository";
import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SqliteGastronomyRepository } from "./sqlite-repository";

test("catalog migration groups existing pizza formats and leaves prior order snapshots intact", () => {
  const path = join(tmpdir(), `half-and-half-migration-${randomUUID()}.sqlite`);
  let repo = configuredTestRepository(path, { seedStarterCatalog: true });
  try {
    repo.openCashSession({ openingAmountMinor: 0 });
    const order = repo.createOrder({ type: "TAKEAWAY", customerName: "Cliente", customerPhone: "1112345678" });
    const old = repo.addHalfAndHalfItem({
      orderId: order.id, firstProductId: "starter-muzza-grande", secondProductId: "starter-napo-grande",
      notes: "Sin aceitunas",
    }).items[0]!;
    repo.db.prepare("UPDATE order_items SET product_name_snapshot = ?, half_and_half_group_name_snapshot = NULL WHERE id = ?")
      .run("Pizza mitad Muzzarella grande / mitad Napolitana grande", old.id);
    const previous = repo.getOrder(order.id).items[0];
    repo.createProduct({
      categoryId: "category-1",
      name: "Muzzarella chica",
      prices: [{ priceListCode: "SALON", amountMinor: 900000 }],
    });
    repo.createProduct({
      categoryId: "category-1",
      name: "Calabresa",
      prices: [{ priceListCode: "SALON", amountMinor: 900000 }],
    });
    repo.db.exec(`
      ALTER TABLE categories DROP COLUMN half_and_half_groups_json;
      ALTER TABLE categories DROP COLUMN default_half_and_half_group_id;
      ALTER TABLE products DROP COLUMN half_and_half_group_override;
      ALTER TABLE order_items DROP COLUMN half_and_half_group_name_snapshot;
      DELETE FROM schema_migrations WHERE name = 'catalog_half_and_half_groups';
    `);
    repo.close();
    repo = configuredTestRepository(path, {});
    const catalog = repo.bootstrap();
    const first = catalog.products.find(({ id }) => id === "starter-muzza-grande")!;
    const second = catalog.products.find(({ id }) => id === "starter-napo-grande")!;
    assert.equal(first.halfAndHalf?.mode, "GROUP");
    assert.deepEqual(first.halfAndHalf, second.halfAndHalf);
    assert.notDeepEqual(first.halfAndHalf, catalog.products.find(({ name }) => name === "Muzzarella chica")?.halfAndHalf);
    assert.deepEqual(catalog.products.find(({ name }) => name === "Calabresa")?.halfAndHalf, { mode: "INHERIT" });
    assert.deepEqual(repo.getOrder(order.id).items[0], previous);
  } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});

test("half-and-half setting defaults and legacy-absent true, persists toggles, and blocks only new combinations", () => {
  const path = join(tmpdir(), `half-and-half-settings-${randomUUID()}.sqlite`);
  let repo = configuredTestRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    assert.equal(repo.bootstrap().settings.halfAndHalfEnabled, true);
    const legacy = { ...repo.bootstrap().settings } as Record<string, unknown>;
    delete legacy.halfAndHalfEnabled;
    repo.db
      .prepare("UPDATE settings SET value_json = ? WHERE key = 'app'")
      .run(JSON.stringify(legacy));
    assert.equal(repo.bootstrap().settings.halfAndHalfEnabled, true);

    repo.openCashSession({ openingAmountMinor: 0 });
    const order = repo.createOrder({
      type: "TAKEAWAY",
      customerName: "Prueba",
      customerPhone: "1112345678",
    });
    const retainedHalf = repo.addHalfAndHalfItem({
      orderId: order.id,
      firstProductId: "starter-muzza-grande",
      secondProductId: "starter-napo-grande",
    });
    const retained = retainedHalf.items[0]!;
    const settings = repo.bootstrap().settings;
    repo.saveSettings({ ...settings, halfAndHalfEnabled: false });
    assert.equal(repo.bootstrap().settings.halfAndHalfEnabled, false);

    const plainOrder = repo.addOrderItem({
      orderId: order.id,
      productId: "starter-gaseosa",
    });
    assert.equal(plainOrder.items.length, 2);
    const before = repo.getOrder(order.id);
    const auditBefore = (
      repo.db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?")
        .get(order.id) as { n: number }
    ).n;
    assert.throws(
      () =>
        repo.addHalfAndHalfItem({
          orderId: order.id,
          firstProductId: "starter-muzza-grande",
          secondProductId: "starter-napo-grande",
        }),
      /mitad y mitad.*deshabilitada/i,
    );
    assert.deepEqual(repo.getOrder(order.id), before);
    assert.equal(
      (
        repo.db
          .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?")
          .get(order.id) as { n: number }
      ).n,
      auditBefore,
    );
    assert.equal(
      repo.getOrder(order.id).items.find((item) => item.id === retained.id)
        ?.halves.length,
      2,
    );

    repo.saveSettings({
      ...repo.bootstrap().settings,
      halfAndHalfEnabled: true,
    });
    assert.equal(
      repo.addHalfAndHalfItem({
        orderId: order.id,
        firstProductId: "starter-muzza-grande",
        secondProductId: "starter-napo-grande",
      }).items.length,
      3,
    );
    repo.close();
    repo = configuredTestRepository(path, { adminPin: "2468" });
    assert.equal(repo.bootstrap().settings.halfAndHalfEnabled, true);
  } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});
