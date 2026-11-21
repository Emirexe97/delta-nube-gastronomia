import assert from "node:assert/strict";
import { test } from "vitest";
import type { DeliveryShipmentDto } from "@gastronomy/contracts";
import { getDemoDeliveryShipments } from "./delivery-shipments";

const row = (
  id: string,
  status: DeliveryShipmentDto["status"],
): DeliveryShipmentDto => ({
  id,
  orderId: `order-${id}`,
  orderNumber: Number(id),
  cashSessionId: "cash-1",
  businessDate: "2026-11-21",
  driverUserId: "driver-1",
  driverName: "Luna",
  customerName: "Cliente",
  deliveryAddress: "Calle 1",
  orderCreatedAt: "2026-11-21T10:00:00.000Z",
  operationalStatus: "DELIVERED",
  lifecycleStatus: "CONFIRMED",
  paymentStatus: "PAID",
  deliveryFeeMinor: 100,
  customerChargeMinor: 100,
  driverRemunerationMinor: 100,
  collectedByDriverMinor: 500,
  restaurantAmountMinor: 400,
  direction: "DRIVER_OWES_BUSINESS",
  amountDueMinor: 400,
  settledAmountMinor: status === "SETTLED" ? 400 : 0,
  status,
  createdAt: `2026-11-21T10:0${id}:00.000Z`,
  settledAt: status === "SETTLED" ? "2026-11-21T11:00:00.000Z" : null,
});

test("demo shipments filters and paginates without mutating source", () => {
  const source = [row("1", "PENDING"), row("2", "SETTLED")];
  const result = getDemoDeliveryShipments(source, {
    status: "PENDING",
    pageSize: 1,
  });
  assert.equal(result.totalCount, 1);
  assert.equal(result.items[0]?.id, "1");
  assert.equal(source.length, 2);
  assert.equal(result.totals.pendingAmountMinor, 400);
});
