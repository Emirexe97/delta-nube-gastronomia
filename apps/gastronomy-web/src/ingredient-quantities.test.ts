import { expect, it } from "vitest";
import {
  ingredientQuantityInput,
  parseIngredientQuantity,
} from "./ingredient-quantities";

it("convierte bolsas, gramos fraccionarios, litros y unidades a una escala común exacta", () => {
  expect(parseIngredientQuantity("16", "KG")).toBe(16_000_000);
  expect(parseIngredientQuantity("300", "G")).toBe(300_000);
  expect(parseIngredientQuantity("0,5", "G")).toBe(500);
  expect(parseIngredientQuantity("0.0005", "KG")).toBe(500);
  expect(parseIngredientQuantity("1,5", "L")).toBe(1_500_000);
  expect(parseIngredientQuantity("25", "ML")).toBe(25_000);
  expect(parseIngredientQuantity("2", "UNIT")).toBe(2_000_000);
  expect(ingredientQuantityInput(500, "G")).toBe("0,5");
  expect(
    parseIngredientQuantity(
      ingredientQuantityInput(Number.MAX_SAFE_INTEGER, "KG"),
      "KG",
    ),
  ).toBe(Number.MAX_SAFE_INTEGER);
});

it("rechaza cantidades ambiguas, negativas, cero, precisión excesiva y desbordes", () => {
  for (const value of [
    "",
    "-1",
    "0",
    "1.000,5",
    "1e3",
    "0.0000001",
    "9007199255",
  ]) {
    expect(parseIngredientQuantity(value, "KG")).toBeNull();
  }
  expect(parseIngredientQuantity("0.0001", "G")).toBeNull();
});
