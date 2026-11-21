import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFinanceRecovery,
  projectFinanceRecurringExpenses,
} from "./finance-recovery";

test("cobro posterior recupera una devolución sólo por lo que vuelve a pagarse", () => {
  const partial = calculateFinanceRecovery({
    totalMinor: 1_500_000,
    depositMinor: 0,
    movements: [
      { kind: "PAYMENT", amountMinor: 1_500_000 },
      { kind: "REFUND", amountMinor: 100_000 },
      { kind: "PAYMENT", amountMinor: 50_000 },
    ],
  });
  assert.equal(partial.recoveredMinor, 50_000);
  assert.equal(partial.effectiveRefundMinor, 50_000);
  assert.equal(partial.netSalesMinor, 1_450_000);
  const full = calculateFinanceRecovery({
    totalMinor: 1_500_000,
    depositMinor: 0,
    movements: [
      { kind: "PAYMENT", amountMinor: 1_500_000 },
      { kind: "REFUND", amountMinor: 100_000 },
      { kind: "PAYMENT", amountMinor: 100_000 },
    ],
  });
  assert.equal(full.effectiveRefundMinor, 0);
  assert.equal(full.netSalesMinor, 1_500_000);
});

test("un vuelto no borra una devolución real y una baja de total no duplica el reintegro", () => {
  const changeAndRefund = calculateFinanceRecovery({
    totalMinor: 1_500_000,
    depositMinor: 0,
    movements: [
      { kind: "PAYMENT", amountMinor: 1_600_000 },
      { kind: "CHANGE", amountMinor: 100_000 },
      { kind: "REFUND", amountMinor: 100_000 },
    ],
  });
  assert.equal(changeAndRefund.effectiveRefundMinor, 100_000);
  assert.equal(changeAndRefund.netSalesMinor, 1_400_000);
  const loweredTotal = calculateFinanceRecovery({
    totalMinor: 1_400_000,
    depositMinor: 0,
    movements: [
      { kind: "PAYMENT", amountMinor: 1_500_000 },
      { kind: "REFUND", amountMinor: 100_000 },
    ],
  });
  assert.equal(loweredTotal.effectiveRefundMinor, 0);
  assert.equal(loweredTotal.netSalesMinor, 1_400_000);
});

test("la cuenta corriente cubre el saldo aunque no represente caja física", () => {
  const account = calculateFinanceRecovery({
    totalMinor: 1_500_000,
    depositMinor: 0,
    movements: [
      { kind: "PAYMENT", amountMinor: 1_500_000, paymentMethodCode: "ACCOUNT" },
    ],
  });
  assert.equal(account.netSalesMinor, 1_500_000);
  assert.equal(account.effectiveRefundMinor, 0);
});

test("proyecta vencimientos recurrentes previos y futuros sin repetir slots pagados/anulados", () => {
  const projected = projectFinanceRecurringExpenses(
    [
      {
        id: "rent",
        title: "Alquiler",
        category: "Local",
        kind: "FIXED",
        amountMinor: 100_000,
        dayOfMonth: 31,
        startMonth: "2026-01",
        employeeId: null,
        active: true,
        stopMonth: "2026-04",
      },
    ],
    [
      { recurringId: "rent", incurredOn: "2026-02-28" }, // Slot already exists (paid or canceled).
    ],
    "2026-01-01",
    "2026-05-15",
  );
  assert.deepEqual(
    projected.map((row) => row.dueOn),
    ["2026-01-31", "2026-03-31", "2026-04-30"],
  );
  assert.ok(projected.every((row) => row.forecast));
  assert.ok(projected.every((row) => row.id.startsWith("forecast-")));
});
