import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function fixture(run: (repo: SqliteGastronomyRepository, db: InstanceType<typeof Database>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-shift-pending-"));
  const path = join(dir, "test.sqlite");
  const repo = new SqliteGastronomyRepository(path, { adminPin: "2468", seedStarterCatalog: true });
  const db = new Database(path);
  try { run(repo, db); }
  finally {
    db.close(); repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("gastronomy-shift-pending-"));
    rmSync(dir, { recursive: true, force: true });
  }
}

function addItem(repo: SqliteGastronomyRepository, orderId: string) {
  const product = repo.bootstrap().products.find((row) => row.active)!;
  return repo.addOrderItem({ orderId, productId: product.id });
}

test("cierre forzado de A conserva impagos históricos y mesa pagada; B los consulta y libera sin alterar caja", () => fixture((repo, db) => {
  const sessionA = repo.openCashSession({ openingAmountMinor: 50000 });
  const takeaway = repo.createOrder({ type: "TAKEAWAY", customerName: "Pendiente A", customerPhone: "1155550001" });
  addItem(repo, takeaway.id);
  repo.confirmOrder({ orderId: takeaway.id });
  const delivery = repo.createOrder({ type: "DELIVERY", customerName: "Reparto A", customerPhone: "1155550002", deliveryAddress: "Calle A 10" });
  addItem(repo, delivery.id);
  repo.confirmOrder({ orderId: delivery.id });

  const table = repo.ensureTable(31);
  const dineIn = repo.createOrder({ type: "DINE_IN", tableId: table.id, waiterUserId: "user-admin" });
  const tableFilled = addItem(repo, dineIn.id);
  repo.confirmOrder({ orderId: dineIn.id });
  repo.payOrder({ orderId: dineIn.id, payments: [{ methodCode: "CASH", amountMinor: tableFilled.totalMinor }] });
  const originalOrders = [takeaway.id, delivery.id, dineIn.id].map((id) => repo.getOrder(id));
  const paymentsBefore = db.prepare("SELECT p.order_id, p.amount_minor, m.code AS method_code, p.cash_session_id FROM payments p JOIN payment_methods m ON m.id=p.payment_method_id WHERE p.order_id IN (?, ?, ?) ORDER BY p.order_id").all(takeaway.id, delivery.id, dineIn.id);
  const cashBeforeA = repo.bootstrap().cashSession!.expectedAmountMinor;

  repo.closeCashSession({ countedAmountMinor: cashBeforeA, force: true, reason: "Cambio de turno con pendientes documentados", authorizerPin: "2468" });
  const sessionB = repo.openCashSession({ openingAmountMinor: 10000 });
  const bootB = repo.bootstrap();
  assert.deepEqual(bootB.orders, []);
  assert.equal(bootB.tables.find((row) => row.id === table.id)?.currentOrderId, dineIn.id);
  assert.equal(bootB.tables.find((row) => row.id === table.id)?.currentTotalMinor, tableFilled.totalMinor);
  const historical = repo.getOrder(dineIn.id);
  assert.equal(historical.paymentStatus, "PAID");
  const beforeCloseTable = { cashA: db.prepare("SELECT expected_amount_minor,status FROM cash_sessions WHERE id=?").get(sessionA.id),
    cashB: db.prepare("SELECT expected_amount_minor,status FROM cash_sessions WHERE id=?").get(sessionB.id), payments: db.prepare("SELECT p.order_id, p.amount_minor, m.code AS method_code, p.cash_session_id FROM payments p JOIN payment_methods m ON m.id=p.payment_method_id WHERE p.order_id IN (?, ?, ?) ORDER BY p.order_id").all(takeaway.id, delivery.id, dineIn.id) };
  repo.updateOrderStatus(dineIn.id, "DELIVERED");
  assert.equal(repo.bootstrap().tables.find((row) => row.id === table.id)?.currentOrderId, null);
  const afterCloseTable = { cashA: db.prepare("SELECT expected_amount_minor,status FROM cash_sessions WHERE id=?").get(sessionA.id),
    cashB: db.prepare("SELECT expected_amount_minor,status FROM cash_sessions WHERE id=?").get(sessionB.id), payments: db.prepare("SELECT p.order_id, p.amount_minor, m.code AS method_code, p.cash_session_id FROM payments p JOIN payment_methods m ON m.id=p.payment_method_id WHERE p.order_id IN (?, ?, ?) ORDER BY p.order_id").all(takeaway.id, delivery.id, dineIn.id) };
  assert.deepEqual(afterCloseTable, beforeCloseTable);
  const bClosed = repo.closeCashSession({ countedAmountMinor: repo.bootstrap().cashSession!.expectedAmountMinor });
  assert.equal(bClosed.status, "CLOSED");
  const sessionC = repo.openCashSession({ openingAmountMinor: 0 });
  const reused = repo.createOrder({ type: "DINE_IN", tableId: table.id, waiterUserId: "user-admin" });
  assert.equal(reused.tableId, table.id);
  assert.equal(repo.getOrder(takeaway.id).operationalStatus, "IN_PREPARATION");
  assert.equal(repo.getOrder(delivery.id).operationalStatus, "IN_PREPARATION");
  assert.equal(repo.getOrder(takeaway.id).paidMinor, originalOrders[0]!.paidMinor);
  assert.equal(repo.getOrder(delivery.id).paidMinor, originalOrders[1]!.paidMinor);
  assert.equal(repo.getOrder(dineIn.id).paidMinor, originalOrders[2]!.paidMinor);
  assert.deepEqual(repo.getOrder(dineIn.id).payments, originalOrders[2]!.payments);
  assert.deepEqual(paymentsBefore, afterCloseTable.payments);
  assert.equal(repo.bootstrap().cashSession!.id, sessionC.id);
}));

test("B cierra normalmente aunque A conserve pedidos pendientes; los históricos siguen intactos", () => fixture((repo, db) => {
  const sessionA = repo.openCashSession({ openingAmountMinor: 0 });
  const takeaway = repo.createOrder({ type: "TAKEAWAY", customerName: "Pendiente histórico", customerPhone: "1155550010" });
  addItem(repo, takeaway.id);
  repo.confirmOrder({ orderId: takeaway.id });
  repo.closeCashSession({ countedAmountMinor: 0, force: true, reason: "Se deja el pendiente al nuevo turno", authorizerPin: "2468" });
  const historicalBefore = repo.getOrder(takeaway.id);
  const sessionB = repo.openCashSession({ openingAmountMinor: 7000 });
  const current = repo.createOrder({ type: "TAKEAWAY", customerName: "Venta turno B", customerPhone: "1155550011" });
  const filled = addItem(repo, current.id);
  repo.confirmOrder({ orderId: current.id });
  assert.throws(() => repo.closeCashSession({ countedAmountMinor: repo.bootstrap().cashSession!.expectedAmountMinor }), /pedido|pendiente/i);
  repo.payOrder({ orderId: current.id, payments: [{ methodCode: "CASH", amountMinor: filled.totalMinor }] });
  repo.updateOrderStatus(current.id, "DELIVERED");
  const bExpected = repo.bootstrap().cashSession!.expectedAmountMinor;
  const pendingGlobal = db.prepare("SELECT id, operational_status, payment_status FROM orders WHERE id=?").get(takeaway.id);
  const bClose = repo.closeCashSession({ countedAmountMinor: bExpected });
  assert.equal(bClose.status, "CLOSED");
  assert.equal(repo.getOrder(takeaway.id).operationalStatus, historicalBefore.operationalStatus);
  assert.equal(repo.getOrder(takeaway.id).paymentStatus, historicalBefore.paymentStatus);
  assert.deepEqual(db.prepare("SELECT id, operational_status, payment_status FROM orders WHERE id=?").get(takeaway.id), pendingGlobal);
  assert.equal(repo.getOrder(current.id).paymentStatus, "PAID");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM payments WHERE order_id=?").get(takeaway.id) as any).n, 0);
  assert.ok((db.prepare("SELECT COUNT(*) n FROM payments WHERE order_id=?").get(current.id) as any).n > 0);
  assert.equal((db.prepare("SELECT status FROM cash_sessions WHERE id=?").get(sessionA.id) as any).status, "CLOSED");
  assert.equal((db.prepare("SELECT status FROM cash_sessions WHERE id=?").get(sessionB.id) as any).status, "CLOSED");
}));

test("un pedido antiguo cobrado en B queda visible y bloquea B hasta finalizarlo", () => fixture((repo) => {
  repo.openCashSession({ openingAmountMinor: 0 });
  const order = repo.createOrder({ type: "TAKEAWAY", customerName: "Cobro posterior", customerPhone: "1155550040" });
  const filled = addItem(repo, order.id);
  repo.confirmOrder({ orderId: order.id });
  repo.closeCashSession({ countedAmountMinor: 0, force: true, reason: "Pendiente del turno A", authorizerPin: "2468" });
  const b = repo.openCashSession({ openingAmountMinor: 0 });
  repo.payOrder({ orderId: order.id, payments: [{ methodCode: "CASH", amountMinor: filled.totalMinor }] });
  assert.equal(repo.getOrder(order.id).cashSessionPaidId, b.id);
  assert.deepEqual(repo.bootstrap().orders.map((row) => row.id), [order.id]);
  assert.throws(() => repo.closeCashSession({ countedAmountMinor: repo.bootstrap().cashSession!.expectedAmountMinor }), (error: unknown) => error instanceof Error && error.message.includes(`#${order.number}`));
  repo.updateOrderStatus(order.id, "DELIVERED");
  assert.equal(repo.closeCashSession({ countedAmountMinor: repo.bootstrap().cashSession!.expectedAmountMinor }).status, "CLOSED");
}));
