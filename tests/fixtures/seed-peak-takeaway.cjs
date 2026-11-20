// Disposable real-SQLite peak fixture. Creates all 400 orders via repositories;
// only the synthetic catalog is bulk inserted for test speed.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const root = process.cwd();
const file = path.join(path.resolve(process.argv[2]), "gastronomy.sqlite");
assert.equal(path.dirname(path.dirname(file)), fs.realpathSync(os.tmpdir()));
assert.equal(
  fs.existsSync(file),
  false,
  "Run the fixture in a fresh temporary profile.",
);
const req = createRequire(path.resolve(root, "packages/database/package.json"));
req("tsx/cjs");
const { configuredTestRepository } = req("./src/configured-test-repository.ts");
const repo = configuredTestRepository(file, {
  seedStarterCatalog: true,
  adminPin: "748259",
});
const labels = (i) => "Retiro QA " + String(i).padStart(3, "0");
try {
  repo.saveTutorialProgress({
    version: 1,
    status: "SKIPPED",
    stepId: "welcome",
  });
  const settings = repo.getSettings();
  repo.saveSettings({
    ...settings,
    stockEnabled: true,
    modules: { ...settings.modules, advancedStatuses: false, delivery: false },
  });
  repo.openCashSession({ openingAmountMinor: 100000 });
  // Ensure every seeded order can reserve its three real catalog products.
  const db = new (req("better-sqlite3-multiple-ciphers"))(file);
  try {
    db.prepare(
      "UPDATE categories SET stock_control_enabled=1 WHERE id=(SELECT category_id FROM products WHERE id='starter-gaseosa')",
    ).run();
    db.prepare(
      "UPDATE products SET stock_minor=1000000000 WHERE id IN ('starter-gaseosa','starter-napo-grande','starter-muzza-grande')",
    ).run();
    db.prepare(
      "UPDATE products SET code='GAS15' WHERE id='starter-gaseosa'",
    ).run();
    assert.equal(
      db
        .prepare(
          "SELECT stock_control_enabled FROM categories WHERE id=(SELECT category_id FROM products WHERE id='starter-gaseosa')",
        )
        .get().stock_control_enabled,
      1,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT code,stock_minor,parent_product_id FROM products WHERE id='starter-gaseosa'",
        )
        .get(),
      { code: "GAS15", stock_minor: 1000000000, parent_product_id: null },
    );
  } finally {
    db.close();
  }
  for (let i = 0; i < 400; i++) {
    const order = repo.createOrder({
      type: "TAKEAWAY",
      customerName: labels(i),
      customerPhone: "1155550000",
    });
    for (const productId of [
      "starter-gaseosa",
      "starter-napo-grande",
      "starter-muzza-grande",
    ])
      repo.addOrderItem({ orderId: order.id, productId });
    const confirmed = repo.confirmOrder({ orderId: order.id });
    if (i === 0) {
      repo.payOrder({
        orderId: order.id,
        payments: [
          {
            methodCode: "CASH",
            amountMinor: confirmed.totalMinor,
            receivedMinor: confirmed.totalMinor,
          },
        ],
      });
    }
    // 000 stays confirmed/paid awaiting pickup. 001 remains unpaid for the
    // collect-and-deliver flow. The final half is handed over and paid.
    if (i >= 200) {
      repo.completeOrder({
        orderId: order.id,
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
    db.prepare("SELECT COUNT(*) n FROM orders WHERE type='TAKEAWAY'").get().n,
    400,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.type='TAKEAWAY'",
      )
      .get().n,
    1200,
  );
  const labels = db
    .prepare(
      "SELECT customer_name_snapshot FROM orders WHERE type='TAKEAWAY' ORDER BY created_at,id",
    )
    .all()
    .map((x) => x.customer_name_snapshot);
  assert.equal(labels.length, 400);
  assert.ok(labels.includes("Retiro QA 000"));
  assert.ok(labels.includes("Retiro QA 399"));
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM orders WHERE type='TAKEAWAY' AND lifecycle_status='CONFIRMED' AND payment_status='PAID'",
      )
      .get().n,
    201,
  );
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM orders WHERE customer_name_snapshot='Retiro QA 001' AND lifecycle_status='CONFIRMED' AND payment_status='UNPAID'",
      )
      .get(),
  );
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM orders WHERE customer_name_snapshot='Retiro QA 003' AND lifecycle_status='CONFIRMED' AND payment_status='UNPAID'",
      )
      .get(),
  );
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM orders WHERE customer_name_snapshot='Retiro QA 000' AND lifecycle_status='CONFIRMED' AND operational_status NOT IN ('DELIVERED','CANCELLED') AND payment_status='PAID' AND EXISTS (SELECT 1 FROM payments p JOIN payment_methods m ON m.id=p.payment_method_id WHERE p.order_id=orders.id AND m.code='CASH')",
      )
      .get(),
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM orders WHERE type='TAKEAWAY' AND operational_status='DELIVERED'",
      )
      .get().n,
    200,
  );
  assert.equal(
    db
      .prepare(
        "SELECT stock_minor FROM products WHERE id='starter-gaseosa' AND code='GAS15'",
      )
      .get().stock_minor,
    1000000000 - 400 * 1000,
  );
} finally {
  db.close();
}
