import { configuredTestRepository } from "./configured-test-repository";
import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SqliteGastronomyRepository } from "./sqlite-repository";

test("getDeliveryProjection devuelve snapshot puntual y finanzas de la caja abierta", () => {
  const path = join(
    tmpdir(),
    `gastronomy-delivery-projection-${randomUUID()}.sqlite`,
  );
  const repository = configuredTestRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    const session = repository.openCashSession({ openingAmountMinor: 100_000 });
    repository.saveSettings({
      ...repository.bootstrap().settings,
      deliverySettlementEnabled: true,
    });
    const driver = repository.createUser({
      fullName: "Proyección",
      roleCode: "DELIVERY_DRIVER",
      pin: "3579",
      authorizerPin: "2468",
    });
    const draft = repository.createOrder({
      type: "DELIVERY",
      customerName: "Cliente",
      customerPhone: "11 4555-5000",
      deliveryAddress: "Calle 1",
      deliveryFeeMinor: 200_000,
      driverUserId: driver.id,
    });
    const order = repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    repository.completeOrder({
      orderId: order.id,
      finalStatus: "DELIVERED",
      driverUserId: driver.id,
      payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
    });

    const projection = repository.getDeliveryProjection({
      orderId: order.id,
      includeFinancials: true,
    });
    assert.equal(projection.order.id, order.id);
    assert.equal(projection.cashSessionId, session.id);
    assert.equal(
      projection.deliveryLedger.some((row) => row.orderId === order.id),
      true,
    );
    assert.equal(
      projection.driverDeliveryActivity.some(
        (row) =>
          row.driverUserId === driver.id && row.cashSessionId === session.id,
      ),
      true,
    );
    assert.equal(projection.financials?.cashSession.id, session.id);
    assert.equal(
      projection.financials?.dashboard.salesTotalMinor,
      order.totalMinor,
    );
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});
