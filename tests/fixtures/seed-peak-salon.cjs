// Run with Electron's Node ABI, before launching the UI. Never seed a live POS.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const dir = fs.realpathSync(process.argv[2]);
assert.equal(path.dirname(dir), fs.realpathSync(os.tmpdir()));
assert.deepEqual(
  fs.readdirSync(dir),
  [],
  "Expected an empty disposable profile",
);
const file = path.join(dir, "gastronomy.sqlite");
const fromDatabase = createRequire(
  path.resolve(__dirname, "../../packages/database/package.json"),
);
fromDatabase("tsx/cjs");
const { configuredTestRepository } = fromDatabase(
  "./src/configured-test-repository.ts",
);
const pin = "748259";
const repo = configuredTestRepository(file, {
  seedStarterCatalog: true,
  adminPin: pin,
});
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
    printing: {
      ...settings.printing,
      kitchen: {
        ...settings.printing.kitchen,
        mode: "SYSTEM_DIRECT",
        deviceName: "QA salon",
        copies: 1,
      },
    },
  });
  const waiters = [701, 702].map((staffNumber, i) =>
    repo.createUser({
      staffNumber,
      fullName: "Mozo QA " + staffNumber,
      roleCode: "WAITER",
      pin: ["628914", "638497"][i],
      authorizerPin: pin,
    }),
  );
  repo.openCashSession({ openingAmountMinor: 10000 });
  for (let n = 1; n <= 120; ++n) {
    const table = repo.ensureTable(n);
    const order = repo.createOrder({
      type: "DINE_IN",
      tableId: table.id,
      waiterUserId: waiters[n % 2].id,
    });
    for (const productId of [
      "starter-gaseosa",
      "starter-muzza-grande",
      "starter-napo-grande",
    ])
      repo.addOrderItem({ orderId: order.id, productId });
    repo.confirmOrder({ orderId: order.id });
  }
  repo.ensureTable(121);
  repo.ensureTable(122);
  repo.saveSettings({ ...repo.getSettings(), stockEnabled: true });
} finally {
  repo.close();
}

// Bulk seed only the synthetic catalog. Actual sales, kitchen and stock writes
// under test go through the same transactions as in production.
const db = new (fromDatabase("better-sqlite3-multiple-ciphers"))(file);
try {
  db.transaction(() => {
    const missing =
      3000 - db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
    const add =
      db.prepare(`INSERT INTO products(id,category_id,name,code,sort_order,active,stock_minor,created_at,updated_at)
      SELECT ?,category_id,?,?,1000,1,8000,created_at,updated_at FROM products WHERE id='starter-gaseosa'`);
    const prices =
      db.prepare(`INSERT INTO product_prices(product_id,price_list_id,amount_minor,updated_at)
      SELECT ?,price_list_id,amount_minor,updated_at FROM product_prices WHERE product_id='starter-gaseosa'`);
    for (let i = 0; i < missing; ++i) {
      const id = "qa" + i;
      add.run(id, "QA producto " + i, id);
      prices.run(id);
    }
    assert.equal(
      db.prepare("SELECT stock_minor FROM products WHERE id='qa2100'").get()
        .stock_minor,
      8000,
    );
  })();
} finally {
  db.close();
}
