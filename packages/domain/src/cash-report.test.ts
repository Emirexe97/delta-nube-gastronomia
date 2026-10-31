import test from "node:test";
import assert from "node:assert/strict";
import { cashClosingTotals, cashOutflowDetails, cashOutflowGroups, cashReportBreakdown } from "./cash";
import type { CashMovementDto } from "@gastronomy/contracts";

function movement(overrides: Partial<CashMovementDto>): CashMovementDto {
  return {
    id: "movement", type: "EXPENSE", amountMinor: 25_000, affectsCash: true,
    paymentMethodCode: null, orderId: "delivery", userId: "admin", reason: null,
    createdAt: "2026-10-10T12:00:00.000Z", ...overrides,
  };
}

test("el detalle identifica cada salida de efectivo por su tipo y conserva sus conceptos", () => {
  const movements = [
    movement({ id: "expense", orderId: null, reason: "Compra de harina" }),
    movement({ id: "delivery", reason: "Pago del pedido #24" }),
    movement({ id: "withdrawal", type: "WITHDRAWAL", reason: "Retiro del titular" }),
    movement({ id: "refund", type: "REFUND", reason: "Vuelto" }),
    movement({ id: "adjustment", type: "ADJUSTMENT", amountMinor: -500, reason: "Corrección" }),
  ];
  const before = structuredClone(movements);
  const details = cashOutflowDetails(movements);
  assert.deepEqual(details.map(({ id, label, outflowMinor, reason }) => ({ id, label, outflowMinor, reason })), [
    { id: "expense", label: "Gasto", outflowMinor: 25_000, reason: "Compra de harina" },
    { id: "delivery", label: "Envío y rendición", outflowMinor: 25_000, reason: "Pago del pedido #24" },
    { id: "withdrawal", label: "Retiro", outflowMinor: 25_000, reason: "Retiro del titular" },
    { id: "refund", label: "Devolución o vuelto", outflowMinor: 25_000, reason: "Vuelto" },
    { id: "adjustment", label: "Ajuste de salida", outflowMinor: 500, reason: "Corrección" },
  ]);
  assert.deepEqual(movements, before);
});

test("el detalle excluye entradas, aperturas, cierres, ceros y pagos que no afectan efectivo", () => {
  const movements = [
    ...(["OPENING", "CLOSING", "SALE", "INCOME"] as const).map(type => movement({ type })),
    movement({ type: "ADJUSTMENT", amountMinor: 500 }),
    movement({ type: "ADJUSTMENT", amountMinor: 0 }),
    movement({ amountMinor: 0 }),
    movement({ amountMinor: -500 }),
    movement({ affectsCash: false, paymentMethodCode: "TRANSFER" }),
    movement({ type: "WITHDRAWAL", affectsCash: false }),
    movement({ type: "REFUND", affectsCash: false }),
    movement({ type: "ADJUSTMENT", amountMinor: -500, affectsCash: false }),
  ];
  assert.deepEqual(cashOutflowDetails(movements), []);
});

test("el detalle conserva egresos anulados y anulaciones sin descontar la compensación otra vez", () => {
  const original = movement({ id: "original", reversedById: "compensation" });
  const compensation = movement({ id: "compensation", type: "INCOME", referenceId: "original" });
  const outgoingReversal = movement({ id: "reversal", referenceId: "incoming", reason: "Anulación del ingreso" });
  const details = cashOutflowDetails([original, compensation, outgoingReversal]);
  assert.deepEqual(details.map(item => item.id), ["original", "reversal"]);
  assert.equal(details[0]?.reversedById, "compensation");
  assert.equal(details[1]?.referenceId, "incoming");
});

test("agrupa salidas por tipo en orden, sin netear anulados ni mutar movimientos", () => {
  const movements = [
    movement({ id: "refund", type: "REFUND", amountMinor: 200 }),
    movement({ id: "manual", orderId: null, amountMinor: 100, reason: "Envío por texto" }),
    movement({ id: "linked", orderId: "order-1", amountMinor: 300, reason: "arbitrario" }),
    movement({ id: "withdrawal", type: "WITHDRAWAL", amountMinor: 400 }),
    movement({ id: "adjustment", type: "ADJUSTMENT", amountMinor: -50 }),
    movement({ id: "annulled", orderId: null, amountMinor: 600, reversedById: "compensation" }),
    movement({ id: "noncash", type: "EXPENSE", affectsCash: false, amountMinor: 900 }),
  ];
  const before = structuredClone(movements);
  const groups = cashOutflowGroups(movements);
  assert.deepEqual(groups.map(({ key, title, totalMinor }) => ({ key, title, totalMinor })), [
    { key: "expense", title: "Gastos", totalMinor: 700 },
    { key: "delivery", title: "Envíos y rendiciones", totalMinor: 300 },
    { key: "withdrawal", title: "Retiros", totalMinor: 400 },
    { key: "refund", title: "Devoluciones y vueltos", totalMinor: 200 },
    { key: "adjustment", title: "Ajustes de salida", totalMinor: 50 },
  ]);
  assert.deepEqual(groups[0]?.items.map(item => item.id), ["manual", "annulled"]);
  assert.equal(groups[1]?.items[0]?.label, "Envío y rendición");
  assert.equal(groups[0]?.items[1]?.reversedById, "compensation");
  assert.deepEqual(movements, before);
});

test("los grupos omiten categorías vacías y quedan vacíos para importes nulos o no efectivos", () => {
  assert.deepEqual(cashOutflowGroups([]), []);
  assert.deepEqual(cashOutflowGroups([
    movement({ amountMinor: 0 }),
    movement({ type: "ADJUSTMENT", amountMinor: 50 }),
    movement({ type: "SALE", amountMinor: 50 }),
    movement({ type: "REFUND", affectsCash: false }),
  ]), []);
});

test("no inventa gastos negativos cuando el detalle de envíos supera el agregado conservado", () => {
  const rows = cashReportBreakdown({
    openingAmountMinor: 100_000, cashExpenseMinor: 10_000, expectedAmountMinor: 90_000,
    movements: [movement({ amountMinor: 25_000 })],
  });
  assert.equal(rows.find((r) => r.label === "Egresos en efectivo (incluye repartidores)")?.amountMinor, -10_000);
  assert.equal(rows.some((r) => r.label === "Envíos y rendiciones en efectivo"), false);
  assert.equal(rows.reduce((sum, r) => sum + r.amountMinor, 0), 90_000);
});

test("el cero de gastos generales no se presenta como un importe negativo", () => {
  const rows = cashReportBreakdown({
    openingAmountMinor: 100_000, cashExpenseMinor: 25_000, expectedAmountMinor: 75_000,
    movements: [movement({ amountMinor: 25_000 })],
  });
  assert.equal(rows.find((r) => r.label === "Gastos y otros egresos en efectivo")?.amountMinor, 0);
  assert.equal(rows.find((r) => r.label === "Envíos y rendiciones en efectivo")?.amountMinor, -25_000);
  assert.equal(rows.reduce((sum, r) => sum + r.amountMinor, 0), 75_000);
});

test("separa envíos y rendiciones vinculados sin clasificarlos por texto ni restarlos dos veces", () => {
  const session = {
    openingAmountMinor: 200_000, cashSalesMinor: 100_000, cashIncomeMinor: 30_000,
    cashExpenseMinor: 95_000, expectedAmountMinor: 235_000,
    movements: [
      movement({ id: "direct", amountMinor: 25_000, reason: "Texto arbitrario" }),
      movement({ id: "settlement", amountMinor: 20_000 }),
      movement({ id: "reverse-income", amountMinor: 30_000, referenceId: "income" }),
      movement({ id: "manual", amountMinor: 20_000, orderId: null, reason: "Pago de envío a repartidor: Pedido #1" }),
    ],
  };
  const rows = cashReportBreakdown(session);
  assert.equal(rows.find((r) => r.label === "Envíos y rendiciones en efectivo")?.amountMinor, -75_000);
  assert.equal(rows.find((r) => r.label === "Gastos y otros egresos en efectivo")?.amountMinor, -20_000);
  assert.equal(rows.reduce((sum, r) => sum + r.amountMinor, 0), session.expectedAmountMinor);
  assert.equal(cashReportBreakdown(session, 50_000).reduce((sum, r) => sum + r.amountMinor, 0), 185_000);
  assert.equal(session.cashExpenseMinor, 95_000);
});

test("no incluye pagos no efectivos ni cobros retenidos por el repartidor en egresos de envíos", () => {
  const rows = cashReportBreakdown({
    openingAmountMinor: 100_000, cashExpenseMinor: 10_000, expectedAmountMinor: 90_000,
    movements: [
      movement({ id: "noncash", amountMinor: 25_000, affectsCash: false, paymentMethodCode: "TRANSFER" }),
      movement({ id: "driver-sale", type: "SALE", amountMinor: 80_000, affectsCash: false, paymentMethodCode: "CASH" }),
      movement({ id: "manual", orderId: null, amountMinor: 10_000 }),
    ],
  });
  assert.equal(rows.find((r) => r.label === "Envíos y rendiciones en efectivo")?.amountMinor, 0);
  assert.equal(rows.find((r) => r.label === "Gastos y otros egresos en efectivo")?.amountMinor, -10_000);
  assert.equal(rows.reduce((sum, r) => sum + r.amountMinor, 0), 90_000);
});

test("el cierre informa efectivo excluyendo cambio final y conserva la diferencia", () => {
  const totals = cashClosingTotals({
    openingAmountMinor: 10_000,
    expectedAmountMinor: 50_000,
    countedAmountMinor: 48_000,
    closingFloatAmountMinor: 12_000,
  });
  assert.deepEqual(totals, {
    expectedAmountMinor: 38_000,
    countedAmountMinor: 36_000,
    closingFloatAmountMinor: 12_000,
  });
  assert.equal(
    totals.countedAmountMinor! - totals.expectedAmountMinor,
    48_000 - 50_000,
  );
  for (const float of [0, 10_000]) {
    const net = cashClosingTotals({
      openingAmountMinor: 10_000,
      expectedAmountMinor: 50_000,
      countedAmountMinor: 50_000,
      closingFloatAmountMinor: float,
    });
    assert.equal(net.expectedAmountMinor, 50_000 - float);
    assert.equal(net.countedAmountMinor, 50_000 - float);
    assert.equal(net.closingFloatAmountMinor, float);
  }
});

test("el cambio final puede dejar un esperado negativo y contado faltante o sobrante", () => {
  assert.deepEqual(
    cashClosingTotals({
      openingAmountMinor: 0,
      expectedAmountMinor: 5_000,
      countedAmountMinor: 9_000,
      closingFloatAmountMinor: 8_000,
    }),
    {
      expectedAmountMinor: -3_000,
      countedAmountMinor: 1_000,
      closingFloatAmountMinor: 8_000,
    },
  );
});

test("el resumen usa cambio inicial como fallback y conserva contado nulo", () => {
  assert.deepEqual(
    cashClosingTotals({
      openingAmountMinor: 10_000,
      expectedAmountMinor: 25_000,
      countedAmountMinor: null,
      closingFloatAmountMinor: null,
    }),
    {
      expectedAmountMinor: 15_000,
      countedAmountMinor: null,
      closingFloatAmountMinor: 10_000,
    },
  );
  assert.deepEqual(
    cashClosingTotals({
      openingAmountMinor: 4_000,
      expectedAmountMinor: 14_000,
      countedAmountMinor: null,
    }),
    {
      expectedAmountMinor: 10_000,
      countedAmountMinor: null,
      closingFloatAmountMinor: 4_000,
    },
  );
});

test("el informe descuenta pagos a repartidores una sola vez, sin alterar ventas", () => {
  const session = {
    openingAmountMinor: 100_000,
    cashSalesMinor: 300_000,
    cashIncomeMinor: 50_000,
    cashExpenseMinor: 75_000,
    cashWithdrawalMinor: 10_000,
    cashRefundMinor: 5_000,
    expectedAmountMinor: 360_000,
  };
  const rows = cashReportBreakdown(session);
  assert.equal(
    rows.find((row) => row.label.includes("repartidores"))?.amountMinor,
    -75_000,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.amountMinor, 0),
    session.expectedAmountMinor,
  );
  assert.equal(session.cashSalesMinor, 300_000);
  assert.equal(rows.length, 6);
  const netRows = cashReportBreakdown(session, 150_000);
  assert.equal(netRows.reduce((sum, row) => sum + row.amountMinor, 0), 210_000);
  assert.deepEqual(netRows.at(-1), {
    label: "Cambio apartado del efectivo",
    amountMinor: -150_000,
  });
});

test("el pago de un envío cobrado por transferencia igualmente reduce el efectivo", () => {
  const rows = cashReportBreakdown({
    openingAmountMinor: 100_000,
    cashSalesMinor: 0,
    cashExpenseMinor: 25_000,
    expectedAmountMinor: 75_000,
  });
  assert.equal(rows[1]?.amountMinor, 0);
  assert.equal(rows[3]?.amountMinor, -25_000);
  assert.equal(
    rows.reduce((sum, row) => sum + row.amountMinor, 0),
    75_000,
  );
});

test("los ajustes y cierres históricos usan el esperado guardado", () => {
  const rows = cashReportBreakdown({
    openingAmountMinor: 100_000,
    cashSalesMinor: 150_000,
    cashExpenseMinor: 25_000,
    expectedAmountMinor: 220_000,
  });
  assert.deepEqual(rows.at(-1), {
    label: "Ajustes y otros movimientos",
    amountMinor: -5_000,
  });
  assert.equal(
    rows.reduce((sum, row) => sum + row.amountMinor, 0),
    220_000,
  );
});
