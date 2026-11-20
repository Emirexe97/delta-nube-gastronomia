import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configuredTestRepository } from "./configured-test-repository";

test("delivery history filters by order shift business date and operational bootstrap stays compact", () => {
  const path = join(
    tmpdir(),
    `gastronomy-delivery-history-${randomUUID()}.sqlite`,
  );
  const repository = configuredTestRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    repository.openCashSession({ openingAmountMinor: 0 });
    const fullBefore = repository.bootstrap();
    const openSession = fullBefore.cashSession!;
    repository.saveSettings({
      ...fullBefore.settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: true,
    });
    const driver = repository.createUser({
      fullName: "Repartidor historial",
      roleCode: "DELIVERY_DRIVER",
      pin: "3579",
      authorizerPin: "2468",
    });
    const order = repository.createOrder({
      type: "DELIVERY",
      customerName: "Historial",
      customerPhone: "1155550010",
      deliveryFeeMinor: 100,
      deliveryAddress: "Calle 1",
      driverUserId: driver.id,
    });
    repository.addOrderItem({
      orderId: order.id,
      productId: "starter-muzza-grande",
    });
    const confirmed = repository.confirmOrder({ orderId: order.id });
    repository.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor }],
    });
    repository.updateOrderStatus(order.id, "READY");
    repository.updateOrderStatus(order.id, "OUT_FOR_DELIVERY");
    repository.updateOrderStatus(order.id, "DELIVERED");

    // A pending settlement from the previous shift must survive the operational scope.
    assert.equal(
      repository.bootstrap({ deliveryScope: "OPERATIONAL" }).deliveryLedger[0]
        ?.amountDueMinor,
      100,
    );
    repository.closeCashSession({
      countedAmountMinor:
        repository.bootstrap().cashSession!.expectedAmountMinor,
      force: true,
      reason: "Arrastrar pendiente al siguiente turno",
      authorizerPin: "2468",
    });
    repository.openCashSession({ openingAmountMinor: 0 });

    const operational = repository.bootstrap({ deliveryScope: "OPERATIONAL" });
    assert.equal(operational.categories.length, fullBefore.categories.length);
    assert.equal(
      operational.orders.some((row) => row.id === order.id),
      false,
    );
    assert.equal(
      operational.deliveryLedger.some((row) => row.orderId === order.id),
      true,
    );
    assert.equal(operational.driverDeliveryActivity.length, 0);

    const history = repository.getDeliveryHistory({
      scope: "DATE",
      date: openSession.businessDate,
    });
    assert.equal(
      history.deliveryLedger.some((row) => row.orderId === order.id),
      true,
    );
    assert.ok(
      history.deliveryLedger.every(
        (row) => row.businessDate === openSession.businessDate,
      ),
    );
    assert.ok(
      history.driverDeliveryActivity.every(
        (row) => row.businessDate === openSession.businessDate,
      ),
    );
    assert.equal(
      repository
        .getDeliveryHistory({ scope: "ALL" })
        .deliveryLedger.some((row) => row.orderId === order.id),
      true,
    );
    assert.throws(
      () => repository.getDeliveryHistory({ scope: "DATE" }),
      /fecha válida/i,
    );

    const legacy = repository.bootstrap();
    assert.deepEqual(legacy.deliveryLedger, repository.queryDeliveryLedger());
    const cashToClose = repository.bootstrap().cashSession!;
    repository.closeCashSession({
      countedAmountMinor: cashToClose.expectedAmountMinor,
    });
    const closedOperational = repository.bootstrap({
      deliveryScope: "OPERATIONAL",
    });
    assert.equal(closedOperational.cashSession, null);
    assert.equal(closedOperational.orders.length, 0);
    assert.equal(closedOperational.driverDeliveryActivity.length, 0);
    assert.deepEqual(
      closedOperational.deliveryLedger.map((row) => row.orderId),
      [order.id],
    );
    repository.db
      .prepare(
        "UPDATE delivery_ledger SET settled_amount_minor=amount_due_minor WHERE order_id=?",
      )
      .run(order.id);
    assert.equal(
      repository.bootstrap({ deliveryScope: "OPERATIONAL" }).deliveryLedger
        .length,
      0,
    );
    assert.equal(
      repository.getDeliveryHistory({ scope: "DATE", date: "1999-01-01" })
        .deliveryLedger.length,
      0,
    );
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});
