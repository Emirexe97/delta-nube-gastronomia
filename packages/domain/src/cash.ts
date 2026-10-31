import type { CashMovementDto, CashMovementType, CashSessionDto } from "@gastronomy/contracts";
import { assertMoneyMinor, nonNegativeMoney } from "./money";

export interface CashMovementValue {
  type: CashMovementType;
  amountMinor: number;
  affectsCash?: boolean;
}

/** Informational outgoing entries; the closing totals already include them. */
export function cashOutflowDetails(movements: CashMovementDto[]) {
  return movements.flatMap((movement) => {
    if (movement.affectsCash === false) return [];
    let label: string;
    let outflowMinor: number;
    switch (movement.type) {
      case "EXPENSE":
        label = movement.orderId != null ? "Envío y rendición" : "Gasto";
        outflowMinor = movement.amountMinor;
        break;
      case "WITHDRAWAL":
        label = "Retiro";
        outflowMinor = movement.amountMinor;
        break;
      case "REFUND":
        label = "Devolución o vuelto";
        outflowMinor = movement.amountMinor;
        break;
      case "ADJUSTMENT":
        label = "Ajuste de salida";
        outflowMinor = -movement.amountMinor;
        break;
      default:
        return [];
    }
    if (outflowMinor <= 0) return [];
    // Preserve reversals and their links: incoming compensation is accounted
    // for in the summary, while this list explains each recorded outgoing entry.
    return [{ ...movement, label, outflowMinor }];
  });
}

export type CashOutflowGroupKey =
  | "expense"
  | "delivery"
  | "withdrawal"
  | "refund"
  | "adjustment";

export interface CashOutflowGroup {
  key: CashOutflowGroupKey;
  title: string;
  items: ReturnType<typeof cashOutflowDetails>;
  /** Gross informational total; reversals remain visible and are not netted. */
  totalMinor: number;
}

/** Organizes informational outflow details without changing ledger values. */
export function cashOutflowGroups(movements: CashMovementDto[]): CashOutflowGroup[] {
  const config: Array<{ key: CashOutflowGroupKey; title: string }> = [
    { key: "expense", title: "Gastos" },
    { key: "delivery", title: "Envíos y rendiciones" },
    { key: "withdrawal", title: "Retiros" },
    { key: "refund", title: "Devoluciones y vueltos" },
    { key: "adjustment", title: "Ajustes de salida" },
  ];
  const details = cashOutflowDetails(movements);
  return config.flatMap(({ key, title }) => {
    const items = details.filter((item) => {
      switch (key) {
        case "expense": return item.type === "EXPENSE" && item.orderId == null;
        case "delivery": return item.type === "EXPENSE" && item.orderId != null;
        case "withdrawal": return item.type === "WITHDRAWAL";
        case "refund": return item.type === "REFUND";
        case "adjustment": return item.type === "ADJUSTMENT";
      }
    });
    return items.length
      ? [{ key, title, items, totalMinor: items.reduce((sum, item) => sum + item.outflowMinor, 0) }]
      : [];
  });
}

/** Totals shown in the close report exclude the float retained in the drawer. */
export function cashClosingTotals(
  session: Pick<
    CashSessionDto,
    | "expectedAmountMinor"
    | "countedAmountMinor"
    | "openingAmountMinor"
    | "closingFloatAmountMinor"
  >,
) {
  const closingFloatAmountMinor =
    session.closingFloatAmountMinor ?? session.openingAmountMinor;
  return {
    expectedAmountMinor:
      session.expectedAmountMinor - closingFloatAmountMinor,
    countedAmountMinor:
      session.countedAmountMinor == null
        ? null
        : session.countedAmountMinor - closingFloatAmountMinor,
    closingFloatAmountMinor,
  };
}

/** Cash movements, not gross sales by payment method, reconcile the drawer. */
export function cashReportBreakdown(
  session: Pick<
    CashSessionDto,
    | "openingAmountMinor"
    | "expectedAmountMinor"
    | "cashSalesMinor"
    | "cashIncomeMinor"
    | "cashExpenseMinor"
    | "cashWithdrawalMinor"
    | "cashRefundMinor"
    | "movements"
  >,
  retainedFloatMinor = 0,
) {
  const expenseMinor = session.cashExpenseMinor ?? 0;
  // Order-linked cash EXPENSE entries are delivery payments or remittance
  // reversals. Manual and Finance expenses have no order link. Never infer
  // this classification from a freely editable reason or a payment name.
  const shippingExpenseMinor = (session.movements ?? [])
    .filter(
      (movement) =>
        movement.type === "EXPENSE" &&
        movement.affectsCash !== false &&
        movement.orderId != null,
    )
    .reduce((sum, movement) => sum + movement.amountMinor, 0);
  // Summary-only legacy closes (or inconsistent details) cannot support a
  // reliable split; preserve the saved aggregate rather than invent amounts.
  const canSeparateShipping =
    session.movements != null &&
    (session.movements.length > 0 || expenseMinor === 0) &&
    shippingExpenseMinor >= 0 &&
    shippingExpenseMinor <= expenseMinor;
  const otherExpenseMinor = expenseMinor - shippingExpenseMinor;
  const rows = [
    { label: "Cambio inicial", amountMinor: session.openingAmountMinor },
    { label: "Ventas en efectivo", amountMinor: session.cashSalesMinor ?? 0 },
    {
      label: "Otros ingresos en efectivo",
      amountMinor: session.cashIncomeMinor ?? 0,
    },
    ...(canSeparateShipping
      ? [
          {
            label: "Gastos y otros egresos en efectivo",
            amountMinor: otherExpenseMinor > 0 ? -otherExpenseMinor : 0,
          },
          {
            label: "Envíos y rendiciones en efectivo",
            amountMinor: shippingExpenseMinor > 0 ? -shippingExpenseMinor : 0,
          },
        ]
      : [
          {
            label: "Egresos en efectivo (incluye repartidores)",
            amountMinor: -expenseMinor,
          },
        ]),
    {
      label: "Retiros de efectivo",
      amountMinor: -(session.cashWithdrawalMinor ?? 0),
    },
    {
      label: "Devoluciones en efectivo",
      amountMinor: -(session.cashRefundMinor ?? 0),
    },
  ];
  // Signed adjustments and legacy summaries must reconcile with the saved close.
  const otherMinor =
    session.expectedAmountMinor -
    rows.reduce((sum, row) => sum + row.amountMinor, 0);
  if (otherMinor !== 0)
    rows.push({
      label: "Ajustes y otros movimientos",
      amountMinor: otherMinor,
    });
  if (retainedFloatMinor !== 0)
    rows.push({ label: "Cambio apartado del efectivo", amountMinor: -retainedFloatMinor });
  return rows;
}

export function calculateExpectedCash(
  openingAmountMinor: number,
  movements: CashMovementValue[],
) {
  let expected = nonNegativeMoney(openingAmountMinor, "cambio inicial");
  for (const movement of movements) {
    assertMoneyMinor(movement.amountMinor);
    if (movement.affectsCash === false) continue;
    switch (movement.type) {
      case "OPENING":
      case "CLOSING":
        break;
      case "SALE":
      case "INCOME":
        expected += movement.amountMinor;
        break;
      case "EXPENSE":
      case "WITHDRAWAL":
      case "REFUND":
        expected -= movement.amountMinor;
        break;
      case "ADJUSTMENT":
        expected += movement.amountMinor;
        break;
    }
  }
  return expected;
}

export function calculateCashDifference(
  expectedMinor: number,
  countedMinor: number,
) {
  assertMoneyMinor(expectedMinor, "efectivo esperado");
  nonNegativeMoney(countedMinor, "efectivo contado");
  return countedMinor - expectedMinor;
}

export interface CashClosingReconciliation {
  differenceMinor: number;
  cashRemovedAmountMinor: number;
  floatDifferenceMinor: number;
}

export function calculateCashClosing(
  expectedMinor: number,
  countedMinor: number,
  openingFloatMinor: number,
  closingFloatMinor: number,
): CashClosingReconciliation {
  const differenceMinor = calculateCashDifference(expectedMinor, countedMinor);
  nonNegativeMoney(openingFloatMinor, "cambio inicial");
  nonNegativeMoney(closingFloatMinor, "cambio final");
  if (closingFloatMinor > countedMinor) {
    throw new Error("El cambio final no puede superar el efectivo contado.");
  }
  return {
    differenceMinor,
    cashRemovedAmountMinor: countedMinor - closingFloatMinor,
    floatDifferenceMinor: closingFloatMinor - openingFloatMinor,
  };
}

export function businessDateFromOpening(
  openedAt: string,
  timeZone = "America/Buenos_Aires",
) {
  const date = new Date(openedAt);
  if (Number.isNaN(date.valueOf()))
    throw new Error("La fecha de apertura no es válida.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${byType.year}-${byType.month}-${byType.day}`;
}
