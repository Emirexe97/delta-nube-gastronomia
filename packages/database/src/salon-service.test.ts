import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function withRepository(run: (repository: SqliteGastronomyRepository) => void) {
  const path = join(tmpdir(), `salon-service-${randomUUID()}.sqlite`);
  const repository = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try { run(repository); } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
}

function confirmedDine(repository: SqliteGastronomyRepository) {
  repository.openCashSession({ openingAmountMinor: 0 });
  const table = repository.ensureTable(91);
  const draft = repository.createOrder({ type: "DINE_IN", tableId: table.id });
  const withItem = repository.addOrderItem({ orderId: draft.id, productId: "starter-muzza-grande" });
  return repository.confirmOrder({ orderId: withItem.id });
}

const mark = (repository: SqliteGastronomyRepository, orderId: string, expectedServiceRevision: number, idempotencyKey: string) =>
  (repository as any).markOrderServed({ orderId, expectedServiceRevision, idempotencyKey });

test("DINE_IN consume starts a service clock, and served state only reopens for added/quantity-increased items", () => {
  withRepository((repository) => {
    const order = confirmedDine(repository);
    assert.ok(order.servicePendingSince);
    const pending = repository.getOrder(order.id);
    assert.ok(pending.servicePendingSince);
    assert.equal(pending.servedAt, null);
    assert.equal(pending.serviceRevision, 1);
    const served = mark(repository, order.id, 1, "served-1");
    assert.ok(served.servedAt);
    assert.equal(served.servicePendingSince, null);
    assert.equal(served.serviceRevision, 2);
    const item = served.items[0]!;
    const note = repository.updateOrderItemNotes({ orderId: order.id, itemId: item.id, notes: "sin sal" });
    assert.equal(note.servedAt, served.servedAt);
    assert.equal(note.serviceRevision, 2);
    const added = repository.addOrderItem({ orderId: order.id, productId: "starter-gaseosa" });
    assert.ok(added.servicePendingSince);
    assert.equal(added.servedAt, null);
    assert.equal(added.serviceRevision, 3);
  });
});

test("half-and-half and quantity increases reopen service; decreases, notes and price edits do not", () => {
  withRepository((repository) => {
    const order = confirmedDine(repository);
    const served = mark(repository, order.id, order.serviceRevision!, "served-items");
    const half = repository.addHalfAndHalfItem({
      orderId: order.id,
      firstProductId: "starter-muzza-grande",
      secondProductId: "starter-napo-grande",
    });
    assert.equal(half.serviceRevision, served.serviceRevision! + 1);
    assert.ok(half.servicePendingSince);
    let current = mark(repository, order.id, half.serviceRevision!, "served-half");
    const originalItem = current.items[0]!;
    current = repository.updateOrderItemQuantity({ orderId: order.id, itemId: originalItem.id, quantity: 2 });
    assert.ok(current.servicePendingSince);
    assert.equal(current.serviceRevision, half.serviceRevision! + 2);
    current = mark(repository, order.id, current.serviceRevision!, "served-quantity");
    const servedAt = current.servedAt;
    const decreased = repository.updateOrderItemQuantity({ orderId: order.id, itemId: originalItem.id, quantity: 1 });
    assert.equal(decreased.servicePendingSince, null);
    assert.equal(decreased.servedAt, servedAt);
    assert.equal(decreased.serviceRevision, current.serviceRevision);
  });
});

test("mark served uses CAS + idempotent receipt, rejects stale revisions and non-service orders", () => {
  withRepository((repository) => {
    const order = confirmedDine(repository);
    const served = mark(repository, order.id, 1, "served-replay");
    const replay = mark(repository, order.id, 1, "served-replay");
    assert.deepEqual(replay, served);
    assert.throws(() => mark(repository, order.id, 1, "stale-new-key"), /actualiz|revisi|serv/i);
    const takeaway = repository.createOrder({ type: "TAKEAWAY", customerName: "A", customerPhone: "11 1234-5678" });
    repository.addOrderItem({ orderId: takeaway.id, productId: "starter-muzza-grande" });
    repository.confirmOrder({ orderId: takeaway.id });
    assert.throws(() => mark(repository, takeaway.id, 0, "not-dine"), /salón|servicio|DINE/i);
    assert.equal((repository.db.prepare("SELECT COUNT(*) count FROM audit_log WHERE entity_id = ? AND action = 'ORDER_SERVED'").get(order.id) as { count: number }).count, 1);
    assert.equal((repository.db.prepare("SELECT COUNT(*) count FROM command_receipts WHERE operation = 'markOrderServed'").get() as { count: number }).count, 1);
  });
});

test("mark served requires orders.edit permission and transaction rollback preserves item and service state", () => {
  withRepository((repository) => {
    const denied = confirmedDine(repository);
    const roleId = (repository.db.prepare("SELECT role_id FROM users WHERE id = ?").get("user-admin") as { role_id: string }).role_id;
    repository.db.prepare("DELETE FROM role_permissions WHERE role_id = ? AND permission_code = 'orders.edit'").run(roleId);
    assert.throws(() => mark(repository, denied.id, denied.serviceRevision!, "permission-denied"), /permiso/i);
    assert.equal(repository.getOrder(denied.id).servicePendingSince, denied.servicePendingSince);
    repository.db.prepare("INSERT INTO role_permissions(role_id, permission_code) VALUES (?, 'orders.edit')").run(roleId);

    const baseline = repository.getOrder(denied.id);
    const insertedBefore = baseline.items.length;
    repository.db.exec(`CREATE TRIGGER fail_service_trigger_test BEFORE UPDATE OF service_pending_since ON orders
      BEGIN SELECT RAISE(ABORT, 'service rollback probe'); END`);
    assert.throws(() => repository.addOrderItem({ orderId: denied.id, productId: "starter-gaseosa" }), /service rollback probe/);
    repository.db.exec("DROP TRIGGER fail_service_trigger_test");
    const after = repository.getOrder(denied.id);
    assert.equal(after.items.length, insertedBefore);
    assert.equal(after.servicePendingSince, baseline.servicePendingSince);
    assert.equal(after.serviceRevision, baseline.serviceRevision);
  });
});

test("mark served remains available for partially and fully paid active DINE_IN orders without financial mutations", () => {
  withRepository((repository) => {
    const partialDraft = confirmedDine(repository);
    // Current payOrder rejects partial tender; model a persisted legacy partial payment without changing that workflow.
    const partialAmount = Math.max(1, Math.floor(partialDraft.totalMinor / 3));
    const sessionId = repository.bootstrap().cashSession!.id;
    repository.db.prepare("INSERT INTO payments(id, order_id, cash_session_id, payment_method_id, amount_minor, created_by_user_id, created_at) VALUES (?, ?, ?, 'payment-cash', ?, 'user-admin', ?)")
      .run(randomUUID(), partialDraft.id, sessionId, partialAmount, new Date().toISOString());
    repository.db.prepare("UPDATE orders SET paid_minor = ?, payment_status = 'PARTIALLY_PAID' WHERE id = ?").run(partialAmount, partialDraft.id);
    const partial = repository.getOrder(partialDraft.id);
    assert.equal(partial.paymentStatus, "PARTIALLY_PAID");
    const partialMovements = repository.db.prepare("SELECT COUNT(*) count FROM cash_movements WHERE order_id = ?").get(partial.id) as { count: number };
    const partialServed = mark(repository, partial.id, partial.serviceRevision!, "serve-partial-payment");
    assert.equal(partialServed.paymentStatus, partial.paymentStatus);
    assert.equal(partialServed.paidMinor, partial.paidMinor);
    assert.equal(partialServed.totalMinor, partial.totalMinor);
    assert.deepEqual(partialServed.payments, partial.payments);
    assert.equal((repository.db.prepare("SELECT COUNT(*) count FROM cash_movements WHERE order_id = ?").get(partial.id) as { count: number }).count, partialMovements.count);

    const table = repository.ensureTable(92);
    const draft = repository.createOrder({ type: "DINE_IN", tableId: table.id });
    const populated = repository.addOrderItem({ orderId: draft.id, productId: "starter-muzza-grande" });
    const confirmed = repository.confirmOrder({ orderId: populated.id });
    const paid = repository.payOrder({
      orderId: confirmed.id,
      payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor }],
    });
    assert.equal(paid.paymentStatus, "PAID");
    const fullMovements = (repository.db.prepare("SELECT COUNT(*) count FROM cash_movements WHERE order_id = ?").get(paid.id) as { count: number }).count;
    const served = mark(repository, paid.id, paid.serviceRevision!, "serve-full-payment");
    assert.equal(served.paymentStatus, paid.paymentStatus);
    assert.equal(served.paidMinor, paid.paidMinor);
    assert.equal(served.totalMinor, paid.totalMinor);
    assert.deepEqual(served.payments, paid.payments);
    assert.equal((repository.db.prepare("SELECT COUNT(*) count FROM cash_movements WHERE order_id = ?").get(paid.id) as { count: number }).count, fullMovements);
  });
});

test("service triggers are transactional, clear pending state after last-item deletion, and never touch money", () => {
  withRepository((repository) => {
    const order = confirmedDine(repository);
    const before = {
      total: order.totalMinor,
      paid: order.paidMinor,
      version: (repository.db.prepare("SELECT version FROM orders WHERE id = ?").get(order.id) as { version: number }).version,
    };
    const item = order.items[0]!;
    repository.db.prepare("DELETE FROM order_items WHERE id = ?").run(item.id);
    let cleared = repository.getOrder(order.id);
    assert.equal(cleared.servicePendingSince, null);
    assert.equal(cleared.servedAt, null);
    assert.equal(cleared.serviceRevision, 2);
    repository.db.prepare("INSERT INTO order_items(id,order_id,product_name_snapshot,quantity,unit_price_minor_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(randomUUID(), order.id, "Trigger item", 1, 100, new Date().toISOString(), new Date().toISOString());
    cleared = repository.getOrder(order.id);
    assert.ok(cleared.servicePendingSince);
    assert.equal(cleared.serviceRevision, 3);
    const fresh = repository.getOrder(order.id);
    assert.equal(fresh.totalMinor, before.total);
    assert.equal(fresh.paidMinor, before.paid);
    assert.equal((repository.db.prepare("SELECT version FROM orders WHERE id = ?").get(order.id) as { version: number }).version, before.version);
  });
});

test("legacy active DINE_IN rows migrate with createdAt pending timestamp and revision 1", () => {
  const path = join(tmpdir(), `salon-legacy-${randomUUID()}.sqlite`);
  let repository = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  try {
    const active = confirmedDine(repository);
    const tableFor = (number: number) => repository.ensureTable(number);
    const terminalDraft = repository.createOrder({ type: "DINE_IN", tableId: tableFor(92).id });
    repository.addOrderItem({ orderId: terminalDraft.id, productId: "starter-gaseosa" });
    repository.confirmOrder({ orderId: terminalDraft.id });
    repository.db.prepare("UPDATE orders SET operational_status = 'DELIVERED' WHERE id = ?").run(terminalDraft.id);

    const empty = repository.createOrder({ type: "DINE_IN", tableId: tableFor(93).id });
    // Legacy data can contain confirmed empty orders even though the current domain guard disallows creating one.
    repository.db.prepare("UPDATE orders SET lifecycle_status = 'CONFIRMED', operational_status = 'IN_PREPARATION' WHERE id = ?").run(empty.id);
    const draftWithItems = repository.createOrder({ type: "DINE_IN", tableId: tableFor(94).id });
    repository.addOrderItem({ orderId: draftWithItems.id, productId: "starter-muzza-grande" });
    const takeaway = repository.createOrder({ type: "TAKEAWAY", customerName: "A", customerPhone: "11 1234-5678" });
    repository.addOrderItem({ orderId: takeaway.id, productId: "starter-muzza-grande" });
    repository.confirmOrder({ orderId: takeaway.id });

    const historical = repository.getOrder(active.id);
    const itemCount = historical.items.length;
    const total = historical.totalMinor;
    const createdAt = historical.createdAt;
    const unrelatedOrderIds = [terminalDraft.id, empty.id, draftWithItems.id, takeaway.id];
    repository.db.exec(`DROP TRIGGER orders_service_confirmed_items;
      DROP TRIGGER order_items_service_insert;
      DROP TRIGGER order_items_service_quantity_increase;
      DROP TRIGGER order_items_service_delete_last;
      ALTER TABLE orders DROP COLUMN service_pending_since;
      ALTER TABLE orders DROP COLUMN served_at;
      ALTER TABLE orders DROP COLUMN service_revision;`);
    repository.db.prepare("DELETE FROM schema_migrations WHERE version = 38").run();
    repository.close();
    repository = new SqliteGastronomyRepository(path, { adminPin: "2468" });

    const migrated = repository.getOrder(active.id);
    assert.equal(migrated.servicePendingSince, createdAt);
    assert.equal(migrated.serviceRevision, 1);
    assert.equal(migrated.servedAt, null);
    assert.equal(migrated.items.length, itemCount);
    assert.equal(migrated.totalMinor, total);
    for (const id of unrelatedOrderIds) {
      const order = repository.getOrder(id);
      assert.equal(order.servicePendingSince, null);
      assert.equal(order.serviceRevision, 0);
      assert.equal(order.servedAt, null);
    }
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
});
