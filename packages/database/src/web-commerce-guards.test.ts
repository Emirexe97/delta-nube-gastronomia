import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { WebOrderRecord } from "@gastronomy/contracts";
import { SqliteGastronomyRepository } from "./sqlite-repository";

const makeRecord = (
  id: string,
  sequence = 1,
  type: "TAKEAWAY" | "DELIVERY" = "TAKEAWAY",
): WebOrderRecord => ({
  id,
  reference: `WEB-${sequence}`,
  storeId: "store-qa",
  siteId: "bonis-web",
  sequence,
  createdAt: "2026-11-04T10:00:00.000Z",
  receivedAt: null,
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNVERIFIED",
  quotedTotalMinor: 450_000,
  submission: {
    schemaVersion: 1,
    currency: "ARS",
    customer: { name: "Cliente QA", phone: "1123456789" },
    fulfillment: {
      type,
      ...(type === "DELIVERY" ? { address: "Calle 123" } : {}),
    },
    items: [
      {
        productRef: "starter-gaseosa",
        name: "Gaseosa 1,5 L",
        quantity: 1,
        unitPriceMinor: 450_000,
      },
    ],
    deliveryFeeMinor: 0,
    paymentMethod: "CASH",
  },
});

function withRepository(
  run: (repo: SqliteGastronomyRepository) => void,
  seedStarterCatalog = true,
) {
  const path = join(tmpdir(), `web-commerce-guards-${randomUUID()}.sqlite`);
  const repo = new SqliteGastronomyRepository(path, { seedStarterCatalog });
  try {
    run(repo);
  } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
}

function count(repo: SqliteGastronomyRepository, table: string): number {
  assert.match(table, /^(orders|payments|cash_movements)$/);
  return Number(
    (
      repo.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      }
    ).n,
  );
}

test("price changed after review rejects stale quote atomically without order or cash side effects", () => {
  withRepository((repo) => {
    repo.openCashSession({ openingAmountMinor: 0 });
    const incoming = makeRecord(randomUUID());
    repo.ingestWebOrder("store-qa", incoming);
    const entry = repo.listWebOrders("store-qa")[0]!;
    const oldPrice = Number(
      (
        repo.db
          .prepare(
            "SELECT amount_minor AS n FROM product_prices WHERE product_id='starter-gaseosa' AND price_list_id='price-takeaway'",
          )
          .get() as { n: number }
      ).n,
    );
    assert.equal(oldPrice, 450_000);
    const before = {
      orders: count(repo, "orders"),
      payments: count(repo, "payments"),
      movements: count(repo, "cash_movements"),
    };
    repo.db
      .prepare(
        "UPDATE product_prices SET amount_minor=amount_minor+1 WHERE product_id='starter-gaseosa' AND price_list_id='price-takeaway'",
      )
      .run();
    assert.throws(
      () =>
        repo.confirmWebOrder("store-qa", {
          id: incoming.id,
          revision: entry.revision,
          expectedTotalMinor: oldPrice,
        }),
      /total cambió/i,
    );
    assert.deepEqual(
      {
        orders: count(repo, "orders"),
        payments: count(repo, "payments"),
        movements: count(repo, "cash_movements"),
      },
      before,
    );
    assert.equal(repo.listWebOrders("store-qa")[0]?.status, "PENDING");
  });
});

test("stale draft edits cannot confirm or reject and rejection never records payment", () => {
  withRepository((repo) => {
    repo.openCashSession({ openingAmountMinor: 0 });
    const incoming = makeRecord(randomUUID());
    repo.ingestWebOrder("store-qa", incoming);
    const entry = repo.listWebOrders("store-qa")[0]!;
    const edited = repo.saveWebOrderDraft("store-qa", {
      id: incoming.id,
      revision: entry.revision,
      draft: { ...entry.draft, notes: "actualizado" },
    });
    assert.equal(edited.revision, entry.revision + 1);
    assert.throws(
      () =>
        repo.confirmWebOrder("store-qa", {
          id: incoming.id,
          revision: entry.revision,
          expectedTotalMinor: 450_000,
        }),
      /cambió|procesado/i,
    );
    assert.throws(
      () =>
        repo.rejectWebOrder("store-qa", {
          id: incoming.id,
          revision: entry.revision,
          reason: "No disponible",
        }),
      /cambió|procesado/i,
    );
    const before = {
      orders: count(repo, "orders"),
      payments: count(repo, "payments"),
      movements: count(repo, "cash_movements"),
    };
    repo.rejectWebOrder("store-qa", {
      id: incoming.id,
      revision: edited.revision,
      reason: "No disponible",
    });
    assert.equal(repo.listWebOrders("store-qa")[0]?.status, "REJECTED");
    assert.deepEqual(
      {
        orders: count(repo, "orders"),
        payments: count(repo, "payments"),
        movements: count(repo, "cash_movements"),
      },
      before,
    );
  });
});

test("confirmation is guarded by an open cash session and rolls back the draft order", () => {
  withRepository((repo) => {
    const incoming = makeRecord(randomUUID());
    repo.ingestWebOrder("store-qa", incoming);
    const entry = repo.listWebOrders("store-qa")[0]!;
    assert.throws(
      () =>
        repo.confirmWebOrder("store-qa", {
          id: incoming.id,
          revision: entry.revision,
          expectedTotalMinor: 450_000,
        }),
      /caja|sesión|turno/i,
    );
    assert.equal(count(repo, "orders"), 0);
    assert.equal(count(repo, "payments"), 0);
    assert.equal(repo.listWebOrders("store-qa")[0]?.status, "PENDING");
  });
});

test("catalog exposes a published sellable variant with channel prices, excludes combos and private fields", () => {
  withRepository((repo) => {
    const timestamp = "2026-11-04T10:00:00.000Z";
    repo.db
      .prepare(
        `INSERT INTO products(id,category_id,name,code,parent_product_id,sort_order,active,created_at,updated_at,web_published)
      SELECT 'qa-gaseosa-variant',category_id,'Gaseosa variante','PRIVATE-SECRET-CODE-COST',id,1,1,?,?,0 FROM products WHERE id='starter-gaseosa'`,
      )
      .run(timestamp, timestamp);
    repo.db
      .prepare(
        "INSERT INTO product_prices(product_id,price_list_id,amount_minor,updated_at) VALUES ('qa-gaseosa-variant','price-takeaway',500000,?),('qa-gaseosa-variant','price-delivery',550000,?)",
      )
      .run(timestamp, timestamp);
    repo.setWebPublication({ productId: "qa-gaseosa-variant", enabled: true });
    repo.setWebPublication({ productId: "starter-gaseosa", enabled: true });
    repo.db
      .prepare(
        "UPDATE products SET combo_definition_json=? WHERE id='starter-napo-grande'",
      )
      .run(
        JSON.stringify({
          slots: [
            {
              id: "slot",
              name: "Elegir",
              quantity: 1,
              productIds: ["starter-muzza-grande"],
            },
          ],
        }),
      );
    repo.setWebPublication({ productId: "starter-napo-grande", enabled: true });

    let products = repo.getWebCommerceCatalogSnapshot().products;
    assert.ok(
      !products.some((product) => product.productRef === "starter-napo-grande"),
      "combo must not be projected",
    );
    assert.deepEqual(
      products.find((product) => product.productRef === "qa-gaseosa-variant"),
      {
        productRef: "qa-gaseosa-variant",
        name: "Gaseosa variante",
        category: "Bebidas",
        takeawayPriceMinor: 500_000,
        deliveryPriceMinor: 550_000,
      },
    );
    const publicJson = JSON.stringify(products);
    assert.ok(!publicJson.includes("PRIVATE-SECRET-CODE-COST"));
    for (const product of products)
      assert.deepEqual(
        Object.keys(product).sort(),
        [
          "category",
          "deliveryPriceMinor",
          "name",
          "productRef",
          "takeawayPriceMinor",
        ].sort(),
      );

    // Turning the publication flag off hides the item without deactivating its POS product.
    repo.setWebPublication({ productId: "starter-gaseosa", enabled: false });
    assert.equal(
      (
        repo.db
          .prepare("SELECT active FROM products WHERE id='starter-gaseosa'")
          .get() as { active: number }
      ).active,
      1,
    );
    products = repo.getWebCommerceCatalogSnapshot().products;
    assert.ok(
      !products.some((product) => product.productRef === "starter-gaseosa"),
    );
  });
});
