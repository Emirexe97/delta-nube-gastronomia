// Disposable real-SQLite peak fixture. Deliberately creates all 400 orders via
// repositories; only the synthetic catalog is bulk inserted for test speed.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const root = process.cwd();
const file = path.join(path.resolve(process.argv[2]), "gastronomy.sqlite");
assert.equal(path.dirname(path.dirname(file)), fs.realpathSync(os.tmpdir()));
const req = createRequire(path.resolve(root, "packages/database/package.json"));
req("tsx/cjs");
const { configuredTestRepository } = req("./src/configured-test-repository.ts");
const repo = configuredTestRepository(file, {
  seedStarterCatalog: true,
  adminPin: "748259",
});
const labels = (i) => "Peak delivery QA " + String(i).padStart(3, "0");
try {
  repo.saveTutorialProgress({
    version: 1,
    status: "SKIPPED",
    stepId: "welcome",
  });
  const settings = repo.getSettings();
  repo.saveSettings({
    ...settings,
    stockEnabled: false,
    modules: { ...settings.modules, advancedStatuses: true, delivery: true },
    deliverySettlementEnabled: true,
    deliveryFeeBelongsToDriver: true,
    deliveryDriverPaymentMode: "ACCUMULATED",
  });
  repo.openCashSession({ openingAmountMinor: 100000 });
  const drivers = Array.from(
    { length: 8 },
    (_, i) =>
      repo.createDriver({
        fullName: "Peak QA Chofer " + i,
        authorizerPin: "748259",
      }).id,
  );
  for (let i = 0; i < 400; i++) {
    const driverUserId = drivers[i % 8];
    const order = repo.createOrder({
      type: "DELIVERY",
      customerName: labels(i),
      customerPhone: "1155550000",
      deliveryAddress: "QA calle " + i,
      deliveryFeeMinor: 25000,
      driverUserId,
    });
    for (const productId of [
      "starter-gaseosa",
      "starter-napo-grande",
      "starter-muzza-grande",
    ])
      repo.addOrderItem({ orderId: order.id, productId });
    const confirmed = repo.confirmOrder({ orderId: order.id });
    if (i === 0) {
      repo.updateOrderStatus(order.id, "READY");
      repo.updateOrderStatus(order.id, "OUT_FOR_DELIVERY");
      repo.payOrder({
        orderId: order.id,
        driverUserId,
        collectedByDriver: false,
        payments: [
          {
            methodCode: "CASH",
            amountMinor: confirmed.totalMinor,
            receivedMinor: confirmed.totalMinor,
          },
        ],
      });
    }
    if (i === 1 || i === 2) {
      repo.updateOrderStatus(order.id, "READY");
      repo.updateOrderStatus(order.id, "OUT_FOR_DELIVERY");
    }
    if (i === 15) {
      // A reversed immediate fee payment leaves a real editable PENDING settlement.
      repo.payOrder({
        orderId: order.id,
        payDriverNow: true,
        payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor }],
      });
      const settled = repo.getDeliveryProjection({ orderId: order.id })
        .deliveryLedger[0];
      assert.equal(settled.status, "SETTLED");
      repo.reverseDeliverySettlement({
        ledgerId: settled.id,
        reason: "Diferir pago del reparto",
        authorizerPin: "748259",
      });
      assert.equal(
        repo.getDeliveryProjection({ orderId: order.id }).deliveryLedger[0]
          .status,
        "PENDING",
      );
    }
    if (i >= 3 && i !== 15 && i % 4 === 0) {
      repo.updateOrderStatus(order.id, "READY");
      repo.updateOrderStatus(order.id, "OUT_FOR_DELIVERY");
      repo.completeOrder({
        orderId: order.id,
        driverUserId,
        collectedByDriver: i % 8 === 0,
        finalStatus: "DELIVERED",
        payments: [
          {
            methodCode: "CASH",
            amountMinor: confirmed.totalMinor,
            receivedMinor: confirmed.totalMinor,
          },
        ],
      });
    }
  }
} finally {
  repo.close();
}
const Database = req("better-sqlite3-multiple-ciphers");
const db = new Database(file);
try {
  db.transaction(() => {
    const missing =
      3000 - db.prepare("SELECT COUNT(*) n FROM products").get().n;
    const add = db.prepare(
      "INSERT INTO products(id,category_id,name,code,sort_order,active,stock_minor,created_at,updated_at) SELECT ?,category_id,?,?,1000,1,8000,created_at,updated_at FROM products WHERE id='starter-gaseosa'",
    );
    const price = db.prepare(
      "INSERT INTO product_prices(product_id,price_list_id,amount_minor,updated_at) SELECT ?,price_list_id,amount_minor,updated_at FROM product_prices WHERE product_id='starter-gaseosa'",
    );
    for (let i = 0; i < missing; i++) {
      const id = "peakqa" + i;
      add.run(id, "Peak QA producto " + i, id);
      price.run(id);
    }
  })();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM products").get().n, 3000);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM orders WHERE type='DELIVERY'").get().n,
    400,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.type='DELIVERY'",
      )
      .get().n,
    1200,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='DELIVERY_DRIVER' AND u.active=1",
      )
      .get().n,
    8,
  );
} finally {
  db.close();
}
