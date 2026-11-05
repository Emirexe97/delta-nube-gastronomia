import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { WebOrderRecord } from "@gastronomy/contracts";
import { SqliteGastronomyRepository } from "./sqlite-repository";

const record = (
  id: string,
  sequence: number,
  receivedAt: string | null = null,
): WebOrderRecord => ({
  id,
  reference: `WEB-${sequence}`,
  storeId: "store-1",
  siteId: "site-1",
  sequence,
  createdAt: "2026-11-04T10:00:00.000Z",
  receivedAt,
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNVERIFIED",
  quotedTotalMinor: 1500,
  submission: {
    schemaVersion: 1,
    currency: "ARS",
    customer: { name: "Cliente", phone: "1123456789" },
    fulfillment: { type: "TAKEAWAY" },
    items: [
      {
        productRef: "starter-gaseosa",
        name: "Gaseosa",
        quantity: 1,
        unitPriceMinor: 1500,
      },
    ],
    deliveryFeeMinor: 0,
    paymentMethod: "CASH",
  },
});

test("web publication is independent from active and durable inbox preserves originals and cursor", () => {
  const path = join(tmpdir(), `web-commerce-${randomUUID()}.sqlite`);
  let repo = new SqliteGastronomyRepository(path, { seedStarterCatalog: true });
  try {
    const product = "starter-gaseosa";
    assert.equal(
      repo.bootstrap().products.find((row) => row.id === product)?.webPublished,
      false,
    );
    repo.setWebPublication({ productId: product, enabled: true });
    assert.ok(
      repo
        .getWebCommerceCatalogSnapshot()
        .products.some((row) => row.productRef === product),
    );
    repo.db.prepare("UPDATE products SET active=0 WHERE id=?").run(product);
    assert.ok(
      !repo
        .getWebCommerceCatalogSnapshot()
        .products.some((row) => row.productRef === product),
    );
    repo.db.prepare("UPDATE products SET active=1 WHERE id=?").run(product);

    const incoming = record(randomUUID(), 1);
    repo.ingestWebOrder("store-1", incoming);
    assert.equal(repo.getWebOrderCursor("store-1"), 1);
    assert.deepEqual(repo.listWebPendingAcks("store-1"), [incoming.id]);
    const initial = repo.listWebOrders("store-1")[0]!;
    assert.equal(initial.original.id, incoming.id);
    assert.equal(initial.draft.items[0]?.productRef, "starter-gaseosa");
    repo.saveWebOrderDraft("store-1", {
      id: incoming.id,
      revision: 1,
      draft: { ...initial.draft, notes: "cambiar" },
    });
    repo.ingestWebOrder("store-1", {
      ...incoming,
      submission: {
        ...incoming.submission,
        customer: { name: "alterado", phone: "1123456789" },
      },
    });
    assert.equal(
      repo.listWebOrders("store-1")[0]?.original.submission.customer.name,
      "Cliente",
    );
    assert.equal(repo.listWebOrders("store-1")[0]?.draft.notes, "cambiar");
    repo.markWebOrderAcked("store-1", incoming.id);
    assert.deepEqual(repo.listWebPendingAcks("store-1"), []);

    const alreadyAcknowledged = record(
      randomUUID(),
      2,
      "2026-11-04T10:01:00.000Z",
    );
    repo.ingestWebOrder("store-1", alreadyAcknowledged);
    assert.equal(repo.getWebOrderCursor("store-1"), 2);
    assert.equal(
      repo
        .listWebOrders("store-1")
        .find((row) => row.original.id === alreadyAcknowledged.id)?.status,
      "REVIEW_RESTORE",
    );
    assert.throws(() =>
      repo.confirmWebOrder("store-1", {
        id: alreadyAcknowledged.id,
        revision: 1,
        expectedTotalMinor: 1500,
      }),
    );
    repo.close();
    repo = new SqliteGastronomyRepository(path);
    assert.equal(
      repo
        .listWebOrders("store-1")
        .find((row) => row.original.id === incoming.id)?.draft.notes,
      "cambiar",
    );
  } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});

test("web order draft refuses unresolved option selection and never creates payment", () => {
  const path = join(tmpdir(), `web-commerce-confirm-${randomUUID()}.sqlite`);
  const repo = new SqliteGastronomyRepository(path, {
    seedStarterCatalog: true,
  });
  try {
    repo.openCashSession({ openingAmountMinor: 0 });
    const incoming = {
      ...record(randomUUID(), 1),
      submission: {
        ...record("x", 1).submission,
        items: [
          {
            productRef: "starter-gaseosa",
            name: "Gaseosa",
            quantity: 1,
            unitPriceMinor: 1500,
            options: [{ group: "Tamaño", name: "Grande" }],
          },
        ],
      },
    } as WebOrderRecord;
    repo.ingestWebOrder("store-1", incoming);
    const entry = repo.listWebOrders("store-1")[0]!;
    assert.equal(entry.draft.items[0]?.productRef, "");
    assert.throws(
      () =>
        repo.confirmWebOrder("store-1", {
          id: incoming.id,
          revision: entry.revision,
          expectedTotalMinor: 1500,
        }),
      /opciones/i,
    );
    assert.equal(
      (
        repo.db.prepare("SELECT COUNT(*) AS n FROM orders").get() as {
          n: number;
        }
      ).n,
      0,
    );
    assert.equal(
      (
        repo.db.prepare("SELECT COUNT(*) AS n FROM payments").get() as {
          n: number;
        }
      ).n,
      0,
    );

    const plain = record(randomUUID(), 2);
    repo.ingestWebOrder("store-1", plain);
    const plainEntry = repo
      .listWebOrders("store-1")
      .find((row) => row.original.id === plain.id)!;
    const actualPrice = (
      repo.db
        .prepare(
          `SELECT pp.amount_minor AS n FROM product_prices pp JOIN price_lists pl ON pl.id=pp.price_list_id WHERE pp.product_id='starter-gaseosa' AND pl.code='TAKEAWAY'`,
        )
        .get() as { n: number }
    ).n;
    const result = repo.confirmWebOrder("store-1", {
      id: plain.id,
      revision: plainEntry.revision,
      expectedTotalMinor: actualPrice,
    });
    assert.equal(result.created, true);
    assert.equal(result.order.totalMinor, actualPrice);
    assert.equal(result.order.paymentStatus, "UNPAID");
    assert.equal(
      repo.confirmWebOrder("store-1", {
        id: plain.id,
        revision: plainEntry.revision,
        expectedTotalMinor: actualPrice,
      }).created,
      false,
    );
    assert.equal(
      (
        repo.db.prepare("SELECT COUNT(*) AS n FROM payments").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});
