import type { HalfAndHalfPricingMode, ModifierScope } from "@gastronomy/contracts";
import { nonNegativeMoney, roundHalfUp } from "./money";

export function calculateHalfAndHalfBase(
  firstPriceMinor: number,
  secondPriceMinor: number,
  mode: HalfAndHalfPricingMode
) {
  nonNegativeMoney(firstPriceMinor, "precio de la primera mitad");
  nonNegativeMoney(secondPriceMinor, "precio de la segunda mitad");
  if (mode === "MOST_EXPENSIVE") return Math.max(firstPriceMinor, secondPriceMinor);
  return roundHalfUp(firstPriceMinor / 2 + secondPriceMinor / 2);
}

export function calculateModifierCharge(priceMinor: number, scope: ModifierScope) {
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
    0
  );
  return Math.max(0, input.unitPriceMinor * input.quantity + modifiers * input.quantity - discount);
}

export function applyPercentage(amountMinor: number, percentage: number) {
  nonNegativeMoney(amountMinor);
  if (!Number.isFinite(percentage)) throw new Error("El porcentaje no es válido.");
  return Math.max(0, roundHalfUp(amountMinor * (1 + percentage / 100)));
}

export function roundPrice(amountMinor: number, incrementMinor: number) {
  nonNegativeMoney(amountMinor);
  if (!Number.isSafeInteger(incrementMinor) || incrementMinor <= 0) return amountMinor;
  return Math.round(amountMinor / incrementMinor) * incrementMinor;
}

export function calculateDiscountMinor(
  baseMinor: number,
  mode: "PERCENTAGE" | "FIXED",
  value: number
) {
  nonNegativeMoney(baseMinor, "base del descuento");
  if (!Number.isFinite(value) || value < 0) throw new Error("El descuento no es válido.");
  const discount = mode === "PERCENTAGE" ? roundHalfUp(baseMinor * value / 100) : Math.round(value);
  if (mode === "PERCENTAGE" && value > 100) throw new Error("El descuento no puede superar el 100%.");
  if (discount > baseMinor) throw new Error("El descuento no puede superar el total.");
  return discount;
}
