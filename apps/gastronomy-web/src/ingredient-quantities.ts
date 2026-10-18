import type { IngredientUnit } from "@gastronomy/contracts";

export type IngredientDisplayUnit = IngredientUnit | "G" | "ML";
const scale: Record<IngredientDisplayUnit, number> = {
  KG: 1_000_000,
  G: 1_000,
  L: 1_000_000,
  ML: 1_000,
  UNIT: 1_000_000,
};

export function parseIngredientQuantity(
  value: string,
  unit: IngredientDisplayUnit,
): number | null {
  const normalized = value.trim().replace(",", ".");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return null;
  const precision = unit === "G" || unit === "ML" ? 3 : 6;
  const decimals = match[2] ?? "";
  if (decimals.length > precision) return null;
  const result =
    BigInt(match[1]!) * BigInt(scale[unit]) +
    BigInt(decimals.padEnd(precision, "0") || "0");
  return result > 0n && result <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(result)
    : null;
}

export function ingredientQuantityInput(
  quantityMicros: number,
  unit: IngredientDisplayUnit,
): string {
  const value = BigInt(quantityMicros);
  const divisor = BigInt(scale[unit]);
  const precision = unit === "G" || unit === "ML" ? 3 : 6;
  const fraction = (value % divisor)
    .toString()
    .padStart(precision, "0")
    .replace(/0+$/, "");
  return `${value / divisor}${fraction ? `,${fraction}` : ""}`;
}

export function ingredientUnitOptions(
  baseUnit: IngredientUnit,
): Array<{ value: IngredientDisplayUnit; label: string }> {
  if (baseUnit === "KG")
    return [
      { value: "KG", label: "kg" },
      { value: "G", label: "g" },
    ];
  if (baseUnit === "L")
    return [
      { value: "L", label: "l" },
      { value: "ML", label: "ml" },
    ];
  return [{ value: "UNIT", label: "unidades" }];
}

export function defaultRecipeUnit(
  baseUnit: IngredientUnit,
): IngredientDisplayUnit {
  return baseUnit === "KG" ? "G" : baseUnit === "L" ? "ML" : "UNIT";
}

export function formatIngredientQuantity(
  quantityMicros: number,
  baseUnit: IngredientUnit,
): string {
  return `${ingredientQuantityInput(quantityMicros, baseUnit)} ${baseUnit === "KG" ? "kg" : baseUnit === "L" ? "l" : "u."}`;
}
