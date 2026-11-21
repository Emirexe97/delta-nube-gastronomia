import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configuredTestRepository } from "./configured-test-repository";

test("auditoría de turno conserva snapshot al cierre y no mezcla el turno siguiente", () => {
  const path = join(tmpdir(), `shift-audit-${randomUUID()}.sqlite`);
  const repo = configuredTestRepository(path, { seedStarterCatalog: true });
  try {
    const session = repo.openCashSession({ openingAmountMinor: 0 });
    const draft = repo.createOrder({
      type: "TAKEAWAY",
      customerName: "Auditable",
      customerPhone: "1112345678",
      deliveryAddress: "QA 1",
    });
    repo.addOrderItem({ orderId: draft.id, productId: "starter-muzza-grande" });
    const confirmed = repo.confirmOrder({ orderId: draft.id });
    repo.payOrder({
      orderId: confirmed.id,
      payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor }],
    });
    const beforeClose = repo.getOrder(confirmed.id);
    repo.closeCashSession({
      countedAmountMinor: beforeClose.totalMinor,
      force: true,
      reason: "QA",
      authorizerPin: "2468",
    });
    const next = repo.openCashSession({ openingAmountMinor: 1 });
    const paid = repo.getOrder(confirmed.id).payments[0]!;
    repo.refundPayment({
      orderId: confirmed.id,
      paymentId: paid.id,
      amountMinor: 1,
      reason: "QA segundo turno",
      authorizerPin: "2468",
    });
    const afterClose = repo.getOrder(confirmed.id);
    assert.equal(
      repo.getShiftOrderAudit({
        cashSessionId: session.id,
        orderId: confirmed.id,
      }).orderAtClose?.totalMinor,
      beforeClose.totalMinor,
    );
    assert.equal(
      repo.getShiftAudit({ cashSessionId: session.id, section: "orders" })
        .session.salesTotalMinor,
      beforeClose.totalMinor,
    );
    assert.equal(
      repo
        .listCashSessionHistoryPage()
        .items.find((item) => item.id === session.id)?.salesTotalMinor,
      beforeClose.totalMinor,
    );
    const firstTurnEvents = repo.getShiftOrderAudit({
      cashSessionId: session.id,
      orderId: confirmed.id,
    }).events;
    assert.ok(firstTurnEvents.length >= 1);
    const refund = firstTurnEvents.find(
      (event) => event.label === "Devolución",
    );
    assert.equal(refund?.cashSessionId, next.id);
    assert.equal(refund?.cashEffectMinor, -1);
    assert.ok(refund?.authorizer);
    assert.equal(
      repo.getShiftAudit({ cashSessionId: next.id, section: "orders" })
        .orders[0]?.collectedMinor,
      -1,
    );
    assert.ok(
      !repo
        .getShiftAudit({ cashSessionId: session.id, section: "movements" })
        .movements.some((e) => e.id === refund.id),
    );
    assert.equal(
      repo.getShiftAudit({ cashSessionId: session.id, section: "orders" })
        .totalCount,
      1,
    );
    assert.equal(afterClose.id, beforeClose.id);
    // Previously installed versions recorded sales and returns but did not save the order at closing.
    repo.db.prepare("DELETE FROM shift_order_closures WHERE cash_session_id=?").run(session.id);
    const legacy = repo.getShiftOrderAudit({cashSessionId:session.id,orderId:confirmed.id});
    assert.equal(legacy.orderAtClose,null);
    assert.equal(legacy.order.items.length,1);
    assert.equal(legacy.events.find(e=>e.label==="Cobro")?.cashSessionId,session.id);
    assert.equal(legacy.events.find(e=>e.label==="Devolución")?.cashSessionId,next.id);
  } finally {
    repo.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

test("envío gratuito conserva remuneración nula o positiva sin inventar fee", () => {
  const path = join(tmpdir(), `shift-audit-free-${randomUUID()}.sqlite`);
  const repo = configuredTestRepository(path, { seedStarterCatalog: true });
  try {
    const a = repo.openCashSession({ openingAmountMinor: 0 });
    repo.saveSettings({
      ...repo.bootstrap().settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: false,
    });
    const driver = repo.createUser({
      fullName: "Driver QA",
      roleCode: "DELIVERY_DRIVER",
      pin: "3579",
      authorizerPin: "2468",
    });
    const order = repo.createOrder({
      type: "DELIVERY",
      customerName: "Gratis",
      customerPhone: "1112345678",
      deliveryAddress: "QA",
      deliveryFeeMinor: 0,
    });
    repo.addOrderItem({ orderId: order.id, productId: "starter-muzza-grande" });
    repo.confirmOrder({ orderId: order.id });
    repo.assignDeliveryDriver({
      orderId: order.id,
      driverUserId: driver.id,
      driverRemunerationMinor: 200_000,
    });
    const shipments = repo.getDeliveryShipments({
      cashSessionId: repo.bootstrap().cashSession!.id,
    });
    assert.equal(shipments.items[0]?.deliveryFeeMinor, 0);
    assert.equal(shipments.items[0]?.driverRemunerationMinor, 200_000);
    const confirmed = repo.getOrder(order.id);
    repo.completeOrder({
      orderId: order.id,
      finalStatus: "DELIVERED",
      payments: [{ methodCode: "TRANSFER", amountMinor: confirmed.totalMinor }],
    });
    const due = repo.getDeliveryShipments({ cashSessionId: a.id }).items[0]!;
    assert.equal(due.status, "PENDING");
    assert.equal(due.amountDueMinor, 200_000);
    repo.closeCashSession({
      countedAmountMinor: 0,
      force: true,
      reason: "Rendir en el siguiente turno",
      authorizerPin: "2468",
    });
    const b = repo.openCashSession({ openingAmountMinor: 200_000 });
    repo.settleDelivery({
      ledgerIds: [due.id],
      authorizerPin: "2468",
      reason: "Pago al chofer en B",
    });
    const after = repo.getShiftAudit({
      cashSessionId: a.id,
      section: "deliveries",
    });
    assert.equal(after.orders[0]?.settlementLabel, "Pendiente");
    assert.equal(after.orders[0]?.deliveryFeeMinor, 0);
    assert.equal(after.orders[0]?.driverPayMinor, 200_000);
    const inB = repo
      .getShiftAudit({ cashSessionId: b.id, section: "movements" })
      .movements.filter((m) => m.orderId === order.id);
    assert.deepEqual(
      inB.map((m) => m.cashEffectMinor),
      [-200_000],
    );
    assert.equal(
      repo.getShiftAudit({ cashSessionId: b.id, section: "orders" }).orders[0]
        ?.collectedMinor,
      0,
    );
    repo.closeCashSession({ countedAmountMinor: 0, closingFloatAmountMinor: 0 });
    assert.equal(
      repo.getShiftOrderAudit({ cashSessionId: b.id, orderId: order.id })
        .orderAtClose?.id,
      order.id,
    );
  } finally {
    repo.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});
