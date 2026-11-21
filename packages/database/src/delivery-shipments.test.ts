import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configuredTestRepository } from "./configured-test-repository";

test("delivery shipments projects orders without ledger as NO_SETTLEMENT", () => {
  const path = join(tmpdir(), `gastronomy-shipments-${randomUUID()}.sqlite`);
  const repository = configuredTestRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    repository.openCashSession({ openingAmountMinor: 0 });
    const draft = repository.createOrder({
      type: "DELIVERY",
      customerName: "Sin saldo",
      customerPhone: "1144444444",
      deliveryAddress: "Calle 1",
      deliveryFeeMinor: 0,
    });
    repository.addOrderItem({
      orderId: draft.id,
      productId: "starter-muzza-grande",
    });
    const row = repository
      .getDeliveryShipments({ scope: "ALL" })
      .items.find((item) => item.orderId === draft.id);
    assert.ok(row);
    assert.equal(row.orderId, draft.id);
    assert.equal(row.deliveryFeeMinor, 0);
    assert.equal(row.status, "NO_SETTLEMENT");
    assert.equal(
      repository.getDeliveryShipments({ scope: "ALL" }).totals.settledCount,
      0,
    );
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});
