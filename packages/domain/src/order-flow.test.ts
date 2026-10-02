import assert from "node:assert/strict";
import test from "node:test";
import type { OrderDto } from "@gastronomy/contracts";
import {
  assertOperationalTransition,
  guardOrderAction,
  paymentStatusFor,
} from "./index";

function order(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: "order",
    number: 1,
    type: "TAKEAWAY",
    operationalStatus: "PENDING",
    paymentStatus: "UNPAID",
    lifecycleStatus: "DRAFT",
    cashSessionCreatedId: "cash",
    cashSessionPaidId: null,
    tableId: null,
    tableNumber: null,
    customerId: null,
    customerNameSnapshot: "Cliente",
    customerPhoneSnapshot: "1155551111",
    deliveryAddressSnapshot: null,
    deliveryAddressNotesSnapshot: null,
    deliveryFeeMinor: 0,
    promisedAt: null,
    scheduled: false,
    waiterUserId: null,
    waiterName: null,
    driverUserId: null,
    driverName: null,
    collectedByDriver: false,
    notes: null,
    subtotalMinor: 10000,
    discountMinor: 0,
    depositMinor: 0,
    totalMinor: 10000,
    paidMinor: 0,
    printedAt: null,
    printCount: 0,
    createdAt: "2026-10-02T12:00:00Z",
    updatedAt: "2026-10-02T12:00:00Z",
    items: [
      {
        id: "item",
        quantity: 1,
        unitPriceMinorSnapshot: 10000,
      } as OrderDto["items"][number],
    ],
    payments: [],
    ...overrides,
  };
}

test("productos primero: identidad obligatoria al confirmar, no al editar borrador", () => {
  const incomplete = order({
    customerNameSnapshot: null,
    customerPhoneSnapshot: null,
  });
  assert.equal(guardOrderAction(incomplete, "EDIT").allowed, true);
  assert.match(guardOrderAction(incomplete, "CONFIRM").reason!, /nombre/);
  assert.match(
    guardOrderAction(order({ type: "DELIVERY" }), "CONFIRM").reason!,
    /dirección/,
  );
});

test("seña completa cubre saldo cero pero no permite confirmar pedido vacío", () => {
  assert.equal(paymentStatusFor(0, 0, 10000), "PAID");
  assert.equal(paymentStatusFor(0, 0), "UNPAID");
  assert.equal(paymentStatusFor(1000, 0, 9000), "UNPAID");
  assert.equal(
    guardOrderAction(order({ totalMinor: 0, depositMinor: 10000 }), "CONFIRM")
      .allowed,
    true,
  );
  assert.equal(
    guardOrderAction(order({ totalMinor: 0 }), "CONFIRM").allowed,
    false,
  );
  assert.equal(
    guardOrderAction(
      order({ totalMinor: 0, depositMinor: 10000, items: [] }),
      "CONFIRM",
    ).allowed,
    false,
  );
});

test("cancelación sólo por operación autorizada, nunca cambio de estado genérico", () => {
  for (const paidMinor of [0, 10000]) {
    assert.throws(
      () =>
        assertOperationalTransition(
          order({
            lifecycleStatus: "CONFIRMED",
            operationalStatus: "IN_PREPARATION",
            paidMinor,
          }),
          "CANCELLED",
        ),
      /Cancelar pedido.*PIN/,
    );
  }
});

test("productos, descuentos y señas no modifican pagos ni historial finalizado mediante edición normal", () => {
  assert.equal(
    guardOrderAction(order({ paidMinor: 1000 }), "EDIT").allowed,
    false,
  );
  for (const operationalStatus of ["DELIVERED", "CANCELLED"] as const)
    assert.equal(
      guardOrderAction(order({ operationalStatus }), "EDIT").allowed,
      false,
    );
  assert.equal(guardOrderAction(order(), "EDIT").allowed, true);
});
