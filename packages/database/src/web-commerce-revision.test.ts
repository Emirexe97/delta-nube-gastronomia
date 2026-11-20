import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";
import { rewindPurchaseTestSchema } from "./purchase-migration-test-helper";

function fixture(run: (repo: SqliteGastronomyRepository, path: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), "web-commerce-revision-"));
  const path = join(folder, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  try { run(repo, path); } finally { repo.close(); rmSync(folder, { recursive: true, force: true }); }
}

test("revision survives v47 rewind and migration reapplies without duplicate table", () => fixture((repo, path) => {
  rewindPurchaseTestSchema(repo.db, 47);
  repo.close();
  const reopened = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  try { assert.equal(typeof reopened.getWebCommerceCatalogRevision(), "number"); }
  finally { reopened.close(); }
}));

test("revision observes catalog writes made by a second SQLite connection", () => fixture((repo, path) => {
  repo.setWebPublication({ productId: "starter-muzza-grande", enabled: true });
  const before = repo.getWebCommerceCatalogRevision();
  const external = new Database(path);
  try { external.prepare("UPDATE products SET name=? WHERE id=?").run("Nombre externo", "starter-muzza-grande"); }
  finally { external.close(); }
  assert.equal(repo.getWebCommerceCatalogRevision(), before + 1);
}));

test("stock revision changes only when web availability threshold changes", () => fixture((repo) => {
  repo.setWebPublication({ productId: "starter-muzza-grande", enabled: true });
  repo.db.prepare("UPDATE categories SET stock_control_enabled=1 WHERE id=(SELECT category_id FROM products WHERE id=?)").run("starter-muzza-grande");
  const before = repo.getWebCommerceCatalogRevision();
  repo.db.prepare("UPDATE products SET stock_minor=2000 WHERE id=?").run("starter-muzza-grande");
  const initialized = repo.getWebCommerceCatalogRevision();
  assert.equal(initialized, before);
  repo.db.prepare("UPDATE products SET stock_minor=1500 WHERE id=?").run("starter-muzza-grande");
  assert.equal(repo.getWebCommerceCatalogRevision(), initialized);
  repo.db.prepare("UPDATE products SET stock_minor=999 WHERE id=?").run("starter-muzza-grande");
  assert.equal(repo.getWebCommerceCatalogRevision(), initialized + 1);
}));

test("unrelated order writes do not advance catalog revision", () => fixture((repo) => {
  const before = repo.getWebCommerceCatalogRevision();
  repo.openCashSession({ openingAmountMinor: 0 });
  repo.createOrder({ type: "TAKEAWAY", customerName: "Cliente", customerPhone: "11 1234 5678" });
  assert.equal(repo.getWebCommerceCatalogRevision(), before);
}));

test("irrelevant salon prices and settings do not advance revision", () => fixture((repo) => {
  repo.setWebPublication({ productId: "starter-muzza-grande", enabled: true });
  const before = repo.getWebCommerceCatalogRevision();
  repo.db.prepare("UPDATE product_prices SET amount_minor=amount_minor+1 WHERE product_id=? AND price_list_id=(SELECT id FROM price_lists WHERE code='SALON')").run("starter-muzza-grande");
  assert.equal(repo.getWebCommerceCatalogRevision(), before);
  const settings = repo.getSettings();
  repo.db.prepare("UPDATE settings SET value_json=? WHERE key='app'").run(JSON.stringify({ ...settings, businessName: "Otro nombre" }));
  assert.equal(repo.getWebCommerceCatalogRevision(), before);
}));

test("published web price changes commit or roll back together with their revision", () => fixture(repo => {
  const product = "starter-muzza-grande";
  repo.setWebPublication({ productId: product, enabled: true });
  const update = repo.db.prepare("UPDATE product_prices SET amount_minor=amount_minor+1 WHERE product_id=? AND price_list_id=(SELECT id FROM price_lists WHERE code='DELIVERY')");
  const before = repo.getWebCommerceCatalogRevision();
  const old = repo.getWebCommerceCatalogSnapshot();
  assert.throws(repo.db.transaction(() => {
    assert.equal(update.run(product).changes, 1);
    assert.ok(repo.getWebCommerceCatalogRevision() > before);
    throw Error("cancel sale");
  }), /cancel sale/);
  assert.equal(repo.getWebCommerceCatalogRevision(), before);
  assert.deepEqual(repo.getWebCommerceCatalogSnapshot(), old);
  update.run(product);
  assert.ok(repo.getWebCommerceCatalogRevision() > before);
  assert.notDeepEqual(repo.getWebCommerceCatalogSnapshot(), old);
}));

test("settings stockEnabled changes advance revision, including app replace", () => fixture((repo) => {
  const before = repo.getWebCommerceCatalogRevision();
  const settings = repo.getSettings();
  repo.db.prepare("UPDATE settings SET value_json=? WHERE key='app'").run(JSON.stringify({ ...settings, stockEnabled: !settings.stockEnabled }));
  assert.equal(repo.getWebCommerceCatalogRevision(), before + 1);
  const next = repo.getSettings();
  repo.db.prepare("INSERT OR REPLACE INTO settings(key,value_json,updated_at) VALUES ('app',?,?)").run(JSON.stringify({ ...next, stockEnabled: settings.stockEnabled }), new Date().toISOString());
  assert.equal(repo.getWebCommerceCatalogRevision(), before + 2);
}));
