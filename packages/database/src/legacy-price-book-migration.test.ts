import { configuredTestRepository } from "./configured-test-repository";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { rewindPurchaseTestSchema } from "./purchase-migration-test-helper";
import { SqliteGastronomyRepository } from "./sqlite-repository";

const options = { adminPin: "2468", seedStarterCatalog: true };
const auth = { reason: "Prueba de catálogo", authorizerPin: "2468" };
for (const [retire, delivery] of [
  [11501, 11501],
  [11501, 12999],
] as const) {
  test(`actualiza v47 conservando todos los importes (${retire} / ${delivery}) y un pedido cobrado`, () => {
    const folder = mkdtempSync(join(tmpdir(), "gastronomy-v47-prices-"));
    const path = join(folder, "test.sqlite");
    let repo = configuredTestRepository(path, options);
    try {
      const productId = "starter-muzza-grande";
      const amounts = () =>
        repo.db
          .prepare(
            `SELECT pp.product_id, pl.code, pp.amount_minor
        FROM product_prices pp JOIN price_lists pl ON pl.id=pp.price_list_id ORDER BY 1,2`,
          )
          .all();
      rewindPurchaseTestSchema(repo.db, 47);
      for (const [channel, price] of Object.entries({
        SALON: 10000,
        TAKEAWAY: retire,
        DELIVERY: delivery,
      }))
        repo.db
          .prepare(
            "UPDATE product_prices SET amount_minor=? WHERE product_id=? AND price_list_id=(SELECT id FROM price_lists WHERE code=?)",
          )
          .run(price, productId, channel);
      const snapshot = amounts();
      repo.close();
      repo = configuredTestRepository(path, options);
      assert.deepEqual(amounts(), snapshot);
      const { assignments, books } = repo.getPriceBooks();
      assert.equal(assignments.SALON, books.find((b) => b.isBase)!.id);
      assert.equal(
        assignments.TAKEAWAY === assignments.DELIVERY,
        retire === delivery,
      );
      const product = repo
        .bootstrap()
        .products.find((p) => p.id === productId)!;
      assert.equal(
        product.priceBook!.overrides[assignments.DELIVERY],
        delivery,
      );
      repo.openCashSession({ openingAmountMinor: 0 });
      const order = repo.createOrder({
        type: "TAKEAWAY",
        customerName: "Prueba",
        customerPhone: "11 1234-5678",
      });
      repo.addOrderItem({ orderId: order.id, productId });
      repo.confirmOrder({ orderId: order.id });
      const paid = repo.payOrder({
        orderId: order.id,
        payments: [{ methodCode: "CASH", amountMinor: retire }],
      });
      const newBooks = repo.savePriceBook({
        ...auth,
        name: "Nueva tarifa",
        adjustmentBps: 1000,
      });
      assert.throws(
        () =>
          repo.assignPriceBooks({
            ...auth,
            authorizerPin: "0000",
            assignments,
          }),
        /PIN/i,
      );
      repo.assignPriceBooks({
        ...auth,
        assignments: {
          ...assignments,
          TAKEAWAY: newBooks.books.find((b) => b.name === "Nueva tarifa")!.id,
        },
      });
      assert.equal(repo.getOrder(order.id).totalMinor, paid.totalMinor);
      repo.setWebPublication({ productId, enabled: true });
      const published = repo
        .getWebCommerceCatalogSnapshot()
        .products.find((p) => p.productRef === productId)!;
      assert.equal(published.takeawayPriceMinor, 11000);
      assert.equal(published.deliveryPriceMinor, delivery);
      const next = repo.createOrder({
        type: "TAKEAWAY",
        customerName: "Otro",
        customerPhone: "11 1234-5678",
      });
      assert.equal(
        repo.addOrderItem({ orderId: next.id, productId }).items[0]
          ?.unitPriceMinorSnapshot,
        11000,
      );
    } finally {
      repo.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
}

for (const mode of ["missing-takeaway", "three-equal"] as const) {
  test(`migrates v47 ${mode} as Principal + Delivery with exact fixed legacy prices`, () => {
    const folder = mkdtempSync(join(tmpdir(), `gastronomy-v47-${mode}-`));
    const path = join(folder, "profile.sqlite");
    let repo = configuredTestRepository(path, options);
    try {
      const products = repo.bootstrap().products;
      const zero = products[0]!;
      const equal = products[1]!;
      const different = products[2]!;
      // Create a paid order against the pre-upgrade profile while all legacy prices are valid.
      repo.openCashSession({ openingAmountMinor: 0 });
      const historical = repo.createOrder({ type: "TAKEAWAY", customerName: "Histórico", customerPhone: "11 1234-5678" });
      repo.addOrderItem({ orderId: historical.id, productId: zero.id });
      const confirmed = repo.confirmOrder({ orderId: historical.id });
      const paid = repo.payOrder({ orderId: historical.id, payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor }] });
      const setPrice = repo.db.prepare(`UPDATE product_prices SET amount_minor=?
        WHERE product_id=? AND price_list_id=(SELECT id FROM price_lists WHERE code=?)`);
      const deletePrice = repo.db.prepare(`DELETE FROM product_prices
        WHERE product_id=? AND price_list_id=(SELECT id FROM price_lists WHERE code=?)`);
      // Normalize all seeded products so this disposable profile models only old channel data.
      for (const product of products) {
        const base = product.prices.find((p) => p.priceListCode === "SALON")!.amountMinor;
        setPrice.run(base, product.id, "SALON");
        setPrice.run(base, product.id, "DELIVERY");
        if (mode === "missing-takeaway") deletePrice.run(product.id, "TAKEAWAY");
        else setPrice.run(base, product.id, "TAKEAWAY");
      }
      const zeroBase = zero.prices.find((p) => p.priceListCode === "SALON")!.amountMinor;
      const equalBase = equal.prices.find((p) => p.priceListCode === "SALON")!.amountMinor;
      const differentBase = different.prices.find((p) => p.priceListCode === "SALON")!.amountMinor;
      setPrice.run(0, zero.id, "DELIVERY");
      setPrice.run(equalBase, equal.id, "DELIVERY");
      setPrice.run(differentBase + 321, different.id, "DELIVERY");
      if (mode === "three-equal") {
        setPrice.run(0, zero.id, "TAKEAWAY");
        setPrice.run(equalBase, equal.id, "TAKEAWAY");
        setPrice.run(differentBase + 321, different.id, "TAKEAWAY");
      }

      rewindPurchaseTestSchema(repo.db, 47);
      const prices = () => repo.db.prepare(`SELECT pp.product_id,pl.code,pp.amount_minor FROM product_prices pp
        JOIN price_lists pl ON pl.id=pp.price_list_id WHERE pl.code IN ('SALON','DELIVERY') ORDER BY pp.product_id,pl.code`).all();
      const legacySnapshot = prices();
      repo.close();
      repo = configuredTestRepository(path, options);
      assert.deepEqual(prices(), legacySnapshot);
      assert.equal(repo.getOrder(historical.id).totalMinor, paid.totalMinor);

      const catalog = repo.getPriceBooks();
      assert.deepEqual(catalog.books.map((book) => book.name).sort(), ["Delivery", "Principal"]);
      assert.equal(catalog.assignments.TAKEAWAY, catalog.assignments.DELIVERY);
      const deliveryId = catalog.assignments.DELIVERY;
      const afterMigration = repo.bootstrap().products;
      for (const [productId, expected] of [[zero.id, 0], [equal.id, equalBase], [different.id, differentBase + 321]] as const) {
        const dto = afterMigration.find((product) => product.id === productId)!;
        assert.equal(dto.priceBook!.overrides[deliveryId], expected);
        assert.equal(dto.prices.find((price) => price.priceListCode === "DELIVERY")!.amountMinor, expected);
        assert.equal(dto.prices.find((price) => price.priceListCode === "TAKEAWAY")!.amountMinor, expected);
      }

      // A zero override and an override equal to Salon must both remain fixed after principal changes.
      for (const [productId, fixed] of [[zero.id, 0], [equal.id, equalBase]] as const) {
        const dto = repo.bootstrap().products.find((product) => product.id === productId)!;
        repo.updateProduct({
          productId, categoryId: dto.categoryId, name: dto.name, active: dto.active, prices: [],
          priceBook: { baseMinor: dto.priceBook!.baseMinor + 777, overrides: dto.priceBook!.overrides },
          reason: "Editar precio principal", authorizerPin: "2468",
        });
        const changed = repo.bootstrap().products.find((product) => product.id === productId)!;
        assert.equal(changed.prices.find((price) => price.priceListCode === "DELIVERY")!.amountMinor, fixed);
        assert.equal(changed.prices.find((price) => price.priceListCode === "TAKEAWAY")!.amountMinor, fixed);
      }

      repo.savePriceBook({ ...auth, name: "Lista futura", adjustmentBps: 425 });
      const savedBooks = repo.getPriceBooks();
      const savedPrices = prices();
      repo.close();
      repo = configuredTestRepository(path, options);
      assert.deepEqual(repo.getPriceBooks(), savedBooks);
      assert.deepEqual(prices(), savedPrices);
      assert.equal(repo.getOrder(historical.id).totalMinor, paid.totalMinor);
    } finally {
      repo.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
}

test("v47 keeps a genuine separate Retiro where its legacy price differs from Delivery", () => {
  const folder = mkdtempSync(join(tmpdir(), "gastronomy-v47-separate-retire-"));
  const path = join(folder, "profile.sqlite");
  let repo = configuredTestRepository(path, options);
  try {
    const products = repo.bootstrap().products;
    const setPrice = repo.db.prepare(`UPDATE product_prices SET amount_minor=?
      WHERE product_id=? AND price_list_id=(SELECT id FROM price_lists WHERE code=?)`);
    for (const product of products) {
      const base = product.prices.find((p) => p.priceListCode === "SALON")!.amountMinor;
      setPrice.run(base, product.id, "SALON");
      setPrice.run(base + 111, product.id, "TAKEAWAY");
      setPrice.run(base + 222, product.id, "DELIVERY");
    }
    const expected = new Map(products.map((product) => [product.id, product.prices.find((p) => p.priceListCode === "SALON")!.amountMinor]));
    rewindPurchaseTestSchema(repo.db, 47);
    repo.close();
    repo = configuredTestRepository(path, options);
    const { books, assignments } = repo.getPriceBooks();
    assert.deepEqual(books.map((book) => book.name).sort(), ["Delivery", "Principal", "Retiro"]);
    assert.notEqual(assignments.TAKEAWAY, assignments.DELIVERY);
    for (const product of repo.bootstrap().products) {
      const base = expected.get(product.id)!;
      assert.equal(product.prices.find((price) => price.priceListCode === "TAKEAWAY")!.amountMinor, base + 111);
      assert.equal(product.prices.find((price) => price.priceListCode === "DELIVERY")!.amountMinor, base + 222);
    }
  } finally {
    repo.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("si la verificación detecta un cambio de precio, revierte la conversión completa y permite reintentar", () => {
  const folder = mkdtempSync(join(tmpdir(), "gastronomy-legacy-price-rollback-"));
  const path = join(folder, "profile.sqlite");
  try {
    const original = configuredTestRepository(path, options);
    try {
      rewindPurchaseTestSchema(original.db, 47);
      original.db.exec(`DELETE FROM product_prices WHERE price_list_id='price-takeaway';
        CREATE TRIGGER simulate_wrong_price AFTER INSERT ON product_prices WHEN NEW.price_list_id='price-takeaway'
        BEGIN UPDATE product_prices SET amount_minor=NEW.amount_minor+1
          WHERE product_id=NEW.product_id AND price_list_id=NEW.price_list_id; END;`);
    } finally { original.close(); }
    assert.throws(() => new SqliteGastronomyRepository(path, options), /conservar todos los precios/);
    const db = new Database(path);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) FROM price_book_assignments").pluck().get(), 0);
      assert.equal(db.prepare("SELECT COUNT(*) FROM product_prices WHERE price_list_id='price-takeaway'").pluck().get(), 0);
      db.exec("DROP TRIGGER simulate_wrong_price");
    } finally { db.close(); }
    const recovered = configuredTestRepository(path, options);
    try {
      const { assignments } = recovered.getPriceBooks();
      assert.notEqual(assignments.SALON, assignments.DELIVERY);
      assert.equal(assignments.TAKEAWAY, assignments.DELIVERY);
    } finally { recovered.close(); }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("replaying v7 historical channel migration does not overwrite explicit Delivery cents", () => {
  const folder = mkdtempSync(join(tmpdir(), "gastronomy-v7-channel-replay-"));
  const path = join(folder, "profile.sqlite");
  let repo = configuredTestRepository(path, options);
  try {
    const productId = "starter-muzza-grande";
    const setPrice = repo.db.prepare(`UPDATE product_prices SET amount_minor=?
      WHERE product_id=? AND price_list_id=(SELECT id FROM price_lists WHERE code=?)`);
    setPrice.run(12345, productId, "SALON");
    setPrice.run(23456, productId, "TAKEAWAY");
    setPrice.run(34567, productId, "DELIVERY");
    repo.db.prepare("DELETE FROM schema_migrations WHERE version=7").run();
    repo.close();
    repo = configuredTestRepository(path, options);
    const product = repo.bootstrap().products.find((p) => p.id === productId)!;
    assert.equal(product.prices.find((price) => price.priceListCode === "SALON")!.amountMinor, 12345);
    assert.equal(product.prices.find((price) => price.priceListCode === "TAKEAWAY")!.amountMinor, 23456);
    assert.equal(product.prices.find((price) => price.priceListCode === "DELIVERY")!.amountMinor, 34567);
  } finally {
    repo.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("actualiza v48 agregando redondeo por defecto sin cambiar precios calculados ni fijos", () => {
  const folder = mkdtempSync(join(tmpdir(), "gastronomy-v48-prices-"));
  const path = join(folder, "test.sqlite");
  let repo = configuredTestRepository(path, options);
  try {
    const productId = "starter-muzza-grande";
    const base = repo.getPriceBooks().books.find((b) => b.isBase)!;
    const created = repo.savePriceBook({ ...auth, name: "Redondeo legado", adjustmentBps: 1250 });
    const book = created.books.find((b) => b.name === "Redondeo legado")!;
    const product = repo.bootstrap().products.find((p) => p.id === productId)!;
    repo.updateProduct({
      productId, categoryId: product.categoryId, name: product.name, active: true,
      prices: [], priceBook: { baseMinor: product.priceBook!.baseMinor, overrides: { [book.id]: 98765 } },
      reason: "Fijo para migración", authorizerPin: "2468",
    });
    repo.assignPriceBooks({
      ...auth,
      assignments: { SALON: base.id, TAKEAWAY: book.id, DELIVERY: base.id },
    });
    const before = () => repo.db.prepare(`SELECT pl.code,pp.amount_minor FROM product_prices pp
      JOIN price_lists pl ON pl.id=pp.price_list_id WHERE pp.product_id=? ORDER BY pl.code`).all(productId);
    const snapshot = before();
    rewindPurchaseTestSchema(repo.db, 48);
    repo.close();
    repo = configuredTestRepository(path, options);
    assert.deepEqual(before(), snapshot);
    assert.equal(repo.getPriceBooks().books.find((b) => b.id === book.id)!.roundingIncrementMinor, 1);
    assert.equal(repo.bootstrap().products.find((p) => p.id === productId)!.priceBook!.overrides[book.id], 98765);
  } finally {
    repo.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
