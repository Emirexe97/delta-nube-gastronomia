import type { CashMovementType } from "@gastronomy/contracts";
import { assertMoneyMinor, nonNegativeMoney } from "./money";

export interface CashMovementValue {
  type: CashMovementType;
  amountMinor: number;
  affectsCash?: boolean;
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
