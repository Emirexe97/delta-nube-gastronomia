// Run from the repo root with the workspace Electron in ELECTRON_RUN_AS_NODE=1
// mode: native SQLite must use Electron's ABI. Never opens an installed profile.
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
require(require.resolve("tsx/cjs", { paths: [path.join(root, "packages/database")] }));
const { configuredTestRepository } = require(path.join(root, "packages/database/src/configured-test-repository.ts"));
const { createWebCommerceSync } = require(path.join(root, "apps/desktop-shell/src/web-commerce-sync.ts"));

async function measure(fn) {
  for (let i = 0; i < 5; i++) await fn();
  const samples = [];
  for (let i = 0; i < 60; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return { p50: +samples[29].toFixed(3), p95: +samples[56].toFixed(3) };
}

async function run() {
  const repo = configuredTestRepository(":memory:", {});
  try {
    const base = repo.bootstrap();
    const categoryId = base.categories.find(c => c.active).id;
    for (let i = base.products.length; i < 3000; i += 500) {
      repo.importProducts({ idempotencyKey: randomUUID(),
        rows: Array.from({ length: Math.min(500, 3000 - i) }, (_, n) => ({
          name: "QA " + (i + n), code: "QA" + (i + n), categoryId, basePriceMinor: 12500,
        })) });
    }
    repo.db.prepare("UPDATE products SET web_published=1").run();
    const snapshot = repo.getWebCommerceCatalogSnapshot.bind(repo);
    const products = snapshot().products;
    assert.equal(products.length, 3000);
    const { productRef } = products[0];
    let snapshots = 0, polls = 0;
    const publications = [];
    repo.getWebCommerceCatalogSnapshot = () => { snapshots++; return snapshot(); };
    const sync = createWebCommerceSync({
      getRepository: () => repo,
      env: { GASTRONOMY_WEB_ORDERS_URL: "https://example.invalid", GASTRONOMY_WEB_ORDERS_TOKEN: "x".repeat(43), GASTRONOMY_WEB_ORDERS_STORE_ID: "qa" },
      makeClient: () => ({
        publishCatalog: async catalog => { publications.push(catalog.products.some(p => p.productRef === productRef)); },
        list: async after => { polls++; return { orders: [], nextCursor: after, hasMore: false }; },
      }),
    });
    const tick = async () => assert.equal((await sync.run()).state, "SYNCED");
    await tick();
    const idlePollMs = await measure(tick);
    assert.deepEqual({ snapshots, polls, publications }, { snapshots: 1, polls: 66, publications: [true] });
    const snapshotAndHashMs = await measure(() => createHash("sha256").update(JSON.stringify(snapshot())).digest("hex"));
    const revisionMs = await measure(() => repo.getWebCommerceCatalogRevision());
    const doubleBootstrapMs = await measure(() => { repo.bootstrap(); repo.bootstrap(); });
    const settingsMs = await measure(() => repo.getSettings());

    // Sell the last unit via the real order flow; no IPC hint/invalidate call.
    repo.saveSettings({ ...repo.getSettings(), stockEnabled: true });
    repo.db.prepare("UPDATE categories SET stock_control_enabled=1 WHERE id=(SELECT category_id FROM products WHERE id=?)").run(productRef);
    repo.adjustStock({ productId: productRef, newStockMinor: 1000, reason: "QA", authorizerPin: "2468" });
    repo.openCashSession({ openingAmountMinor: 0 });
    const order = repo.createOrder({ type: "TAKEAWAY", customerName: "QA", customerPhone: "1100000000" });
    repo.addOrderItem({ orderId: order.id, productId: productRef, quantity: 1 });
    await tick();
    assert.equal(publications.at(-1), true);
    repo.confirmOrder({ orderId: order.id });
    await tick();
    assert.equal(publications.at(-1), false);
    console.log(JSON.stringify({ publishedProducts: products.length, idlePolls: 65, additionalIdleSnapshots: 0,
      lastUnitRemoved: true, snapshotAndHashMs, revisionMs, idlePollMs, doubleBootstrapMs, settingsMs,
      cpu: require("node:os").cpus()[0].model, electron: process.versions.electron }, null, 2));
  } finally { repo.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
