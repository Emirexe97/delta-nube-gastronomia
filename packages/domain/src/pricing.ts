import type {
  HalfAndHalfPricingMode,
  ModifierScope,
} from "@gastronomy/contracts";
import { nonNegativeMoney, roundHalfUp } from "./money";

export function calculateHalfAndHalfBase(
  firstPriceMinor: number,
  secondPriceMinor: number,
  mode: HalfAndHalfPricingMode,
) {
  nonNegativeMoney(firstPriceMinor, "precio de la primera mitad");
  nonNegativeMoney(secondPriceMinor, "precio de la segunda mitad");
  if (mode === "MOST_EXPENSIVE")
    return Math.max(firstPriceMinor, secondPriceMinor);
  return roundHalfUp(firstPriceMinor / 2 + secondPriceMinor / 2);
}

export function calculateModifierCharge(
  priceMinor: number,
  scope: ModifierScope,
) {
  nonNegativeMoney(priceMinor, "precio del extra");
  return scope === "FULL_PIZZA" ? priceMinor : roundHalfUp(priceMinor / 2);
}

export function calculateLineTotal(input: {
  unitPriceMinor: number;
  quantity: number;
  discountMinor?: number;
  modifierChargesMinor?: number[];
}) {
  nonNegativeMoney(input.unitPriceMinor, "precio unitario");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("La cantidad debe ser un entero positivo.");
  }
  const discount = nonNegativeMoney(input.discountMinor ?? 0, "descuento");
  const modifiers = (input.modifierChargesMinor ?? []).reduce(
    (total, charge) => total + nonNegativeMoney(charge, "extra"),
    0,
  );
  return Math.max(
    0,
    input.unitPriceMinor * input.quantity +
      modifiers * input.quantity -
      discount,
  );
}

export function applyPercentage(amountMinor: number, percentage: number) {
  nonNegativeMoney(amountMinor);
  if (!Number.isFinite(percentage))
    throw new Error("El porcentaje no es válido.");
  return Math.max(0, roundHalfUp(amountMinor * (1 + percentage / 100)));
}

export function roundPrice(amountMinor: number, incrementMinor: number) {
  nonNegativeMoney(amountMinor);
  if (!Number.isSafeInteger(incrementMinor) || incrementMinor <= 0)
    return amountMinor;
  return Math.round(amountMinor / incrementMinor) * incrementMinor;
}

export function calculateDiscountMinor(
  baseMinor: number,
  mode: "PERCENTAGE" | "FIXED",
  value: number,
) {
  nonNegativeMoney(baseMinor, "base del descuento");
  if (!Number.isFinite(value) || value < 0)
    throw new Error("El descuento no es válido.");
  const discount =
    mode === "PERCENTAGE"
      ? roundHalfUp((baseMinor * value) / 100)
      : Math.round(value);
  if (mode === "PERCENTAGE" && value > 100)
    throw new Error("El descuento no puede superar el 100%.");
  if (discount > baseMinor)
    throw new Error("El descuento no puede superar el total.");
  return discount;
}

/** One rule directly against the principal price. Basis points allow two decimal places of percent. */
export function calculateBookPrice(
  baseMinor: number,
  adjustmentBps: number,
  overrideMinor?: number,
): number {
  if (
    !Number.isSafeInteger(baseMinor) ||
    baseMinor < 0 ||
    !Number.isSafeInteger(adjustmentBps) ||
    adjustmentBps < -10000 ||
    adjustmentBps > 100000
  )
    throw new Error("El precio o el porcentaje de lista no es válido.");
  if (overrideMinor !== undefined) {
    if (!Number.isSafeInteger(overrideMinor) || overrideMinor < 0)
      throw new Error("El precio propio no es válido.");
    return overrideMinor;
  }
  const cents =
    (BigInt(baseMinor) * BigInt(10000 + adjustmentBps) + 5000n) / 10000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("El precio calculado es demasiado alto.");
  return Number(cents);
}
/** Bulk preview and persistence both evaluate selected lists from the pre-change prices. */
export function applyBookAdjustment(
  current: import("@gastronomy/contracts").ProductPriceBookDto,
  books: readonly import("@gastronomy/contracts").PriceBookDto[],
  selected: readonly string[],
  mode: "FIXED" | "PERCENTAGE",
  value: number,
): import("@gastronomy/contracts").ProductPriceBookDto {
  const ids = new Set(selected);
  if (mode !== "FIXED" && mode !== "PERCENTAGE")
    throw new Error("El tipo de ajuste no es válido.");
  if (!ids.size || [...ids].some((id) => !books.some((b) => b.id === id)))
    throw new Error("Elegí una lista válida.");
  const bps = Math.round(value * 100);
  if (
    mode === "PERCENTAGE" &&
    (!Number.isFinite(value) || Math.abs(value * 100 - bps) > 1e-8)
  )
    throw new Error("El porcentaje admite hasta dos decimales.");
  if (mode === "FIXED" && !Number.isSafeInteger(value))
    throw new Error("El importe no es válido.");
  const result = {
    baseMinor: current.baseMinor,
    overrides: { ...current.overrides },
  };
  for (const book of books) {
    if (!ids.has(book.id)) continue;
    const before = book.isBase
      ? current.baseMinor
      : calculateBookPrice(
          current.baseMinor,
          book.adjustmentBps,
          current.overrides[book.id],
        );
    const after =
      mode === "PERCENTAGE" ? calculateBookPrice(before, bps) : before + value;
    if (!Number.isSafeInteger(after) || after < 0)
      throw new Error("El ajuste deja precios fuera de rango.");
    if (book.isBase) result.baseMinor = after;
    else result.overrides[book.id] = after;
  }
  for (const book of books)
    calculateBookPrice(
      result.baseMinor,
      book.adjustmentBps,
      result.overrides[book.id],
    );
  return result;
}
