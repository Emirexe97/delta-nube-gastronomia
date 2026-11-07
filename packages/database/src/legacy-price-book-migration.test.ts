import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    let repo = new SqliteGastronomyRepository(path, options);
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
      repo = new SqliteGastronomyRepository(path, options);
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
