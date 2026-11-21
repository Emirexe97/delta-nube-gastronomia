import type {
  FinanceExpenseDto,
  FinanceRecurringDto,
} from "@gastronomy/contracts";

export interface FinanceRecoveryMovement {
  kind: "PAYMENT" | "REFUND" | "CHANGE";
  amountMinor: number;
  paymentMethodCode?: string | null;
}

/** Distinguishes a real price reduction from a payment correction, using the current order balance. */
export function calculateFinanceRecovery(input: {
  totalMinor: number;
  depositMinor: number;
  movements: FinanceRecoveryMovement[];
}) {
  let refundable = 0;
  let recoveredMinor = 0;
  let paymentMinor = 0;
  let refundMinor = 0;
  let changeMinor = 0;
  for (const movement of input.movements) {
    if (movement.kind === "REFUND") {
      refundMinor += movement.amountMinor;
      refundable += movement.amountMinor;
    } else if (movement.kind === "CHANGE") {
      changeMinor += movement.amountMinor;
    } else {
      paymentMinor += movement.amountMinor;
      const recovery = Math.min(refundable, movement.amountMinor);
      refundable -= recovery;
      recoveredMinor += recovery;
    }
  }
  const balanceAfterMovements = paymentMinor - refundMinor - changeMinor;
  const dueAgainstCurrentTotal = Math.max(
    0,
    input.totalMinor - balanceAfterMovements,
  );
  const effectiveRefundMinor = Math.min(refundable, dueAgainstCurrentTotal);
  return {
    paymentMinor,
    refundMinor,
    changeMinor,
    recoveredMinor,
    effectiveRefundMinor,
    netSalesMinor: input.totalMinor + input.depositMinor - effectiveRefundMinor,
  };
}
/** Projects missing recurring slots without persisting or making a phantom expense payable. */
export function projectFinanceRecurringExpenses(
  rules: FinanceRecurringDto[],
  existing: Array<Pick<FinanceExpenseDto, "recurringId" | "incurredOn">>,
  from: string,
  to: string,
  employeeName: (employeeId: string) => string | null = () => null,
): FinanceExpenseDto[] {
  const present = new Set(
    existing.flatMap((item) =>
      item.recurringId ? [`${item.recurringId}\u0000${item.incurredOn}`] : [],
    ),
  );
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const forecasts: FinanceExpenseDto[] = [];
  for (const rule of rules) {
    if (!rule.active && !rule.stopMonth) continue;
    let month = rule.startMonth > fromMonth ? rule.startMonth : fromMonth;
    const endMonth =
      rule.stopMonth && rule.stopMonth < toMonth ? rule.stopMonth : toMonth;
    while (month <= endMonth) {
      const [year, number] = month.split("-").map(Number);
      const day = Math.min(
        rule.dayOfMonth,
        new Date(Date.UTC(year!, number!, 0)).getUTCDate(),
      );
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const key = `${rule.id}\u0000${date}`;
      if (date >= from && date <= to && !present.has(key)) {
        forecasts.push({
          id: `forecast-${rule.id}-${date}`,
          title: rule.title,
          category: rule.category,
          kind: rule.kind,
          amountMinor: rule.amountMinor,
          incurredOn: date,
          dueOn: date,
          paidAt: null,
          paymentMethodCode: null,
          employeeId: rule.employeeId,
          employeeName: rule.employeeId ? employeeName(rule.employeeId) : null,
          recurringId: rule.id,
          note: "Proyección mensual; abrí el mes para materializarlo",
          forecast: true,
        });
      }
      month = new Date(Date.UTC(year!, number!, 1)).toISOString().slice(0, 7);
    }
  }
  return forecasts;
}
