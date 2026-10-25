import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function withRepository(
  run: (repository: SqliteGastronomyRepository, path: string) => void,
) {
  const path = join(tmpdir(), `gastronomy-kitchen-${randomUUID()}.sqlite`);
  let repository = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    run(repository, path);
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
}

function makeOrder(repository: SqliteGastronomyRepository) {
  const session = repository.openCashSession({ openingAmountMinor: 0 });
  const order = repository.createOrder({
    type: "TAKEAWAY",
    customerName: "Prueba",
    customerPhone: "11 4444-5555",
  });
  repository.addOrderItem({
    orderId: order.id,
    productId: "starter-muzza-grande",
    quantity: 1,
  });
  repository.confirmOrder({ orderId: order.id });
  return order.id;
}

test("captura tickets de cocina completos y agregados desde el último éxito", () => {
  withRepository((repository) => {
    const orderId = makeOrder(repository);
    const first = repository.queuePrint(orderId, "KITCHEN_ORDER");
    const firstTicket = repository.getPrintOrder(first.jobId);
    assert.equal(firstTicket.kitchenPrintScope, "FULL");
    assert.equal(firstTicket.items.length, 1);
    repository.markPrintJob(first.jobId, "PRINTED");
    const initialBaseline =
      repository.getOrder(orderId).kitchenPrintedQuantities;
    assert.equal(initialBaseline?.[firstTicket.items[0]!.id], 1);

    const originalItemId = firstTicket.items[0]!.id;
    repository.updateOrderItemQuantity({
      orderId,
      itemId: originalItemId,
      quantity: 3,
    });
    repository.addOrderItem({
      orderId,
      productId: "starter-napo-grande",
      quantity: 2,
    });
    const added = repository.queuePrint(orderId, "KITCHEN_ORDER", "ADDED");
    const addedTicket = repository.getPrintOrder(added.jobId);
    assert.equal(addedTicket.kitchenPrintScope, "ADDED");
    assert.deepEqual(
      addedTicket.items.map((item) => item.quantity),
      [2, 2],
    );
    assert.throws(
      () => repository.queuePrint(orderId, "KITCHEN_ORDER", "ADDED"),
      /en curso/,
    );
    repository.markPrintJob(added.jobId, "PRINTED");
    assert.throws(
      () => repository.queuePrint(orderId, "KITCHEN_ORDER", "ADDED"),
      /No hay productos/,
    );
  });
});

test("fallo y descarte no avanzan baseline; ticket queda fijo al editar y reintentar", () => {
  withRepository((repository) => {
    const orderId = makeOrder(repository);
    const initial = repository.queuePrint(orderId, "KITCHEN_ORDER");
    repository.markPrintJob(initial.jobId, "PRINTED");
    const before = repository.getOrder(orderId).kitchenPrintedQuantities;
    repository.updateOrderItemQuantity({
      orderId,
      itemId: repository.getOrder(orderId).items[0]!.id,
      quantity: 2,
    });
    const failed = repository.queuePrint(orderId, "KITCHEN_ORDER", "ADDED");
    const captured = repository.getPrintOrder(failed.jobId);
    repository.updateOrderItemQuantity({
      orderId,
      itemId: captured.items[0]!.id,
      quantity: 4,
    });
    assert.deepEqual(repository.getPrintOrder(failed.jobId), captured);
    repository.markPrintJob(failed.jobId, "FAILED", "sin papel");
    assert.deepEqual(
      repository.getOrder(orderId).kitchenPrintedQuantities,
      before,
    );
    repository.preparePrintRetry(failed.jobId);
    assert.deepEqual(repository.getPrintOrder(failed.jobId), captured);
    repository.markPrintJob(failed.jobId, "PRINTED");
    assert.equal(
      repository.getOrder(orderId).kitchenPrintedQuantities?.[
        captured.items[0]!.id
      ],
      2,
    );

    const queued = repository.queuePrint(orderId, "KITCHEN_ORDER");
    repository.discardPrintJob(queued.jobId);
    assert.deepEqual(
      repository.getOrder(orderId).kitchenPrintedQuantities?.[
        captured.items[0]!.id
      ],
      2,
    );
  });
});

test("baseline persiste al reabrir y un éxito legacy sin snapshot produce baseline desconocida", () => {
  withRepository((repository, path) => {
    const orderId = makeOrder(repository);
    const printed = repository.queuePrint(orderId, "KITCHEN_ORDER");
    repository.markPrintJob(printed.jobId, "PRINTED");
    const snapshot = repository.getOrder(orderId).kitchenPrintedQuantities;
    const reopened = new SqliteGastronomyRepository(path, {
      adminPin: "2468",
      seedStarterCatalog: true,
    });
    try {
      assert.deepEqual(
        reopened.getOrder(orderId).kitchenPrintedQuantities,
        snapshot,
      );
      reopened.db
        .prepare(
          "INSERT INTO print_jobs(id, order_id, kind, status, created_at, printed_at) VALUES (?, ?, 'KITCHEN_ORDER', 'PRINTED', ?, ?)",
        )
        .run(
          randomUUID(),
          orderId,
          new Date().toISOString(),
          new Date().toISOString(),
        );
      assert.equal(reopened.getOrder(orderId).kitchenPrintedQuantities, null);
      assert.throws(
        () => reopened.queuePrint(orderId, "KITCHEN_ORDER", "ADDED"),
        /completa/,
      );
    } finally {
      reopened.close();
    }
  });
});

test("el éxito fuera de orden conserva el baseline más reciente y la cuenta no lo modifica", () => {
  withRepository((repository) => {
    const orderId = makeOrder(repository);
    const baseline = repository.queuePrint(orderId, "KITCHEN_ORDER");
    repository.markPrintJob(baseline.jobId, "PRINTED");
    const earlier = repository.queuePrint(orderId, "KITCHEN_ORDER");
    repository.db
      .prepare("UPDATE print_jobs SET status = 'FAILED' WHERE id = ?")
      .run(earlier.jobId);
    repository.updateOrderItemQuantity({
      orderId,
      itemId: repository.getOrder(orderId).items[0]!.id,
      quantity: 2,
    });
    const later = repository.queuePrint(orderId, "KITCHEN_ORDER", "ADDED");
    repository.markPrintJob(later.jobId, "PRINTED");
    repository.preparePrintRetry(earlier.jobId);
    repository.markPrintJob(earlier.jobId, "PRINTED");
    const itemId = repository.getOrder(orderId).items[0]!.id;
    assert.equal(
      repository.getOrder(orderId).kitchenPrintedQuantities?.[itemId],
      2,
    );
    const bill = repository.queuePrint(orderId, "CUSTOMER_BILL");
    repository.markPrintJob(bill.jobId, "PRINTED");
    assert.equal(
      repository.getOrder(orderId).kitchenPrintedQuantities?.[itemId],
      2,
    );
    assert.throws(
      () => repository.queuePrint(orderId, "CUSTOMER_BILL", "ADDED"),
      /sólo admite/,
    );
  });
});
