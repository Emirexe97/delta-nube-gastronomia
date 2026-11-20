import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configuredTestRepository } from "./configured-test-repository";
import type { SqliteGastronomyRepository } from "./sqlite-repository";

function withRepository(run: (repository: SqliteGastronomyRepository) => void) {
  const path = join(tmpdir(), `gastronomy-cash-report-${randomUUID()}.sqlite`);
  const repository = configuredTestRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    run(repository);
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
}

test("cash session report hydrates >999 orders with bounded batched SQL", () => {
  withRepository((repository) => {
    const session = repository.openCashSession({ openingAmountMinor: 0 });
    for (let index = 0; index < 1005; index++) {
      const draft = repository.createOrder({
        type: "TAKEAWAY",
        customerName: `Cliente ${index}`,
        customerPhone: "11 4444-5555",
      });
      repository.addOrderItem({ orderId: draft.id, productId: "starter-muzza-grande" });
      repository.confirmOrder({ orderId: draft.id });
      repository.payOrder({
        orderId: draft.id,
        payments: [{ methodCode: "CASH", amountMinor: repository.getOrder(draft.id).totalMinor }],
      });
    }

    const db = (repository as unknown as { db: { prepare: (sql: string) => unknown } }).db;
    const originalPrepare = db.prepare.bind(db);
    let preparedStatements = 0;
    db.prepare = ((sql: string) => {
      preparedStatements++;
      return originalPrepare(sql);
    }) as typeof db.prepare;
    const originalGetOrder = repository.getOrder;
    (repository as unknown as { getOrder: typeof originalGetOrder }).getOrder = () => {
      throw new Error("getOrder must not be called while hydrating a report");
    };
    try {
      const report = repository.getCashSessionReport({ cashSessionId: session.id });
      assert.equal(report.totals.orderCount, 1005);
      assert.equal(report.orders.length, 1005);
    } finally {
      (repository as unknown as { getOrder: typeof originalGetOrder }).getOrder = originalGetOrder;
      db.prepare = originalPrepare;
    }

    // The report uses a fixed number of aggregate queries plus 400-ID batches;
    // it must not regress to one order/item query per row.
    assert.ok(preparedStatements < 60, `expected bounded report SQL, got ${preparedStatements}`);
  });
});
