import test from "node:test";
import assert from "node:assert/strict";
import { cashClosingTotals, cashReportBreakdown } from "./cash";

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
