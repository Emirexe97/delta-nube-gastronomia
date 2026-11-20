import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuredTestRepository } from "./configured-test-repository";
import type { SqliteGastronomyRepository } from "./sqlite-repository";

type Row = Record<string, unknown>;
function fixture(run: (repo: SqliteGastronomyRepository) => void) {
  const path = join(tmpdir(), `gastronomy-bootstrap-${randomUUID()}.sqlite`);
  const repo = configuredTestRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  try { run(repo); } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
}

// Clone only synthetic test rows, keeping new schema defaults/snapshots intact.
function insertRow(repo: SqliteGastronomyRepository, table: string, row: Row) {
  const columns = Object.keys(row);
  repo.db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...Object.values(row));
}

function countBootstrap(repo: SqliteGastronomyRepository) {
  const prepare = repo.db.prepare;
  let queries = 0;
  repo.db.prepare = ((sql: string) => {
    const statement = prepare.call(repo.db, sql);
    return new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "get" || property === "all" || property === "run") {
          return (...args: unknown[]) => {
            queries += 1;
            return Reflect.apply(Reflect.get(target, property), target, args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }) as typeof prepare;
  try { return { dto: repo.bootstrap(), queries }; }
  finally { repo.db.prepare = prepare; }
}

test("bootstrap maps mixed orders exactly like getOrder, with refunds, halves, extras and latest successful kitchen snapshot", () => fixture((repo) => {
  const cash = repo.openCashSession({ openingAmountMinor: 0 });
  const draft = repo.createOrder({ type: "TAKEAWAY", customerName: "Synthetic", customerPhone: "1100000000" });
  repo.addHalfAndHalfItem({ orderId: draft.id, firstProductId: "starter-muzza-grande", secondProductId: "starter-napo-grande", quantity: 2, notes: "Half notes" });
  const firstItem = repo.getOrder(draft.id).items[0]!;
  const extra = repo.createModifier({ groupName: "Synthetic", name: "Extra", priceMinor: 20_000 });
  repo.addOrderItemModifier({ orderId: draft.id, itemId: firstItem.id, modifierId: extra.id, scope: "FIRST_HALF" });
  repo.addOrderItem({ orderId: draft.id, productId: "starter-gaseosa", quantity: 3 });
  const confirmed = repo.confirmOrder({ orderId: draft.id });
  const paid = repo.payOrder({ orderId: draft.id, payments: [{ methodCode: "TRANSFER", amountMinor: confirmed.totalMinor, reference: "SYNTHETIC" }] });
  repo.refundPayment({ orderId: draft.id, paymentId: paid.payments[0]!.id, amountMinor: 10_000, reason: "Synthetic partial", authorizerPin: "2468" });
  const printed = repo.queuePrint(draft.id, "KITCHEN_ORDER");
  repo.markPrintJob(printed.jobId, "PRINTED");
  const later = repo.queuePrint(draft.id, "KITCHEN_ORDER");
  repo.markPrintJob(later.jobId, "PRINTED");
  const quantities = { [firstItem.id]: 7 };
  repo.db.prepare("UPDATE print_jobs SET kitchen_snapshot_json = ? WHERE id = ?").run(JSON.stringify({ quantities }), later.jobId);
  repo.queuePrint(draft.id, "KITCHEN_ORDER"); // A later pending attempt must not replace the baseline.
  const emptyDraft = repo.createOrder({ type: "DINE_IN", tableId: "table-1" });
  const legacy = repo.createOrder({ type: "TAKEAWAY", customerName: "Legacy", customerPhone: "1100000001" });
  repo.addOrderItem({ orderId: legacy.id, productId: "starter-gaseosa" });
  repo.confirmOrder({ orderId: legacy.id });
  const legacyJob = repo.queuePrint(legacy.id, "KITCHEN_ORDER");
  repo.markPrintJob(legacyJob.jobId, "PRINTED");
  repo.db.prepare("UPDATE print_jobs SET kitchen_snapshot_json = NULL WHERE id = ?").run(legacyJob.jobId);
  const historicalCash = repo.db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(cash.id) as Row;
  insertRow(repo, "cash_sessions", { ...historicalCash, id: "historical-cash", number: 999, status: "CLOSED" });
  const historicalOrder = repo.db.prepare("SELECT * FROM orders WHERE id = ?").get(draft.id) as Row;
  insertRow(repo, "orders", { ...historicalOrder, id: "outside-shift", number: 90001, shift_number: 90001, cash_session_created_id: "historical-cash", cash_session_paid_id: "historical-cash" });
  insertRow(repo, "orders", { ...historicalOrder, id: "paid-this-shift", number: 90002, shift_number: 90002, cash_session_created_id: "historical-cash", cash_session_paid_id: cash.id });
  const orders = repo.bootstrap().orders;
  assert.equal(orders.length, 4);
  assert.ok(!orders.some((order) => order.id === "outside-shift"));
  for (const order of orders) assert.deepEqual(order, repo.getOrder(order.id));
  const actual = orders.find((order) => order.id === draft.id)!;
  assert.equal(actual.items[0]!.halves.length, 2);
  assert.equal(actual.items[0]!.modifiers[0]!.scope, "FIRST_HALF");
  assert.equal(actual.items[0]!.lineTotalMinor, (firstItem.unitPriceMinorSnapshot + 10_000) * 2);
  assert.equal(actual.payments[0]!.refundedMinor, 10_000);
  assert.equal(actual.payments[0]!.status, "PARTIALLY_REFUNDED");
  assert.deepEqual(actual.kitchenPrintedQuantities, quantities);
  assert.deepEqual(orders.find((order) => order.id === emptyDraft.id)!.kitchenPrintedQuantities, {});
  assert.equal(orders.find((order) => order.id === legacy.id)!.kitchenPrintedQuantities, null);
  assert.throws(() => repo.getOrder("missing"), /El pedido no existe/);
}));

test("bootstrap query count grows by batches, not orders, lines or catalog products", () => fixture((repo) => {
  repo.openCashSession({ openingAmountMinor: 0 });
  const order = repo.createOrder({ type: "TAKEAWAY", customerName: "Volume", customerPhone: "1100000000" });
  repo.addOrderItem({ orderId: order.id, productId: "starter-muzza-grande" });
  const sourceOrder = repo.db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id) as Row;
  const sourceItem = repo.db.prepare("SELECT * FROM order_items WHERE order_id = ?").get(order.id) as Row;
  const sourceProduct = repo.db.prepare("SELECT * FROM products WHERE id = 'starter-muzza-grande'").get() as Row;
  const small = countBootstrap(repo);
  repo.db.transaction(() => {
    for (let index = 1; index < 50; index += 1) {
      insertRow(repo, "orders", { ...sourceOrder, id: `volume-${index}`, number: index + 1, shift_number: index + 1 });
      insertRow(repo, "order_items", { ...sourceItem, id: `line-${index}`, order_id: `volume-${index}` });
      insertRow(repo, "products", { ...sourceProduct, id: `catalog-${index}`, code: null, name: `Synthetic ${index}` });
    }
    // More than 999 items in one order must not exceed SQLite's placeholder limit.
    for (let index = 0; index < 1005; index += 1) insertRow(repo, "order_items", { ...sourceItem, id: `many-lines-${index}` });
  })();
  const medium = countBootstrap(repo);
  assert.equal(medium.dto.orders.length, 50);
  assert.equal(medium.queries, small.queries);
  repo.db.transaction(() => {
    for (let index = 50; index < 405; index += 1) {
      insertRow(repo, "orders", { ...sourceOrder, id: `volume-${index}`, number: index + 1, shift_number: index + 1 });
      insertRow(repo, "order_items", { ...sourceItem, id: `line-${index}`, order_id: `volume-${index}` });
    }
  })();
  const large = countBootstrap(repo);
  assert.equal(large.dto.orders.length, 405);
  assert.equal(large.queries, small.queries + 5);
  assert.deepEqual(large.dto.orders.find((dto) => dto.id === "volume-404"), repo.getOrder("volume-404"));
  assert.equal(large.dto.orders.find((dto) => dto.id === order.id)!.items.length, 1006);
}));
