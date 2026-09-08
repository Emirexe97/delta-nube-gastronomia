import assert from "node:assert/strict";
import test from "node:test";
import {
  businessDateFromOpening,
  calculateCashClosing,
  calculateCashDifference,
  calculateDeliverySettlement,
  calculateExpectedCash,
  calculateHalfAndHalfBase,
  calculateModifierCharge,
  calculateDiscountMinor,
  assertOffPremiseCustomer,
  paymentStatusFor,
} from "./index";

test("para retirar requiere cliente pero permite omitir la dirección", () => {
  assert.doesNotThrow(() =>
    assertOffPremiseCustomer({
      type: "TAKEAWAY",
      customerName: "Cliente retiro",
      customerPhone: "11 5555-0101",
      deliveryAddress: null,
    }),
  );
  assert.throws(
    () =>
      assertOffPremiseCustomer({
        type: "DELIVERY",
        customerName: "Cliente envío",
        customerPhone: "11 5555-0202",
        deliveryAddress: null,
      }),
    /dirección/,
  );
});

test("mitad y mitad HALF_PLUS_HALF", () => {
  assert.equal(
    calculateHalfAndHalfBase(1_500_000, 1_800_000, "HALF_PLUS_HALF"),
    1_650_000,
  );
});

test("mitad y mitad MOST_EXPENSIVE", () => {
  assert.equal(
    calculateHalfAndHalfBase(1_500_000, 1_800_000, "MOST_EXPENSIVE"),
    1_800_000,
  );
});

test("extra completo y por media pizza", () => {
  assert.equal(calculateModifierCharge(200_000, "FULL_PIZZA"), 200_000);
  assert.equal(calculateModifierCharge(200_000, "FIRST_HALF"), 100_000);
});

test("descuento nunca supera el total", () => {
  assert.equal(calculateDiscountMinor(4_000_000, "PERCENTAGE", 10), 400_000);
  assert.equal(calculateDiscountMinor(4_000_000, "FIXED", 500_000), 500_000);
  assert.throws(() => calculateDiscountMinor(4_000_000, "PERCENTAGE", 110));
});

test("día comercial permanece en la fecha de apertura", () => {
  assert.equal(
    businessDateFromOpening("2026-08-31T18:00:00-03:00"),
    "2026-08-31",
  );
  assert.notEqual(
    businessDateFromOpening("2026-09-01T03:00:00-03:00"),
    "2026-08-31",
  );
});

test("caja calcula esperado, contado y diferencia", () => {
  const expected = calculateExpectedCash(5_000_000, [
    { type: "SALE", amountMinor: 42_000_000 },
    { type: "EXPENSE", amountMinor: 2_500_000 },
    { type: "WITHDRAWAL", amountMinor: 10_000_000 },
    { type: "SALE", amountMinor: 8_000_000, affectsCash: false },
  ]);
  assert.equal(expected, 34_500_000);
  assert.equal(calculateCashDifference(expected, 34_350_000), -150_000);
});

test("cierre separa diferencia de arqueo, retiro y variación de cambio", () => {
  assert.deepEqual(
    calculateCashClosing(15_000_000, 15_000_000, 5_000_000, 3_000_000),
    {
      differenceMinor: 0,
      cashRemovedAmountMinor: 12_000_000,
      floatDifferenceMinor: -2_000_000,
    },
  );
  assert.throws(
    () => calculateCashClosing(10_000_000, 9_000_000, 2_000_000, 10_000_000),
    /no puede superar el efectivo contado/,
  );
});

test("pago mixto determina estado pagado", () => {
  assert.equal(paymentStatusFor(4_000_000, 4_000_000), "PAID");
  assert.equal(paymentStatusFor(4_000_000, 2_000_000), "PARTIALLY_PAID");
});

test("delivery efectivo: repartidor retiene fee y rinde restaurante", () => {
  assert.deepEqual(
    calculateDeliverySettlement({
      restaurantAmountMinor: 2_000_000,
      deliveryFeeMinor: 300_000,
      paymentDestination: "DRIVER",
    }),
    {
      customerTotalMinor: 2_300_000,
      driverCollectedMinor: 2_300_000,
      driverOwesBusinessMinor: 2_000_000,
      businessOwesDriverMinor: 0,
    },
  );
});

test("delivery transferencia: negocio debe fee al repartidor", () => {
  assert.equal(
    calculateDeliverySettlement({
      restaurantAmountMinor: 2_000_000,
      deliveryFeeMinor: 300_000,
      paymentDestination: "BUSINESS",
    }).businessOwesDriverMinor,
    300_000,
  );
});
