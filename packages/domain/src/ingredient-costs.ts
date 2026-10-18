import type { IngredientDto, RecipeIngredientDto, SaveIngredientInput } from "@gastronomy/contracts";

const units = new Set(["KG", "L", "UNIT"]);
const nonEmpty = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new Error(`${label} debe tener entre 1 y 120 caracteres.`);
};

export function assertIngredientValues(input: SaveIngredientInput): void {
  nonEmpty(input.name, "El nombre");
  nonEmpty(input.presentation, "La presentación");
  if (!units.has(input.baseUnit)) throw new Error("La unidad del ingrediente no es válida.");
  if (!Number.isSafeInteger(input.presentationQuantityMicros) || input.presentationQuantityMicros <= 0) throw new Error("La cantidad de presentación debe ser un entero positivo seguro.");
  if (!Number.isSafeInteger(input.presentationCostMinor) || input.presentationCostMinor < 0) throw new Error("El costo debe ser un entero seguro no negativo.");
}

export function calculateIngredientRecipeCost(items: RecipeIngredientDto[], ingredients: IngredientDto[]): number {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new Error("La receta debe tener entre 1 y 100 ingredientes.");
  const used = new Set<string>();
  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  let total = 0n;
  for (const item of items) {
    if (!item || typeof item.ingredientId !== "string" || used.has(item.ingredientId)) throw new Error("La receta contiene ingredientes duplicados o inválidos.");
    used.add(item.ingredientId);
    if (!Number.isSafeInteger(item.quantityMicros) || item.quantityMicros <= 0) throw new Error("La cantidad de receta debe ser un entero positivo seguro.");
    const ingredient = byId.get(item.ingredientId);
    if (!ingredient) throw new Error(`No se encontró el ingrediente ${item.ingredientId}.`);
    assertIngredientValues({ name: ingredient.name, presentation: ingredient.presentation, baseUnit: ingredient.baseUnit, presentationQuantityMicros: ingredient.presentationQuantityMicros, presentationCostMinor: ingredient.presentationCostMinor });
    const numerator = BigInt(ingredient.presentationCostMinor) * BigInt(item.quantityMicros);
    const denominator = BigInt(ingredient.presentationQuantityMicros);
    total += (numerator + denominator / 2n) / denominator;
  }
  const cost = Number(total);
  if (!Number.isSafeInteger(cost)) throw new Error("El costo total de la receta excede el rango permitido.");
  return cost;
}
