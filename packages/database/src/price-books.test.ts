import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function withRepo(
  run: (repo: SqliteGastronomyRepository, path: string) => void,
) {
  const path = join(tmpdir(), `price-books-${randomUUID()}.sqlite`);
  const repo = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    run(repo, path);
  } finally {
    repo.close();
    for (const ext of ["", "-wal", "-shm"]) rmSync(path + ext, { force: true });
  }
}

test("migrates legacy prices without changing cents and survives reopening", () =>
  withRepo((repo, path) => {
    const p = repo
      .bootstrap()
      .products.find((x) => x.id === "starter-muzza-grande")!;
    const baseId = repo.getPriceBooks().books.find((x) => x.isBase)!.id;
    assert.throws(
      () =>
        repo.updateProduct({
          productId: p.id,
          categoryId: p.categoryId,
          name: p.name,
          active: true,
          prices: [],
          priceBook: {
            baseMinor: p.priceBook!.baseMinor,
            overrides: { [baseId]: 123 },
          },
          reason: "No override base",
          authorizerPin: "2468",
        }),
      /precio propio|lista inválida/i,
    );
    const legacy = Object.fromEntries(
      p.prices.map((x) => [x.priceListCode, x.amountMinor]),
    );
    repo.close();
    const reopened = new SqliteGastronomyRepository(path, {
      adminPin: "2468",
      seedStarterCatalog: true,
    });
    try {
      const next = reopened.bootstrap().products.find((x) => x.id === p.id)!;
      assert.equal(next.priceBook?.baseMinor, legacy.SALON);
      assert.deepEqual(
        Object.fromEntries(
          next.prices.map((x) => [x.priceListCode, x.amountMinor]),
        ),
        legacy,
      );
      assert.equal(
        reopened.getPriceBooks().assignments.SALON,
        "price-book-base",
      );
    } finally {
      reopened.close();
    }
  }));

test("derived adjustment and fixed override materialize to legacy prices and charge snapshot", () =>
  withRepo((repo) => {
    const base = repo.getPriceBooks().books.find((x) => x.isBase)!;
    const created = repo.savePriceBook({
      name: "Promo",
      adjustmentBps: 1250,
      reason: "Prueba",
      authorizerPin: "2468",
    });
    const derived = created.books.find((x) => x.name === "Promo")!;
    repo.assignPriceBooks({
      assignments: {
        SALON: base.id,
        TAKEAWAY: derived.id,
        DELIVERY: derived.id,
      },
      reason: "Prueba",
      authorizerPin: "2468",
    });
    const product = repo
      .bootstrap()
      .products.find((x) => x.id === "starter-muzza-grande")!;
    const expected = Math.floor(
      (product.priceBook!.baseMinor * 11250 + 5000) / 10000,
    );
    assert.equal(
      product.prices.find((x) => x.priceListCode === "TAKEAWAY")?.amountMinor,
      expected,
    );
    const fixed = expected + 60000;
    const updated = repo.updateProduct({
      productId: product.id,
      categoryId: product.categoryId,
      name: product.name,
      active: true,
      prices: [],
      priceBook: {
        baseMinor: product.priceBook!.baseMinor,
        overrides: { [derived.id]: fixed },
      },
      reason: "Precio fijo",
      authorizerPin: "2468",
    });
    assert.equal(
      updated.prices.find((x) => x.priceListCode === "TAKEAWAY")?.amountMinor,
      fixed,
    );
    repo.openCashSession({ openingAmountMinor: 0 });
    const draft = repo.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente",
      customerPhone: "11 1234-5678",
    });
    const order = repo.addOrderItem({
      orderId: draft.id,
      productId: product.id,
    });
    assert.equal(order.items[0]?.unitPriceMinorSnapshot, fixed);
    const confirmed = repo.confirmOrder({ orderId: draft.id });
    const paid = repo.payOrder({
      orderId: draft.id,
      payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor }],
    });
    assert.equal(paid.paymentStatus, "PAID");
  }));

test("invalid assignment rolls back and bulk adjustment persists a fixed effective price", () =>
  withRepo((repo) => {
    const p = repo
      .bootstrap()
      .products.find((x) => x.id === "starter-muzza-grande")!;
    const books = repo.getPriceBooks();
    assert.throws(() =>
      repo.assignPriceBooks({
        assignments: { ...books.assignments, DELIVERY: "missing" },
        reason: "Inválido",
        authorizerPin: "2468",
      }),
    );
    assert.deepEqual(repo.getPriceBooks().assignments, books.assignments);
    const derived = repo
      .savePriceBook({
        name: "Retiro +",
        adjustmentBps: 500,
        reason: "Nueva",
        authorizerPin: "2468",
      })
      .books.find((x) => x.name === "Retiro +")!;
    assert.throws(
      () =>
        repo.savePriceBook({
          name: "retiro +",
          adjustmentBps: 500,
          reason: "Duplicada",
          authorizerPin: "2468",
        }),
      /nombre/i,
    );
    const result = repo.bulkUpdateProducts({
      productIds: [p.id],
      priceAdjustment: {
        mode: "FIXED",
        value: 2500,
        bookIds: [derived.id],
        priceListCodes: [],
      },
      reason: "Ajuste",
      authorizerPin: "2468",
    });
    const base = p.priceBook!.baseMinor;
    const current = Math.floor((base * 10500 + 5000) / 10000);
    assert.equal(result[0]?.priceBook?.overrides[derived.id], current + 2500);
  }));

test("validates safe derived prices even when a book is not assigned", () =>
  withRepo((repo) => {
    repo.savePriceBook({
      name: "Límite",
      adjustmentBps: 100000,
      reason: "Límite",
      authorizerPin: "2468",
    });
    const category = repo.bootstrap().categories[0]!;
    assert.throws(
      () =>
        repo.createProduct({
          categoryId: category.id,
          name: "Fuera de rango",
          prices: [],
          priceBook: { baseMinor: Number.MAX_SAFE_INTEGER, overrides: {} },
        }),
      /demasiado alto|precio calculado/i,
    );
    assert.throws(
      () =>
        repo.createProduct({
          categoryId: category.id,
          name: "Override base",
          prices: [],
          priceBook: { baseMinor: 100, overrides: { "price-book-base": 99 } },
        }),
      /precio propio|lista inválida/i,
    );
  }));

test("legacy update reconciles model and rematerializes, invalid percentages reject", () =>
  withRepo((repo) => {
    const p = repo
      .bootstrap()
      .products.find((x) => x.id === "starter-muzza-grande")!;
    const adjusted = repo.updateProduct({
      productId: p.id,
      categoryId: p.categoryId,
      name: p.name,
      active: true,
      prices: [
        { priceListCode: "SALON", amountMinor: 10000 },
        { priceListCode: "TAKEAWAY", amountMinor: 9000 },
        { priceListCode: "DELIVERY", amountMinor: 9000 },
      ],
      reason: "Legacy writer",
      authorizerPin: "2468",
    });
    assert.equal(adjusted.priceBook?.baseMinor, 10000);
    assert.equal(
      adjusted.prices.find((x) => x.priceListCode === "DELIVERY")?.amountMinor,
      9000,
    );
    assert.throws(() =>
      repo.savePriceBook({
        name: "Inválida",
        adjustmentBps: 100001,
        reason: "Prueba",
        authorizerPin: "2468",
      }),
    );
    assert.throws(() =>
      repo.savePriceBook({
        name: "Sin motivo",
        adjustmentBps: 0,
        reason: " ",
        authorizerPin: "2468",
      }),
    );
  }));

test("save and assign price books require the operator permission as well as PIN", () =>
  withRepo((repo) => {
    const internal = repo as unknown as {
      db: {
        prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
      };
    };
    internal.db
      .prepare(
        "DELETE FROM role_permissions WHERE role_id='role-admin' AND permission_code='prices.bulk_update'",
      )
      .run();
    assert.throws(
      () =>
        repo.savePriceBook({
          name: "Sin permiso",
          adjustmentBps: 100,
          reason: "Prueba",
          authorizerPin: "2468",
        }),
      /permiso/i,
    );
    assert.throws(
      () =>
        repo.assignPriceBooks({
          assignments: repo.getPriceBooks().assignments,
          reason: "Prueba",
          authorizerPin: "2468",
        }),
      /permiso/i,
    );
  }));
