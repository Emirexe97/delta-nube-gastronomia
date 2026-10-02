import test from "node:test";
import assert from "node:assert/strict";
import { cashReportBreakdown } from "./cash";

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
