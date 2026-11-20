import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configuredTestRepository } from "./configured-test-repository";

function withRepository(
  run: (repository: ReturnType<typeof configuredTestRepository>) => void,
) {
  const path = join(tmpdir(), `waiter-paged-menu-${randomUUID()}.sqlite`);
  const repository = configuredTestRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    run(repository);
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
}

function pair(repository: ReturnType<typeof configuredTestRepository>) {
  repository.openCashSession({ openingAmountMinor: 0 });
  const waiter = repository.createUser({
    fullName: "Mozo página",
    roleCode: "WAITER",
    pin: "1357",
    authorizerPin: "2468",
  });
  return repository.pairWaiterSession({
    challengeId: repository.createWaiterChallenge(waiter.id).challengeId,
    pin: "1357",
  }).sessionToken;
}

test("paged waiter menu exposes bounded metadata, stable pages, and legacy full state", () => {
  withRepository((repository) => {
    const token = pair(repository);
    const category = repository.db
      .prepare(
        "SELECT id FROM categories WHERE active=1 ORDER BY sort_order LIMIT 1",
      )
      .get() as { id: string };
    for (let i = 0; i < 3000; i += 500)
      repository.importProducts({
        idempotencyKey: randomUUID(),
        rows: Array.from({ length: 500 }, (_, j) => ({
          categoryId: category.id,
          name: `Producto página ${i + j}`,
          code: `MENU-${i + j}`,
          basePriceMinor: 100 + i + j,
        })),
      });

    const metadata = repository.getWaiterSessionState(token, true);
    assert.equal(metadata.menu.products.length, 0);
    const expectedCount =
      repository.getWaiterSessionState(token).menu.products.length;
    assert.ok(expectedCount >= 3000);
    assert.equal(metadata.menu.productCount, expectedCount);
    assert.ok(metadata.menu.version);
    const legacy = repository.getWaiterSessionState(token);
    assert.equal(legacy.menu.products.length, metadata.menu.productCount);
    const first = repository.getWaiterMenuPage(token, {
      version: metadata.menu.version,
      offset: 0,
    });
    assert.ok(first.products.length > 0);
    assert.equal(first.nextOffset, first.products.length);
    assert.ok(Buffer.byteLength(JSON.stringify(first)) < 512 * 1024);

    const seen = new Set<string>();
    let offset = 0;
    const version = first.version;
    for (;;) {
      const page = repository.getWaiterMenuPage(token, { offset, version });
      assert.equal(page.version, version);
      assert.ok(
        Buffer.byteLength(JSON.stringify({ result: page })) < 512 * 1024,
      );
      for (const product of page.products) seen.add(product.id);
      if (page.nextOffset == null) break;
      offset = page.nextOffset;
    }
    assert.deepEqual(
      [...seen],
      legacy.menu.products.map((p) => p.id),
    );
    assert.equal(seen.size, expectedCount);
    const lastId = [...seen].at(-1)!;
    const table = repository.ensureTable(91);
    const receipt = repository.submitWaiterBatch(token, {
      requestId: randomUUID(),
      tableId: table.id,
      printMode: "NONE",
      submittedAt: new Date().toISOString(),
      lines: [{ lineId: randomUUID(), productId: lastId, quantity: 1 }],
    });
    assert.ok(receipt.orderId);
    assert.equal(
      repository.getOrder(receipt.orderId).items[0]!.productId,
      lastId,
    );

    repository.db
      .prepare(
        "UPDATE product_prices SET amount_minor=amount_minor+1, updated_at=? WHERE product_id=?",
      )
      .run(new Date().toISOString(), [...seen][0]);
    const changed = repository.getWaiterMenuPage(token, { version, offset: 0 });
    assert.notEqual(changed.version, version);
    assert.deepEqual(changed.products, []);
  });
});

test("revoked waiter token and missing open shift invalidate menu reads", () => {
  withRepository((repository) => {
    const token = pair(repository);
    const version = repository.getWaiterSessionState(token, true).menu.version!;
    repository.revokeWaiterSession(token);
    assert.throws(
      () => repository.getWaiterMenuPage(token, { offset: 0, version }),
      /revocada/,
    );
  });
  withRepository((repository) => {
    const token = pair(repository);
    const version = repository.getWaiterSessionState(token, true).menu.version!;
    repository.closeCashSession({ countedAmountMinor: 0 });
    assert.throws(() =>
      repository.getWaiterMenuPage(token, { offset: 0, version }),
    );
  });
});
